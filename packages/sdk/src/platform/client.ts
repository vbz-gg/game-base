/**
 * A game page's client for the vbz.gg platform.
 *
 * It holds the protocol `docs/your-game-page.md` in the platform describes:
 * the page key on every request, the sign-in window and the code trade, the
 * player's token kept and renewed, and the run routes. Every request goes
 * through `request`, which is keyed by `PlatformRoutes`, so this file cannot
 * call a route the platform does not declare.
 */

import type {
  Board,
  BoardPeriod,
  ChunkAccepted,
  PageGame,
  PageKey,
  RunChunk,
  RunResult,
  SignedInPlayer,
  StartedRun,
  StartRunRequest,
  SubmittedRun,
  WatchedRun,
} from "../api/index.js"
import { browserEnvironment, type PageEnvironment } from "./environment.js"
import {
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "./errors.js"
import { keptPlayerKey, type PlayerStore, storagePlayerStore } from "./kept.js"
import { createRequester, type Requester } from "./request.js"
import { requestSignInCode } from "./signin.js"

export interface PlatformClientOptions {
  /** `API_ORIGIN`, from vbz.gg. */
  readonly apiOrigin: string
  /** `SIGN_IN_ORIGIN`, from vbz.gg. */
  readonly signInOrigin: string
  /** The game's page key, from the dashboard. */
  readonly pageKey: PageKey
  /** Where the signed-in player is kept. `localStorage` by default. */
  readonly store?: PlayerStore
  /** Told when the platform says the player's token stopped working. */
  readonly onSignedOut?: () => void
  /** The browser, or a test's stand-in for it. */
  readonly environment?: PageEnvironment
}

export interface BoardOptions {
  readonly period?: BoardPeriod
  readonly limit?: number
  readonly offset?: number
}

export interface ResultOptions {
  readonly signal?: AbortSignal
  /** How long to wait between asks. */
  readonly intervalMs?: number
  /**
   * The token to ask with: a run's own, from its start. The kept player's by
   * default, which may since have signed out or been replaced.
   */
  readonly token?: string
}

/** How long `awaitResult` waits between asks by default. */
export const RESULT_INTERVAL_MS = 2_000

export interface PlatformClient {
  /** Every page route, typed by `PlatformRoutes`. The methods below use it. */
  readonly request: Requester
  /** The game the page key names, and today's round. */
  game(): Promise<PageGame>
  /** The signed-in player, or null. */
  player(): SignedInPlayer["player"] | null
  /** Opens the sign-in window. Call it from a click, before anything is awaited. */
  signIn(): Promise<SignedInPlayer["player"]>
  /** Forgets the player on this page. No route signs a player out. */
  signOut(): void
  /** Starts a run, or finds again one that has sent nothing yet. */
  startRun(request?: StartRunRequest): Promise<StartedRun>
  sendChunk(run: StartedRun, chunk: RunChunk): Promise<ChunkAccepted>
  submit(run: StartedRun, recording: unknown): Promise<SubmittedRun>
  /** The player's own run and what its replay decided, now. */
  result(
    sessionId: string,
    options?: Pick<ResultOptions, "token">,
  ): Promise<RunResult>
  /** Asks until the run's result is final. */
  awaitResult(sessionId: string, options?: ResultOptions): Promise<RunResult>
  board(options?: BoardOptions): Promise<Board>
  /** A settled run, with what a frame needs to play it back. */
  watch(sessionId: string): Promise<WatchedRun>
}

/**
 * Whether a run's result will not change again: its replay has run, or it
 * expired having sent nothing, which is never replayed.
 */
export function isFinalResult(result: RunResult): boolean {
  return (
    result.replay !== null || (result.state === "expired" && !result.committed)
  )
}

export function createPlatformClient(
  options: PlatformClientOptions,
): PlatformClient {
  const environment = options.environment ?? browserEnvironment()
  const store =
    options.store ??
    storagePlayerStore({
      key: keptPlayerKey(options.pageKey),
      storage: () => environment.storage(),
      now: () => environment.now(),
    })
  const request = createRequester({
    apiOrigin: options.apiOrigin,
    pageKey: options.pageKey,
    fetch: environment.fetch,
  })

  const keep = (
    token: string,
    expiresIn: number,
    player: SignedInPlayer["player"],
  ) =>
    store.write({
      token,
      expiresAt: environment.now() + expiresIn * 1000,
      player,
    })

  const keptOrThrow = () => {
    const kept = store.read()
    if (kept === null) throw new PlatformClientError("E_NOT_SIGNED_IN")
    return kept
  }

  /**
   * A player route. A token the platform stopped honouring forgets the
   * player, but only while it is still the kept one: an older run's token
   * refused after the player signed in again says nothing about the new one.
   */
  const asPlayer = async <T>(
    token: string,
    call: (token: string) => Promise<T>,
  ): Promise<T> => {
    try {
      return await call(token)
    } catch (error) {
      if (
        error instanceof PlatformRefusal &&
        error.code === "E_SIGN_IN_REQUIRED" &&
        store.read()?.token === token
      ) {
        store.clear()
        options.onSignedOut?.()
      }
      throw error
    }
  }

  const result = (
    sessionId: string,
    resultOptions: Pick<ResultOptions, "token"> = {},
  ) =>
    asPlayer(resultOptions.token ?? keptOrThrow().token, (token) =>
      request("GET /v1/runs/:id/result", {
        params: { id: sessionId },
        token,
      }),
    )

  return {
    request,

    game: () => request("GET /v1/game", {}),

    player: () => store.read()?.player ?? null,

    async signIn() {
      const grant = await requestSignInCode({
        environment,
        signInOrigin: options.signInOrigin,
        pageKey: options.pageKey,
      })
      const signedIn = await request("POST /v1/oauth/token", {
        body: {
          code: grant.code,
          codeVerifier: grant.verifier,
          clientId: options.pageKey,
        },
      })
      keep(signedIn.token, signedIn.expiresIn, signedIn.player)
      return signedIn.player
    },

    signOut: () => store.clear(),

    async startRun(body = {}) {
      const kept = keptOrThrow()
      const started = await asPlayer(kept.token, (token) =>
        request("POST /v1/runs", { body, token }),
      )
      // Every start renews the token; the renewed one is the one to keep.
      keep(started.token, started.expiresIn, kept.player)
      return started
    },

    sendChunk: (run, chunk) =>
      asPlayer(run.token, (token) =>
        request("POST /v1/runs/:id/chunks", {
          params: { id: run.sessionId },
          body: chunk,
          token,
        }),
      ),

    submit: (run, recording) =>
      asPlayer(run.token, (token) =>
        request("POST /v1/runs/:id/submit", {
          params: { id: run.sessionId },
          body: { recording },
          token,
        }),
      ),

    result,

    async awaitResult(sessionId, waitOptions = {}) {
      const interval = waitOptions.intervalMs ?? RESULT_INTERVAL_MS
      for (;;) {
        waitOptions.signal?.throwIfAborted()
        try {
          const answer = await result(
            sessionId,
            waitOptions.token === undefined ? {} : { token: waitOptions.token },
          )
          if (isFinalResult(answer)) return answer
        } catch (error) {
          if (!worthRetrying(error)) throw error
        }
        await pause(environment, interval, waitOptions.signal)
      }
    },

    board: (boardOptions = {}) =>
      request("GET /v1/board", {
        query: {
          period: boardOptions.period,
          limit: boardOptions.limit,
          offset: boardOptions.offset,
        },
        // A token that stopped working reads the board as nobody, unrefused.
        token: store.read()?.token,
      }),

    watch: (sessionId) =>
      request("GET /v1/runs/:id", {
        params: { id: sessionId },
        token: store.read()?.token,
      }),
  }
}

function pause(
  environment: PageEnvironment,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      environment.clearTimeout(handle)
      reject(signal?.reason)
    }
    const handle = environment.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * The client against a scripted platform: signing a player in through the
 * window, keeping and renewing the token, and the run, board and result
 * routes.
 */

import { describe, expect, test } from "bun:test"
import { createPlatformClient, isFinalResult } from "../../src/platform/client"
import type {
  PlatformClientError,
  PlatformRefusal,
} from "../../src/platform/errors"
import { CLOSED_GRACE_MS, CLOSED_POLL_MS } from "../../src/platform/signin"
import { FakePage, settle } from "./fake-page"

const API = "https://api.vbz.example"
const SIGN_IN = "https://signin.vbz.example"
const KEY = "vbz_pk_abc" as const
const PLAYER = { id: "p-1", displayName: "player-3fa91c0e" }

function client(page = new FakePage(), onSignedOut?: () => void) {
  return {
    page,
    client: createPlatformClient({
      apiOrigin: API,
      signInOrigin: SIGN_IN,
      pageKey: KEY,
      environment: page,
      ...(onSignedOut === undefined ? {} : { onSignedOut }),
    }),
  }
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("expected a failure")
}

/** The query the page sent the window to. */
function authorizeQuery(page: FakePage): URLSearchParams {
  const href = page.popup?.location.href ?? ""
  expect(href.startsWith(`${SIGN_IN}/authorize?`)).toBe(true)
  return new URL(href).searchParams
}

async function signedIn() {
  const made = client()
  made.page.answers.push({
    status: 200,
    body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
  })
  const signing = made.client.signIn()
  await settle()
  const state = authorizeQuery(made.page).get("state")
  made.page.post({
    origin: SIGN_IN,
    source: made.page.popup,
    data: { type: "vbz.signin", code: "code-1", state },
  })
  await signing
  return made
}

describe("signing a player in", () => {
  test("opens the window before anything is awaited, then sends it to authorize", async () => {
    const { page, client: platform } = client()
    const signing = platform.signIn()
    // Synchronously, in the click's own turn.
    expect(page.opened).toEqual([
      {
        url: "about:blank",
        target: "vbz-signin",
        features: "popup,width=480,height=680",
      },
    ])
    await settle()
    const query = authorizeQuery(page)
    expect(query.get("client_id")).toBe(KEY)
    expect(query.get("redirect_uri")).toBe(page.origin)
    expect(query.get("code_challenge_method")).toBe("S256")
    expect(query.get("code_challenge")).toHaveLength(43)
    expect(query.get("state")?.length).toBeGreaterThan(0)
    page.popup?.close()
    page.advance(CLOSED_POLL_MS + CLOSED_GRACE_MS)
    await caught(() => signing)
  })

  test("a blocked window is E_POPUP_BLOCKED", async () => {
    const { page, client: platform } = client()
    page.popup = null
    const error = (await caught(() => platform.signIn())) as PlatformClientError
    expect(error.code).toBe("E_POPUP_BLOCKED")
  })

  test("takes only the window's own message, for this state, and trades its code", async () => {
    const { page, client: platform } = client()
    page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const signing = platform.signIn()
    await settle()
    const state = authorizeQuery(page).get("state")
    const right = { type: "vbz.signin", code: "code-1", state }
    // Another origin, another window, another message, another state, no code.
    page.post({
      origin: "https://evil.example",
      source: page.popup,
      data: right,
    })
    page.post({ origin: SIGN_IN, source: {}, data: right })
    page.post({
      origin: SIGN_IN,
      source: page.popup,
      data: { ...right, type: "other" },
    })
    page.post({
      origin: SIGN_IN,
      source: page.popup,
      data: { ...right, state: "x" },
    })
    page.post({
      origin: SIGN_IN,
      source: page.popup,
      data: { ...right, code: 7 },
    })
    page.post({ origin: SIGN_IN, source: page.popup, data: null })
    expect(page.sent).toHaveLength(0)
    page.post({ origin: SIGN_IN, source: page.popup, data: right })

    expect(await signing).toEqual(PLAYER)
    const [trade] = page.sent
    expect(trade?.url.pathname).toBe("/v1/oauth/token")
    expect(trade?.body).toMatchObject({ code: "code-1", clientId: KEY })
    const traded = trade?.body as { codeVerifier?: string } | undefined
    expect(traded?.codeVerifier).toHaveLength(43)
    expect(platform.player()).toEqual(PLAYER)
    // Nothing left listening or ticking once it is done.
    expect(page.listening).toBe(0)
    expect(page.pendingTimers).toBe(0)
  })

  test("a window closed without a code is E_SIGNIN_CLOSED, after the grace", async () => {
    const { page, client: platform } = client()
    const signing = platform.signIn()
    let failed: unknown
    signing.catch((error: unknown) => {
      failed = error
    })
    await settle()
    page.popup?.close()
    page.advance(CLOSED_POLL_MS)
    await settle()
    expect(failed).toBeUndefined()
    page.advance(CLOSED_GRACE_MS)
    await settle()
    expect((failed as PlatformClientError).code).toBe("E_SIGNIN_CLOSED")
    expect(page.listening).toBe(0)
  })

  test("a code that arrives after the window reports closed is still taken", async () => {
    const { page, client: platform } = client()
    page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const signing = platform.signIn()
    await settle()
    const state = authorizeQuery(page).get("state")
    page.popup?.close()
    page.advance(CLOSED_POLL_MS)
    page.post({
      origin: SIGN_IN,
      source: page.popup,
      data: { type: "vbz.signin", code: "late", state },
    })
    expect(await signing).toEqual(PLAYER)
    expect(page.pendingTimers).toBe(0)
  })

  test("a window that cannot make a challenge is closed again", async () => {
    const page = new FakePage()
    const broken = Object.create(page) as FakePage
    Object.defineProperty(broken, "crypto", {
      value: {
        getRandomValues: page.crypto.getRandomValues.bind(page.crypto),
        subtle: { digest: () => Promise.reject(new Error("no digest")) },
      },
    })
    const { client: platform } = client(broken)
    expect(String(await caught(() => platform.signIn()))).toContain("no digest")
    expect(page.popup?.closed).toBe(true)
  })

  test("signing out forgets the player on this page", async () => {
    const { client: platform } = await signedIn()
    platform.signOut()
    expect(platform.player()).toBeNull()
  })
})

describe("runs", () => {
  test("a start with nobody signed in is E_NOT_SIGNED_IN, and asks nothing", async () => {
    const { page, client: platform } = client()
    const error = (await caught(() =>
      platform.startRun(),
    )) as PlatformClientError
    expect(error.code).toBe("E_NOT_SIGNED_IN")
    expect(page.sent).toHaveLength(0)
  })

  test("a start sends the token and keeps the renewed one", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({
      status: 201,
      body: { sessionId: "s-1", token: "t-2", expiresIn: 7_776_000 },
    })
    await platform.startRun({ practice: true })
    const start = page.sent.at(-1)
    expect(start?.headers.authorization).toBe("Bearer t-1")
    expect(start?.body).toEqual({ practice: true })

    page.answers.push({ status: 200, body: { sessionId: "s-1", replay: null } })
    await platform.result("s-1")
    expect(page.sent.at(-1)?.headers.authorization).toBe("Bearer t-2")
  })

  test("a token that stopped working forgets the player, and says so", async () => {
    let told = 0
    const made = client(new FakePage(), () => {
      told += 1
    })
    made.page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const signing = made.client.signIn()
    await settle()
    made.page.post({
      origin: SIGN_IN,
      source: made.page.popup,
      data: {
        type: "vbz.signin",
        code: "c",
        state: authorizeQuery(made.page).get("state"),
      },
    })
    await signing

    made.page.answers.push({
      status: 401,
      body: {
        error: "E_SIGN_IN_REQUIRED",
        message: "this needs a player signed in to this studio",
      },
    })
    const error = (await caught(() =>
      made.client.startRun(),
    )) as PlatformRefusal
    expect(error.code).toBe("E_SIGN_IN_REQUIRED")
    expect(made.client.player()).toBeNull()
    expect(told).toBe(1)
  })

  test("an older run's token refused leaves a newer sign-in alone", async () => {
    let told = 0
    const made = client(new FakePage(), () => {
      told += 1
    })
    made.page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const signing = made.client.signIn()
    await settle()
    made.page.post({
      origin: SIGN_IN,
      source: made.page.popup,
      data: {
        type: "vbz.signin",
        code: "c",
        state: authorizeQuery(made.page).get("state"),
      },
    })
    await signing
    const run = { sessionId: "s-old", token: "t-old" } as Parameters<
      typeof made.client.sendChunk
    >[0]
    made.page.answers.push({
      status: 401,
      body: { error: "E_SIGN_IN_REQUIRED", message: "sign in" },
    })
    const error = (await caught(() =>
      made.client.sendChunk(run, {
        seq: 3,
        throughTick: 9,
        checkpoints: [],
        inputs: [],
      }),
    )) as PlatformRefusal
    expect(error.code).toBe("E_SIGN_IN_REQUIRED")
    expect(made.client.player()).toEqual(PLAYER)
    expect(told).toBe(0)
  })

  test("another refusal leaves the player signed in", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({
      status: 429,
      body: { error: "E_RANKED_RUNS_USED", message: "used" },
    })
    await caught(() => platform.startRun())
    expect(platform.player()).toEqual(PLAYER)
  })

  test("a chunk and a submit go with the run's own token", async () => {
    const { page, client: platform } = await signedIn()
    const run = { sessionId: "s-9", token: "t-run" } as Parameters<
      typeof platform.submit
    >[0]
    page.answers.push({ status: 202, body: { seq: 0, throughTick: 9 } })
    page.answers.push({
      status: 202,
      body: { sessionId: "s-9", recordingSha256: "x" },
    })
    await platform.sendChunk(run, {
      seq: 0,
      throughTick: 9,
      checkpoints: [],
      inputs: [],
    })
    await platform.submit(run, { version: 1 })
    expect(
      page.sent.slice(-2).map((s) => [s.url.pathname, s.headers.authorization]),
    ).toEqual([
      ["/v1/runs/s-9/chunks", "Bearer t-run"],
      ["/v1/runs/s-9/submit", "Bearer t-run"],
    ])
    expect(page.sent.at(-1)?.body).toEqual({ recording: { version: 1 } })
  })
})

describe("waiting for a result", () => {
  const waiting = {
    sessionId: "s-1",
    state: "submitted",
    committed: true,
    replay: null,
  }
  const done = {
    ...waiting,
    state: "settled",
    replay: { fault: null, code: null, counters: { motes: 3 }, endTick: 90 },
  }

  test("is final once the replay ran, or the run expired having sent nothing", () => {
    expect(isFinalResult(waiting as never)).toBe(false)
    expect(isFinalResult(done as never)).toBe(true)
    expect(
      isFinalResult({
        ...waiting,
        state: "expired",
        committed: false,
      } as never),
    ).toBe(true)
    expect(
      isFinalResult({ ...waiting, state: "expired", committed: true } as never),
    ).toBe(false)
  })

  test("asks again, through a request that got no answer, until it is final", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({ status: 200, body: waiting })
    page.answers.push({ unreachable: true })
    page.answers.push({ status: 200, body: done })
    const result = platform.awaitResult("s-1", { intervalMs: 100 })
    for (let i = 0; i < 3; i += 1) {
      await settle()
      page.advance(100)
    }
    expect(await result).toEqual(done as never)
  })

  test("a refusal ends the wait", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({
      status: 404,
      body: { error: "E_NOT_FOUND", message: "no" },
    })
    const error = (await caught(() =>
      platform.awaitResult("s-1"),
    )) as PlatformRefusal
    expect(error.code).toBe("E_NOT_FOUND")
  })

  test("an abort ends it too, between asks and before the first", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({ status: 200, body: waiting })
    const controller = new AbortController()
    const result = platform.awaitResult("s-1", { signal: controller.signal })
    await settle()
    controller.abort(new Error("left the page"))
    expect(String(await caught(() => result))).toContain("left the page")
    expect(
      String(
        await caught(() =>
          platform.awaitResult("s-1", { signal: controller.signal }),
        ),
      ),
    ).toContain("left the page")
  })

  test("asks with the run's own token when given one", async () => {
    const { page, client: platform } = await signedIn()
    platform.signOut()
    page.answers.push({ status: 200, body: done })
    expect(await platform.awaitResult("s-1", { token: "t-run" })).toEqual(
      done as never,
    )
    expect(page.sent.at(-1)?.headers.authorization).toBe("Bearer t-run")
  })

  test("with nobody signed in, there is no result to ask for", async () => {
    const { client: platform } = client()
    const error = (await caught(() =>
      platform.result("s-1"),
    )) as PlatformClientError
    expect(error.code).toBe("E_NOT_SIGNED_IN")
  })
})

describe("reads anyone may make", () => {
  test("the game, the board and a run read back, with the token when there is one", async () => {
    const anonymous = client()
    anonymous.page.answers.push({ status: 200, body: { day: "d" } })
    anonymous.page.answers.push({ status: 200, body: { rows: [] } })
    await anonymous.client.game()
    await anonymous.client.board()
    expect(anonymous.page.sent.map((s) => s.headers.authorization)).toEqual([
      undefined,
      undefined,
    ])

    const { page, client: platform } = await signedIn()
    page.answers.push({ status: 200, body: { rows: [] } })
    page.answers.push({ status: 200, body: { sessionId: "s-1" } })
    await platform.board({ period: "week", limit: 20, offset: 40 })
    await platform.watch("s-1")
    const [board, run] = page.sent.slice(-2)
    expect(board?.url.search).toBe("?period=week&limit=20&offset=40")
    expect(board?.headers.authorization).toBe("Bearer t-1")
    expect(run?.url.pathname).toBe("/v1/runs/s-1")
    expect(run?.headers.authorization).toBe("Bearer t-1")
  })
})

/**
 * The vbz.gg platform's public routes, as types.
 *
 * Public here means what a studio's own code calls: its game page, through a
 * page key, and its build system, through a secret key. The platform imports
 * these and declares its routes' answers with them, and a studio's code and
 * this package's own client call the routes through them, so no two of them
 * can disagree about a shape without one failing to compile.
 *
 * They live here rather than in the platform so the dependency runs one way:
 * the platform depends on this package, and this package on nothing of the
 * platform's. A change to a route's shape therefore lands here first, is
 * released, and is then taken by the platform.
 *
 * Types only. This subpath compiles to an empty module and adds nothing to a
 * bundle.
 *
 * Within `/v1` a change only adds: a field, a route, a refusal code. Anything
 * that would break a page already shipped against these is a new route.
 */

/** The header a page sends its page key in. */
export type PageKeyHeader = "x-vbz-key"

/** A key's prefix says which kind it is. */
export type PageKey = `vbz_pk_${string}`
export type SecretKey = `vbz_sk_${string}`

/** Every refusal arrives as one of these bodies, with a stable code. */
export interface ApiErrorBody {
  readonly error: string
  readonly message: string
  /** What this refusal was about, for a log rather than a person. */
  readonly detail?: Record<string, unknown>
}

/**
 * Every refusal a public route can answer, by name.
 *
 * A client switches on the code, never on the status. The platform holds its
 * refusal tables to this union at compile time, so a code it can answer and
 * this list does not name fails the platform's build.
 */
export type PublicRefusalCode =
  // Any route.
  /** The body or a query parameter is not the shape the route takes. */
  | "E_BAD_REQUEST"
  /** No route at that path. */
  | "E_NOT_FOUND"
  /** The platform failed. The answer says nothing more, on purpose. */
  | "E_INTERNAL"
  // Keys and pages.
  /** No key, or a key that does not resolve: unknown, revoked, expired, or its studio disabled. */
  | "E_UNAUTHORIZED"
  /** A page key used from a page its game does not allow, or with no `Origin`. */
  | "E_ORIGIN_NOT_ALLOWED"
  /** A page key presented where only a secret key or a member may act. */
  | "E_PAGE_KEY_CANNOT_UPLOAD"
  /** A secret key sent from a browser. It belongs in a build system. */
  | "E_SECRET_KEY_IN_BROWSER"
  // A studio's uploads and versions.
  | "E_NO_STUDIO"
  | "E_GAME_NOT_FOUND"
  | "E_NO_VERSION"
  /** A member without the permission the route needs. */
  | "E_NOT_PERMITTED"
  /** A member writing to a studio an operator disabled. */
  | "E_STUDIO_DISABLED"
  | "E_VERSION_EXISTS"
  /** The studio's uploads over the last 24 hours, all its games together. */
  | "E_QUOTA_EXCEEDED"
  | "E_MANIFEST_INVALID"
  | "E_CONTROLS_SCHEME_UNKNOWN"
  | "E_CONTROLS_SLOT_UNKNOWN"
  /** The manifest declares a data pack the simulation reads, which the platform cannot replay yet. */
  | "E_PACKS_UNSUPPORTED"
  | "E_ARTIFACT_NOT_UTF8"
  | "E_ARTIFACT_TOO_LARGE"
  | "E_SIM_NOT_SELF_CONTAINED"
  | "E_FRAME_IMPORT_MISSING"
  | "E_FRAME_IMPORT_UNEXPECTED"
  | "E_FRAME_DYNAMIC_IMPORT"
  | "E_FRAME_SPECIFIER_AMBIGUOUS"
  /** The platform could not rewrite the frame's import. Not reached in practice. */
  | "E_REWRITE_FAILED"
  // Player sign-in.
  | "E_SIGNIN_GRANT_INVALID"
  | "E_CODE_VERIFIER_INVALID"
  /** A run route called with no player token, or one that no longer works. */
  | "E_SIGN_IN_REQUIRED"
  // Starting a run.
  /** No version of the game is being served for this run. */
  | "E_NO_GAME"
  /** A ranked start, and the game has no round today. */
  | "E_NO_SEED_TODAY"
  | "E_PRACTICE_OFF"
  /**
   * A ranked run asked of a player who has started every ranked run the game
   * allows today. A practice run may still start, where the game offers one.
   */
  | "E_RANKED_RUNS_USED"
  // A run's chunks and its recording.
  | "E_NO_SESSION"
  | "E_SESSION_CLOSED"
  | "E_CHUNK_CONFLICT"
  | "E_CHUNK_NOT_FORWARD"
  | "E_TICK_CAP"
  | "E_RECORDING_MALFORMED"
  | "E_PINNED_MISMATCH"
  | "E_NO_CHUNKS"
  | "E_CHUNKS_INCOMPLETE"
  | "E_CHECKPOINT_CONTRADICTED"
  | "E_TIME_IMPOSSIBLE"

/** Where a version is in being checked. */
export type VersionState = "pending" | "rejected" | "published"

/** What the version a page should run today is. */
export interface PageGameVersion {
  readonly id: string
  readonly version: string
  /** The manifest as uploaded. */
  readonly manifest: unknown
  readonly manifestSha256: string
  /** The game document to put in the page's sandboxed frame. */
  readonly frameUrl: string
}

/** `GET /v1/game`: the game a page key names, and today's round. */
export interface PageGame {
  readonly game: {
    readonly id: string
    readonly slug: string
    readonly title: string
    /**
     * Whether a ranked run plays the day's seed, the same for everybody.
     * Off, each ranked run has a seed of its own.
     */
    readonly dailySeed: boolean
    /** Whether a page may start practice runs, which never reach a board. */
    readonly practice: boolean
    /**
     * How many ranked runs a player may start in a UTC day, or null for no
     * limit. Practice runs are not counted.
     */
    readonly rankedRunsPerDay: number | null
  }
  readonly studio: {
    readonly slug: string
    readonly name: string
  }
  /** The UTC day this answer is for. */
  readonly day: string
  /**
   * Today's round, or null when the game has none today: nothing published
   * yet, or the day's seed not written.
   */
  readonly today: {
    /**
     * A hash of the day's seed, published before play, revealed after. Null
     * for a game that does not use the day's seed.
     */
    readonly seedCommit: string | null
    readonly version: PageGameVersion
  } | null
}

/** `POST /v1/games/:gameId/versions`: an upload, accepted for checking. */
export interface UploadedVersion {
  readonly gameVersionId: string
  readonly version: string
  /** Always pending here: the checks decide, after the upload is answered. */
  readonly state: VersionState
  readonly simSha256: string
  readonly frameSha256: string
  readonly frameSourceSha256: string
  readonly manifestHash: string
  readonly manifestSha256: string
  readonly simUrl: string
  readonly frameUrl: string
}

/** A version as a studio's build system reads it back. */
export interface VersionStatus {
  readonly gameVersionId: string
  readonly gameId: string
  readonly version: string
  readonly state: VersionState
  /** The code the checks refused it with, when they did. */
  readonly rejectedCode: string | null
  /** The first check that failed, when one did. */
  readonly firstFailure: {
    readonly check: string
    readonly code: string
    readonly message: string
  } | null
  /** ISO 8601. Null until the checks finish. */
  readonly checkedAt: string | null
  /** Set while an operator has taken the version down. */
  readonly suspended: boolean
  readonly createdAt: string
}

/** `GET /v1/studios/:studioId/games/:gameId/versions`, newest first. */
export interface VersionStatusList {
  readonly versions: readonly VersionStatus[]
}

/**
 * `POST /v1/oauth/token`, traded from a game's page: a player signed in to
 * the page key's studio. The id is the player ID that studio sees, and no
 * studio sees a player's address.
 */
export interface SignedInPlayer {
  readonly token: string
  /** Seconds until the token expires. Every run start renews it. */
  readonly expiresIn: number
  readonly player: {
    readonly id: string
    /** One name per person, the same at every studio. */
    readonly displayName: string
  }
}

/** The body of `POST /v1/oauth/token`. */
export interface TokenRequest {
  readonly code: string
  readonly codeVerifier: string
  /** `dashboard`, or the page's page key. */
  readonly clientId: string
}

/** A ranked run reaches the board; a practice run is replayed and never does. */
export type RunMode = "ranked" | "practice"

/** The body of `POST /v1/runs`. Absent, or `practice` false, is a ranked run. */
export interface StartRunRequest {
  readonly practice?: boolean
}

/**
 * `POST /v1/runs`: a run of the key's game, started or found again.
 *
 * Starting again before any of a run has reached the server answers the same
 * run, which is what a refresh is. Once part of it has, starting again closes
 * it, settles it from what it committed, and answers a new run. `tickHz`,
 * `config` and the game's manifest hash are plain JSON here; the engine's own
 * types narrow them on the page.
 */
export interface StartedRun {
  readonly sessionId: string
  readonly mode: RunMode
  readonly day: string
  /**
   * How many more ranked runs the player may start today, this one counted.
   * Null for a practice run, and for a game that sets no limit.
   */
  readonly rankedRunsLeft: number | null
  readonly seed: string
  readonly config: Readonly<Record<string, string | number | boolean>>
  readonly game: {
    /** The version this run plays. */
    readonly id: string
    /**
     * The game document to put in the page's sandboxed frame for this run.
     * A practice run can play a version no round names, so this is the only
     * place a page learns where its frame is.
     */
    readonly frameUrl: string
    /** Compared against the frame's own before a tick runs. */
    readonly manifestHash: string
    readonly tickHz: number
    readonly maxTicks: number
    readonly maxWallSeconds: number
  }
  /** The player's token, renewed. Keep this one and drop the last. */
  readonly token: string
  readonly expiresIn: number
}

/**
 * The body of `POST /v1/runs/:id/chunks`: what happened in the run since the
 * last chunk, never the whole log so far.
 *
 * `throughTick` is the highest tick the chunk commits, and the next chunk may
 * carry nothing at or below it. The engine takes a tick's inputs before it
 * runs that tick and writes its checkpoint after, so while a run plays a page
 * commits through the tick before the last one the frame reported, or its
 * highest input tick if that is higher, and through the end tick once the run
 * has ended. Committing the last reported tick while the run plays gets the
 * next chunk refused for an input at that tick.
 */
export interface RunChunk {
  /** 0 for the first chunk, then 1, 2 and on. */
  readonly seq: number
  readonly throughTick: number
  /** The frame's checkpoints since the last chunk. */
  readonly checkpoints: ReadonlyArray<{
    readonly tick: number
    readonly hash: string
  }>
  /** The engine's input events since the last chunk, as the frame sent them. */
  readonly inputs: readonly unknown[]
  /** The frame's counters. Stored, and never ranked. */
  readonly counters?: Readonly<Record<string, number>>
}

/** `POST /v1/runs/:id/chunks`: one slice of the run, taken. */
export interface ChunkAccepted {
  readonly seq: number
  readonly throughTick: number
}

/**
 * `POST /v1/runs/:id/submit`: the recording, taken for replay. The score
 * comes from the replay, never from what was submitted. Sending the same
 * recording again answers the same.
 */
export interface SubmittedRun {
  readonly sessionId: string
  readonly recordingSha256: string
}

/** Which runs a board ranks: today's, the last seven days', or all of them. */
export type BoardPeriod = "day" | "week" | "all"

export interface BoardRow {
  readonly rank: number
  /** The player ID this studio sees. */
  readonly playerId: string
  readonly displayName: string
  readonly counters: Readonly<Record<string, number>>
  readonly day: string
  readonly sessionId: string
}

/** `GET /v1/board`: one page of a game's board. */
export interface Board {
  readonly gameId: string
  readonly period: BoardPeriod
  readonly from: string | null
  readonly to: string
  readonly total: number
  readonly rows: readonly BoardRow[]
  /** The reader's own row, wherever it is. Null when they have not played. */
  readonly you: BoardRow | null
  /** What the manifest ranks by, so a page can label the columns. */
  readonly rankBy: readonly string[]
  readonly tiePolicy: string
}

/** Where a run is now. */
export type RunState = "open" | "submitted" | "settled" | "faulted" | "expired"

/**
 * Why a replay did not count. `mismatch`: the replay reached a different
 * state from the recording. `log_fault`: the inputs could not be replayed,
 * for example they ran past the replay's time budget. `platform_fault`: the
 * platform failed before the replay ran, tried five times, and stopped, so
 * the run is final. While it is still trying, the run waits at `submitted`.
 */
export type RunFault = "mismatch" | "log_fault" | "platform_fault"

/**
 * `GET /v1/runs/:id/result`: the player's own run and what its replay
 * decided. Only that player reads it, with their token; to anybody else it is
 * the 404 a missing run is. It never carries the seed.
 *
 * `submitted` waits for a replay. `expired` is a run closed without a submit:
 * one that sent chunks is then replayed from them and moves on, and one that
 * sent none stays expired. So a page asks again until `replay` is set, or
 * until the run is `expired` with `committed` false.
 */
export interface RunResult {
  readonly sessionId: string
  readonly mode: RunMode
  readonly day: string
  readonly state: RunState
  /**
   * True when part of the run has reached the server. An open run with this
   * set cannot be played again from its first tick: starting again closes it
   * and settles it from what it committed.
   */
  readonly committed: boolean
  /**
   * Set once a replay has run. `fault` is null when it agreed, and then
   * `counters` and `endTick` are what it computed, which is what a board row
   * is written from. A run settled with nothing to replay, because what it
   * committed reached no tick, has neither. `code` names a log fault's cause.
   */
  readonly replay: {
    readonly fault: RunFault | null
    readonly code: string | null
    readonly counters: Readonly<Record<string, number>> | null
    readonly endTick: number | null
  } | null
}

/**
 * `GET /v1/runs/:id`: a settled run, with what a frame needs to play it
 * back. A run from a day still open is its player's alone. `inputs` are the
 * engine's own input events, which the engine reads.
 */
export interface WatchedRun {
  readonly sessionId: string
  readonly gameSlug: string
  readonly gameTitle: string
  readonly gameVersionId: string
  readonly day: string
  readonly counters: Readonly<Record<string, number>> | null
  readonly endTick: number | null
  readonly tickHz: number
  readonly maxTicks: number
  readonly seed: string
  readonly config: unknown
  readonly inputs: readonly unknown[]
}

/**
 * What a route needs. `page-key`: the page key in `x-vbz-key`, from one of the
 * game's allowed pages, and a player token in `Authorization: Bearer` where
 * the route reads one. `player`: both, the token required. `secret-key`: a
 * studio's secret key in `Authorization: Bearer`, never from a browser.
 * `public`: neither header.
 */
export type RouteAuth = "page-key" | "player" | "secret-key" | "public"

/**
 * Every public route, keyed by method and path, with what it takes and what
 * it answers. A path parameter is written `:name`.
 */
export interface PlatformRoutes {
  readonly "GET /v1/game": {
    readonly auth: "page-key"
    readonly body: never
    readonly response: PageGame
  }
  readonly "POST /v1/games/:gameId/versions": {
    readonly auth: "secret-key"
    /** Multipart: `manifest` (JSON), `sim` and `frame` (JavaScript). */
    readonly body: "multipart"
    readonly response: UploadedVersion
  }
  readonly "GET /v1/studios/:studioId/games/:gameId/versions": {
    readonly auth: "secret-key"
    readonly body: never
    readonly response: VersionStatusList
  }
  readonly "GET /v1/studios/:studioId/versions/:versionId": {
    readonly auth: "secret-key"
    readonly body: never
    readonly response: VersionStatus
  }
  readonly "POST /v1/oauth/token": {
    /** No key header: the page key travels in the body, as `clientId`. */
    readonly auth: "public"
    readonly body: TokenRequest
    readonly response: SignedInPlayer
  }
  readonly "POST /v1/runs": {
    readonly auth: "player"
    readonly body: StartRunRequest
    readonly response: StartedRun
  }
  readonly "POST /v1/runs/:id/chunks": {
    readonly auth: "player"
    readonly body: RunChunk
    readonly response: ChunkAccepted
  }
  readonly "POST /v1/runs/:id/submit": {
    readonly auth: "player"
    readonly body: { readonly recording: unknown }
    readonly response: SubmittedRun
  }
  readonly "GET /v1/runs/:id/result": {
    readonly auth: "player"
    readonly body: never
    readonly response: RunResult
  }
  readonly "GET /v1/runs/:id": {
    readonly auth: "page-key"
    readonly body: never
    readonly response: WatchedRun
  }
  readonly "GET /v1/board": {
    readonly auth: "page-key"
    readonly body: never
    readonly response: Board
  }
}

export type PlatformRoute = keyof PlatformRoutes

/**
 * `PlatformRoutes`, held to its own shape: this fails to compile when a route
 * names an `auth` that `RouteAuth` does not.
 */
export type CheckedRoutes = HeldTo<PlatformRoutes>
type HeldTo<
  T extends {
    readonly [Route in keyof T]: {
      readonly auth: RouteAuth
      readonly response: unknown
    }
  },
> = T

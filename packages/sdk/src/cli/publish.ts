/**
 * `vbz publish`: upload what `vbz build` wrote, then wait for the platform's
 * verdict.
 *
 * It is meant for a studio's build system, so everything it needs comes from
 * flags and the environment, and its exit code is the verdict: 0 when the
 * version went live, 1 for anything else. The studio's secret key is read
 * from the environment only. A flag would put it in shell history and in the
 * process list, where anybody on the machine can read it.
 *
 * Every decision is here rather than in the entry point, because the entry
 * point is excluded from the coverage floor.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  ApiErrorBody,
  PageKey,
  PlatformRoutes,
  SecretKey,
  UploadedVersion,
  VersionState,
  VersionStatus,
} from "../api/index.js"
import { DIST_DIR, DIST_FILES } from "../build/dist.js"

/** Where a studio's platform answers, unless a flag or the environment says. */
export const DEFAULT_API_ORIGIN = "https://studio.vbz.gg"

/** The environment variable holding the studio's secret key. */
export const STUDIO_KEY_VARIABLE = "VBZ_STUDIO_KEY"

/** The environment variable naming another platform, under `--api`. */
export const API_ORIGIN_VARIABLE = "VBZ_API_ORIGIN"

/** How long between two reads of a version still being checked. */
export const CHECK_POLL_MS = 2_000

/**
 * How long to wait for the checks before giving up on the answer. The checks
 * run the game in three engines, which takes minutes rather than seconds, and
 * a version still pending after this is still being checked: the command
 * says so and names the version, rather than claiming it failed.
 */
export const CHECK_WAIT_MS = 15 * 60_000

/** How long one upload may take to be answered. */
export const UPLOAD_TIMEOUT_MS = 120_000

/** How long one read of a version may take to be answered. */
export const READ_TIMEOUT_MS = 30_000

/**
 * The prefixes that say which kind a key is. Each is held to the key types in
 * `@vbz-gg/sdk/api` below, so a prefix that moved there fails to compile here
 * rather than refusing every real key.
 */
export const SECRET_KEY_PREFIX = "vbz_sk_"
export const PAGE_KEY_PREFIX = "vbz_pk_"
const _secretKeyPrefixHeld: SecretKey = `${SECRET_KEY_PREFIX}held`
const _pageKeyPrefixHeld: PageKey = `${PAGE_KEY_PREFIX}held`
void _secretKeyPrefixHeld
void _pageKeyPrefixHeld

/** Why a publish stopped. Each code names one thing to fix or to check. */
export const PUBLISH_ERROR = {
  /** No `--game`. */
  NO_GAME: "E_PUBLISH_NO_GAME",
  /** `VBZ_STUDIO_KEY` is unset or empty. */
  NO_KEY: "E_PUBLISH_NO_KEY",
  /** The key is not a studio's secret key. */
  NOT_A_SECRET_KEY: "E_PUBLISH_NOT_A_SECRET_KEY",
  /** The platform's origin is not one a key may be sent to. */
  BAD_API_ORIGIN: "E_PUBLISH_BAD_API_ORIGIN",
  /** `dist/` is missing a file `vbz build` writes. */
  NOT_BUILT: "E_PUBLISH_NOT_BUILT",
  /** The platform did not answer. */
  UNREACHABLE: "E_PUBLISH_UNREACHABLE",
  /** The platform answered with something that is not the route's answer. */
  ANSWER_UNREADABLE: "E_PUBLISH_ANSWER_UNREADABLE",
  /** The platform refused, with a code of its own. */
  REFUSED: "E_PUBLISH_REFUSED",
  /** The checks had not finished when the command stopped waiting. */
  STILL_CHECKING: "E_PUBLISH_STILL_CHECKING",
} as const

export type PublishErrorCode =
  (typeof PUBLISH_ERROR)[keyof typeof PUBLISH_ERROR]

export class PublishError extends Error {
  override readonly name = "PublishError"

  constructor(
    readonly code: PublishErrorCode,
    message: string,
    /** The platform's own code, when it refused. */
    readonly refusal?: string,
    /** The HTTP status the platform answered with, when it answered. */
    readonly status?: number,
  ) {
    super(`${message} (${code}${refusal === undefined ? "" : `, ${refusal}`})`)
  }
}

export interface PublishSettings {
  /** The game's directory; the upload is its `dist/`. */
  readonly dir: string
  readonly gameId: string
  /** An origin: scheme, host and port, nothing after. */
  readonly apiOrigin: string
  readonly key: SecretKey
}

/** What the command line and the environment said, before any of it is checked. */
export interface PublishInput {
  readonly dir: string
  readonly game: string | undefined
  readonly api: string | undefined
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
])

/**
 * Checks everything a publish needs before anything is read or sent.
 *
 * The origin is `--api`, else `VBZ_API_ORIGIN`, else the default. It has to
 * be https, because the request carries the studio's secret key; plain http
 * is allowed only to this machine, which is how the platform is run locally.
 */
export function publishSettings(
  input: PublishInput,
  env: Readonly<Record<string, string | undefined>>,
): PublishSettings {
  const gameId = input.game?.trim() ?? ""
  if (gameId === "") {
    throw new PublishError(
      PUBLISH_ERROR.NO_GAME,
      "say which game to publish to with --game <id>; the dashboard shows each game's id",
    )
  }
  return {
    dir: input.dir,
    gameId,
    apiOrigin: apiOriginOf(
      input.api ??
        setOrUndefined(env[API_ORIGIN_VARIABLE]) ??
        DEFAULT_API_ORIGIN,
    ),
    key: secretKeyOf(env[STUDIO_KEY_VARIABLE]),
  }
}

/**
 * A variable set to nothing reads as unset, as a CI system's optional
 * variable usually is. A flag given with nothing is still an error: somebody
 * typed it.
 */
function setOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? undefined : trimmed
}

function secretKeyOf(raw: string | undefined): SecretKey {
  const key = raw?.trim() ?? ""
  if (key === "") {
    throw new PublishError(
      PUBLISH_ERROR.NO_KEY,
      `set ${STUDIO_KEY_VARIABLE} to one of the studio's secret keys; it is read from the environment only, so it stays out of shell history`,
    )
  }
  if (!key.startsWith(SECRET_KEY_PREFIX)) {
    throw new PublishError(
      PUBLISH_ERROR.NOT_A_SECRET_KEY,
      key.startsWith(PAGE_KEY_PREFIX)
        ? `${STUDIO_KEY_VARIABLE} holds a page key, which may not upload; use one of the studio's secret keys`
        : `${STUDIO_KEY_VARIABLE} does not hold a studio's secret key, which starts ${SECRET_KEY_PREFIX}`,
    )
  }
  return key as SecretKey
}

function apiOriginOf(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw badOrigin(raw, "it is not a URL")
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  if (!secure) {
    throw badOrigin(
      raw,
      "the request carries the studio's secret key, so it must be https, or http to this machine",
    )
  }
  if (
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw badOrigin(raw, "give the origin alone, with no path, query or login")
  }
  return url.origin
}

function badOrigin(raw: string, why: string): PublishError {
  return new PublishError(
    PUBLISH_ERROR.BAD_API_ORIGIN,
    `the platform origin ${JSON.stringify(raw)} cannot be used: ${why}`,
  )
}

/** The three files an upload carries, as `vbz build` wrote them. */
export interface BuiltGame {
  readonly manifest: string
  readonly sim: Uint8Array<ArrayBuffer>
  readonly frame: Uint8Array<ArrayBuffer>
}

/** Reads `dist/`, naming a file that is missing. */
export async function readBuild(dir: string): Promise<BuiltGame> {
  const dist = join(dir, DIST_DIR)
  const read = async (name: string): Promise<Uint8Array<ArrayBuffer>> => {
    try {
      return new Uint8Array(await readFile(join(dist, name)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new PublishError(
          PUBLISH_ERROR.NOT_BUILT,
          `${join(dist, name)} is missing; run vbz build first`,
        )
      }
      throw error
    }
  }
  const [manifest, sim, frame] = await Promise.all([
    read(DIST_FILES.manifest),
    read(DIST_FILES.sim),
    read(DIST_FILES.frame),
  ])
  return { manifest: new TextDecoder().decode(manifest), sim, frame }
}

/** What a publish needs from the world, so a test can stand in for each. */
export interface PublishDeps {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  /** One line of progress, for a person watching a build log. */
  readonly log: (line: string) => void
}

type ResponseOf<Route extends keyof PlatformRoutes> =
  PlatformRoutes[Route]["response"]

/**
 * Uploads `dist/` and waits until the checks decide.
 *
 * The upload is sent once. A retried upload of a version that did arrive is
 * refused as `E_VERSION_EXISTS`, which would turn a slow answer into a
 * confusing one. Reading the verdict back is safe to repeat, so a read the
 * platform fails to answer is tried again until the wait runs out.
 */
export async function publish(
  settings: PublishSettings,
  deps: PublishDeps,
): Promise<VersionStatus> {
  const built = await readBuild(settings.dir)
  deps.log(`uploading ${join(settings.dir, DIST_DIR)} to ${settings.apiOrigin}`)

  const form = new FormData()
  form.append("manifest", built.manifest)
  form.append(
    "sim",
    new Blob([built.sim], { type: "text/javascript" }),
    DIST_FILES.sim,
  )
  form.append(
    "frame",
    new Blob([built.frame], { type: "text/javascript" }),
    DIST_FILES.frame,
  )

  const uploaded: ResponseOf<"POST /v1/games/:gameId/versions"> = asUploaded(
    await call(
      deps,
      `${settings.apiOrigin}/v1/games/${encodeURIComponent(settings.gameId)}/versions`,
      {
        method: "POST",
        headers: headersFor(settings),
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      },
    ),
  )
  deps.log(
    `uploaded version ${uploaded.version} as ${uploaded.gameVersionId}; the platform is checking it`,
  )

  const versionUrl = `${settings.apiOrigin}/v1/studios/${encodeURIComponent(uploaded.studioId)}/versions/${encodeURIComponent(uploaded.gameVersionId)}`
  const started = deps.now()
  for (;;) {
    const status = await readStatus(deps, settings, versionUrl)
    if (status !== undefined && status.state !== "pending") return status
    if (deps.now() - started >= CHECK_WAIT_MS) {
      throw new PublishError(
        PUBLISH_ERROR.STILL_CHECKING,
        `version ${uploaded.gameVersionId} was still being checked after ${CHECK_WAIT_MS / 60_000} minutes; read it later at ${versionUrl}`,
      )
    }
    await deps.sleep(CHECK_POLL_MS)
  }
}

/**
 * One read of the version, or undefined when the platform failed to answer
 * and the read is worth trying again. A refusal the platform meant, such as a
 * revoked key, stops the publish.
 */
async function readStatus(
  deps: PublishDeps,
  settings: PublishSettings,
  url: string,
): Promise<
  ResponseOf<"GET /v1/studios/:studioId/versions/:versionId"> | undefined
> {
  try {
    return asStatus(
      await call(deps, url, {
        method: "GET",
        headers: headersFor(settings),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      }),
    )
  } catch (error) {
    if (error instanceof PublishError && worthReadingAgain(error)) {
      deps.log(
        `the platform did not answer the read; trying again (${error.message})`,
      )
      return undefined
    }
    throw error
  }
}

/** An answer meaning "not now" rather than "no": asked to slow down. */
const TOO_MANY_REQUESTS = 429

function worthReadingAgain(error: PublishError): boolean {
  if (error.code === PUBLISH_ERROR.UNREACHABLE) return true
  return (
    error.status !== undefined &&
    (error.status >= 500 || error.status === TOO_MANY_REQUESTS)
  )
}

function headersFor(settings: PublishSettings): Record<string, string> {
  return {
    authorization: `Bearer ${settings.key}`,
    accept: "application/json",
  }
}

/**
 * One request, answered with its parsed body, or a `PublishError` naming
 * what went wrong: no answer, a refusal with the platform's code, or an
 * answer that is not JSON.
 */
async function call(
  deps: PublishDeps,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  // The body is read inside the same guard as the request: the timeout covers
  // both, and an answer that breaks off halfway is no more an answer than one
  // that never started.
  let response: Response
  let text: string
  try {
    response = await deps.fetch(url, init)
    text = await response.text()
  } catch (error) {
    throw new PublishError(
      PUBLISH_ERROR.UNREACHABLE,
      `no answer from ${new URL(url).origin}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    throw new PublishError(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
      `the platform answered ${response.status} with something that is not JSON`,
      undefined,
      response.status,
    )
  }
  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new PublishError(
        PUBLISH_ERROR.REFUSED,
        `the platform refused: ${body.message}`,
        body.error,
        response.status,
      )
    }
    throw new PublishError(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
      `the platform answered ${response.status} without saying why`,
      undefined,
      response.status,
    )
  }
  return body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    isRecord(value) &&
    typeof value.error === "string" &&
    typeof value.message === "string"
  )
}

/**
 * The upload's answer, which has to name the version and its studio for the
 * verdict to be read back. When it does not, the version was still stored,
 * so the error names it: sending the same build again would be refused as a
 * version that exists.
 */
function asUploaded(value: unknown): UploadedVersion {
  if (
    isRecord(value) &&
    typeof value.gameVersionId === "string" &&
    typeof value.studioId === "string" &&
    typeof value.version === "string"
  ) {
    return value as unknown as UploadedVersion
  }
  const stored =
    isRecord(value) && typeof value.gameVersionId === "string"
      ? ` It was stored as ${value.gameVersionId}; its verdict is on the dashboard.`
      : ""
  throw new PublishError(
    PUBLISH_ERROR.ANSWER_UNREADABLE,
    `the platform accepted the upload but its answer does not name the version and its studio, so the verdict cannot be read back.${stored}`,
  )
}

const VERSION_STATES: ReadonlySet<string> = new Set<VersionState>([
  "pending",
  "rejected",
  "published",
])

/**
 * A version's state, checked in every field the verdict reads. A missing
 * `suspended` would otherwise read as served, and a missing `firstFailure`
 * would crash the line that prints it.
 */
function asStatus(value: unknown): VersionStatus {
  if (
    isRecord(value) &&
    typeof value.gameVersionId === "string" &&
    typeof value.version === "string" &&
    typeof value.state === "string" &&
    VERSION_STATES.has(value.state) &&
    typeof value.suspended === "boolean" &&
    (value.rejectedCode === null || typeof value.rejectedCode === "string") &&
    (value.firstFailure === null || isFailure(value.firstFailure))
  ) {
    return value as unknown as VersionStatus
  }
  throw new PublishError(
    PUBLISH_ERROR.ANSWER_UNREADABLE,
    "the platform's answer about the version is not a version's state",
  )
}

function isFailure(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.check === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  )
}

/** What to print for a decided version, and the exit code it means. */
export interface Verdict {
  readonly lines: readonly string[]
  readonly exitCode: 0 | 1
}

/**
 * The verdict a build log shows. Only a version players can be served exits
 * 0: one an operator has taken down is published and still not live.
 */
export function verdictOf(status: VersionStatus): Verdict {
  if (status.state === "pending") {
    throw new Error("a version still being checked has no verdict yet")
  }
  if (status.state === "published") {
    if (status.suspended) {
      return {
        lines: [
          `published version ${status.version}, but an operator has taken it down, so no player is served it`,
        ],
        exitCode: 1,
      }
    }
    return { lines: [`published version ${status.version}`], exitCode: 0 }
  }
  const lines = [
    `rejected version ${status.version}: ${status.rejectedCode ?? "no code given"}`,
  ]
  if (status.firstFailure !== null) {
    const { check, code, message } = status.firstFailure
    lines.push(`first failure: ${check}, ${code}: ${message}`)
  }
  return { lines, exitCode: 1 }
}

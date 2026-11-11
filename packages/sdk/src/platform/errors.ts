/**
 * What can go wrong talking to the platform, as two kinds.
 *
 * A `PlatformRefusal` is the platform's own answer: a code from
 * `PublicRefusalCode`, the status it always comes with, a sentence a person
 * can read and a detail for a log. A `PlatformClientError` is this client
 * failing before or around a request: a popup the browser blocked, a request
 * that got no answer, a frame serving another game. Both carry a `code` a page
 * switches on, and the two code sets never overlap.
 */

import type { PublicRefusalCode } from "../api/index.js"

export class PlatformRefusal extends Error {
  readonly code: PublicRefusalCode
  readonly status: number
  readonly detail: Readonly<Record<string, unknown>> | undefined

  constructor(
    status: number,
    body: {
      readonly error: PublicRefusalCode
      readonly message: string
      readonly detail?: Readonly<Record<string, unknown>>
    },
  ) {
    super(body.message)
    this.name = "PlatformRefusal"
    this.code = body.error
    this.status = status
    this.detail = body.detail
  }
}

/** Every failure this client raises itself, with what it means. */
export const CLIENT_ERROR = {
  /** The browser did not open the sign-in window: `signIn()` ran outside a click. */
  E_POPUP_BLOCKED:
    "the browser blocked the sign-in window; call signIn() from a click handler, before anything is awaited",
  /** The sign-in window closed without handing a code over. */
  E_SIGNIN_CLOSED:
    "the sign-in window closed before a player signed in; if it closed by itself at once, check the page does not send Cross-Origin-Opener-Policy: same-origin",
  /** A player route, and no player is signed in on this page. */
  E_NOT_SIGNED_IN: "no player is signed in on this page",
  /** `fetch` threw: the request may or may not have reached the platform. */
  E_UNREACHABLE: "the platform did not answer",
  /** An answer that is not JSON, or a failure with no code in it. */
  E_ANSWER_UNREADABLE: "the platform's answer could not be read",
  /** The frame reported another manifest than the one the run was issued for. */
  E_WRONG_GAME:
    "the frame serves another version of the game than the one this run plays",
  /** The run's tick rate is not one the engine runs at. */
  E_TICK_RATE_UNSUPPORTED: "the run's tick rate is not 30, 60 or 120",
  /** The frame's recording did not parse as JSON. */
  E_RECORDING_UNREADABLE: "the frame's recording could not be read",
  /** The frame posted an error of its own. */
  E_FRAME_FAILED: "the game's frame reported an error",
  /** An error this client has no code for: a bug to report, with its detail. */
  E_UNEXPECTED: "the run met an error the client has no code for",
} as const

export type ClientErrorCode = keyof typeof CLIENT_ERROR

/**
 * Fails to compile when a client code is also one the platform answers, so a
 * page's `switch` on `code` never has one case meaning two things.
 */
type Shared = Extract<ClientErrorCode, PublicRefusalCode>
export const NO_CODE_IS_BOTH: [Shared] extends [never] ? true : Shared = true

export class PlatformClientError extends Error {
  readonly code: ClientErrorCode
  /** The HTTP status, for an answer that came back unreadable. */
  readonly status: number | undefined

  constructor(
    code: ClientErrorCode,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(CLIENT_ERROR[code], { cause: options.cause })
    this.name = "PlatformClientError"
    this.code = code
    this.status = options.status
  }
}

/**
 * Whether the same request is worth sending again.
 *
 * One that got no answer may not have reached the platform, and one the
 * platform failed on left nothing behind, so the same body goes again: every
 * run write takes the same body twice with no harm. A refusal is the
 * platform's answer to that body, and sending it again gets the same answer.
 */
export function worthRetrying(error: unknown): boolean {
  if (error instanceof PlatformRefusal) return error.status >= 500
  if (!(error instanceof PlatformClientError)) return false
  // A proxy's own 502, 503 or 504 page is not JSON, and the platform behind
  // it may never have seen the request.
  return (
    error.code === "E_UNREACHABLE" ||
    (error.code === "E_ANSWER_UNREADABLE" && (error.status ?? 0) >= 500)
  )
}

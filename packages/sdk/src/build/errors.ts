/**
 * Why a pair of artifacts was refused.
 *
 * One code per refusal, so a deploy script can switch on it and a host can map
 * it to a status from a table rather than a chain of instanceof checks. The
 * arcade reports the same codes for an upload it refuses, because it runs
 * these same checks on the bytes it was given.
 */

export const BUILD_REFUSAL = {
  /** An artifact is not valid UTF-8, so its bytes and its module disagree. */
  ARTIFACT_NOT_UTF8: "E_ARTIFACT_NOT_UTF8",
  ARTIFACT_TOO_LARGE: "E_ARTIFACT_TOO_LARGE",
  /** The sim imports something. It runs with no network and would fault. */
  SIM_NOT_SELF_CONTAINED: "E_SIM_NOT_SELF_CONTAINED",
  /** The frame has no sim import, so it carries its own copy. */
  FRAME_IMPORT_MISSING: "E_FRAME_IMPORT_MISSING",
  /** The frame imports something besides the sim. */
  FRAME_IMPORT_UNEXPECTED: "E_FRAME_IMPORT_UNEXPECTED",
  /** A dynamic import would choose its module at runtime, past the scan. */
  FRAME_DYNAMIC_IMPORT: "E_FRAME_DYNAMIC_IMPORT",
  /** The specifier also appears as data, so rewriting it would change it. */
  FRAME_SPECIFIER_AMBIGUOUS: "E_FRAME_SPECIFIER_AMBIGUOUS",
  /** The rewrite did not produce what it promised. */
  REWRITE_FAILED: "E_REWRITE_FAILED",
} as const

export type BuildRefusalCode =
  (typeof BUILD_REFUSAL)[keyof typeof BUILD_REFUSAL]

export class BuildRefusal extends Error {
  readonly code: BuildRefusalCode

  constructor(code: BuildRefusalCode, detail: string) {
    super(detail)
    this.name = "BuildRefusal"
    this.code = code
  }
}

export function refuse(code: BuildRefusalCode, detail: string): never {
  throw new BuildRefusal(code, detail)
}

/**
 * Building a game into the two artifacts an upload carries.
 *
 * This half runs under bun and reaches its bundler, so it is a separate
 * subpath from `/controls`: a browser bundle importing the renderer must not
 * drag any of this in.
 */

export {
  buildGameArtifacts,
  type GameArtifacts,
  type GameSource,
} from "./build"
export {
  assertFrameImportsOnlySim,
  assertRewritten,
  assertSimSelfContained,
  assertSize,
  countQuoted,
  decodeArtifact,
  MAX_FRAME_BYTES,
  MAX_SIM_BYTES,
  rewriteSimImport,
  SIM_PATH,
  SIM_SPECIFIER,
  simPathFor,
} from "./contract"
export { sha256Hex } from "./digest"
export {
  BUILD_REFUSAL,
  BuildRefusal,
  type BuildRefusalCode,
} from "./errors"

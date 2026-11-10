/**
 * A game, built and addressed the way a platform stores it.
 *
 * Builds the two artifacts, hashes each, rewrites the frame's `cw2:sim`
 * import to the simulation's content address, and hashes the frame after that
 * rewrite rather than before. The order is the point: a stored frame's hash is
 * taken over bytes that already name one simulation, so a frame can name
 * exactly one sim, forever.
 *
 * This is the same sequence the arcade performs on an upload, which is why the
 * harness serves what production would serve rather than something that
 * resembles it.
 */

import {
  buildGameArtifacts,
  decodeArtifact,
  type GameSource,
  rewriteSimImport,
  sha256Hex,
  simPathFor,
} from "../build/index.js"

export interface BuiltGame {
  readonly sim: Uint8Array
  readonly simSha256: string
  /** The frame as stored: its sim import already points at `simSha256`. */
  readonly frame: Uint8Array
  readonly frameSha256: string
  /** The frame as the build produced it, before the rewrite. */
  readonly frameSourceSha256: string
}

export async function buildAndAddress(source: GameSource): Promise<BuiltGame> {
  const { sim, frame } = await buildGameArtifacts(source)

  const simSha256 = sha256Hex(sim)
  const frameSourceSha256 = sha256Hex(frame)

  const rewritten = new TextEncoder().encode(
    rewriteSimImport(decodeArtifact(frame, "frame"), simPathFor(simSha256)),
  )

  return {
    sim,
    simSha256,
    frame: rewritten,
    frameSha256: sha256Hex(rewritten),
    frameSourceSha256,
  }
}

/** Where each artifact is served from, given its hash. */
export function blobKeys(built: BuiltGame): {
  readonly sim: string
  readonly frame: string
} {
  return {
    sim: `sim/${built.simSha256}.js`,
    frame: `frame/${built.frameSha256}.js`,
  }
}

/**
 * Building a game's source into the two artifacts an upload carries.
 *
 * The arcade takes built bundles and never source, so this is not a step it
 * runs - it is how an author produces what they upload, and how the harness
 * produces what it serves locally. Anyone is free to build another way: what
 * has to be reproduced is the shape of the output, which `contract.ts`
 * describes and the arcade re-checks on arrival.
 */

import {
  assertFrameImportsOnlySim,
  assertSimSelfContained,
  assertSize,
  decodeArtifact,
  MAX_FRAME_BYTES,
  MAX_SIM_BYTES,
  SIM_SPECIFIER,
} from "./contract.js"

export interface GameSource {
  /** Absolute path to the game directory. */
  readonly root: string
  /** The simulation's entry, relative to the root. */
  readonly simEntry: string
  /** The frame's entry, relative to the root. */
  readonly frameEntry: string
}

export interface GameArtifacts {
  readonly sim: Uint8Array
  readonly frame: Uint8Array
}

/**
 * Two bundles, in memory.
 *
 * Each is `bun build` run with the game's own directory as the working
 * directory, writing to stdout. A subprocess rather than `Bun.build`, because
 * the programmatic bundler seeds bare-specifier resolution from the calling
 * module's location: the same tree then builds from the game's directory and
 * fails to resolve its own dependencies from a test three directories away,
 * which would make an artifact's hash depend on where the build was invoked.
 * It is also exactly what a submitter runs.
 *
 * `--target=browser` for both. The simulation has to run in a browser and in a
 * Workers isolate, and the browser conditions are the ones that keep node
 * builtins out of the graph.
 *
 * Nothing passes the `development` export condition. `@clockwork2/engine` maps
 * that to its TypeScript sources, so resolving through it would bundle
 * different bytes from the published `dist`.
 *
 * The contract runs against the output here as well as at publish, so a build
 * that quietly inlined the simulation fails where the person who caused it is
 * standing rather than in somebody's upload.
 */
export async function buildGameArtifacts(
  source: GameSource,
): Promise<GameArtifacts> {
  const sim = await bundle(source.root, source.simEntry, [])
  const simText = decodeArtifact(sim, "simulation")
  assertSize(sim, MAX_SIM_BYTES, "simulation")
  assertSimSelfContained(simText)

  // Bun never resolves an external bare specifier, so the specifier reaches
  // the output verbatim and no plugin is involved.
  const frame = await bundle(source.root, source.frameEntry, [SIM_SPECIFIER])
  const frameText = decodeArtifact(frame, "frame")
  assertSize(frame, MAX_FRAME_BYTES, "frame")
  assertFrameImportsOnlySim(frameText)

  return { sim, frame }
}

async function bundle(
  root: string,
  entry: string,
  external: readonly string[],
): Promise<Uint8Array> {
  const command = [
    "bun",
    "build",
    `./${entry}`,
    "--target=browser",
    "--format=esm",
    "--minify",
    ...external.flatMap((name) => ["--external", name]),
  ]

  const child = Bun.spawn(command, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "production" },
  })

  const [out, err, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  if (code !== 0) {
    throw new Error(`build failed for ${entry} in ${root}:\n${err.trim()}`)
  }
  if (out.byteLength === 0) {
    throw new Error(`build of ${entry} in ${root} produced nothing`)
  }
  return new Uint8Array(out)
}

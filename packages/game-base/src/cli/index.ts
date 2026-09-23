#!/usr/bin/env bun
/**
 * `game-base`, the two commands an author runs.
 *
 * `build` produces the three files an upload carries. `dev` serves the game
 * the way the arcade serves it, on two origins, so the first time a game meets
 * a sandboxed cross-origin frame is on a laptop.
 *
 * Entry points are excluded from the coverage floor, so everything with a
 * decision in it lives beside this file rather than in it.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { buildGameArtifacts, type GameSource } from "../build/index.js"
import {
  DEFAULT_FRAME_PORT,
  DEFAULT_HOST_PORT,
  startHarness,
} from "../harness/index.js"
import { type Options, parseArgs } from "./args.js"
import { readManifestFromSim } from "./manifest.js"
import { createGame } from "./new.js"

const USAGE = `game-base - build and run a game the vbz arcade can take

  game-base new   [dir]    copy a game that already conforms, and rename it
  game-base build [dir]    write dist/sim.js, dist/frame.js and dist/manifest.json
  game-base dev   [dir]    serve the game the way the arcade does

  --sim <path>     the simulation's entry   (default src/sim/index.ts)
  --frame <path>   the frame's entry        (default src/frame.ts)
  --host <port>    the page that frames it  (default ${DEFAULT_HOST_PORT})
  --frame-port <p> the game's own origin    (default ${DEFAULT_FRAME_PORT})
`

function sourceOf(options: Options): GameSource {
  return {
    root: options.dir,
    simEntry: options.simEntry,
    frameEntry: options.frameEntry,
  }
}

/**
 * Writes the three files an upload carries.
 *
 * The frame is written unrewritten, with its `cw2:sim` specifier intact. The
 * host rewrites it to the simulation's content address on the way in, so a
 * frame that arrived already pointing somewhere would be a frame naming a
 * module nobody checked.
 */
async function build(options: Options): Promise<void> {
  const { sim, frame } = await buildGameArtifacts(sourceOf(options))
  const manifest = await readManifestFromSim(sim)
  const dist = join(options.dir, "dist")
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  await writeFile(join(dist, "sim.js"), sim)
  await writeFile(join(dist, "frame.js"), frame)
  await writeFile(
    join(dist, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  process.stdout.write(
    `sim ${sim.byteLength} bytes, frame ${frame.byteLength} bytes\n`,
  )
}

async function dev(options: Options): Promise<void> {
  // Built first, so the manifest beside the artifacts is this build's.
  await build(options)
  const harness = await startHarness({
    source: sourceOf(options),
    hostPort: options.hostPort,
    framePort: options.framePort,
  })
  process.stdout.write(
    `\n  play    ${harness.hostOrigin}\n` +
      `  game    ${harness.frameOrigin}\n` +
      `  sim     ${harness.built.simSha256.slice(0, 12)}\n` +
      `  frame   ${harness.built.frameSha256.slice(0, 12)}\n\n` +
      "  Ctrl-C to stop.\n",
  )
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  switch (options.command) {
    case "new": {
      const made = await createGame({ dir: options.dir })
      process.stdout.write(
        `${made.dir}\n\n` +
          `  ${made.id}, which is the id its board will be kept under\n\n` +
          "  bun install\n" +
          "  bun run dev\n\n",
      )
      return 0
    }
    case "build":
      await build(options)
      return 0
    case "dev":
      await dev(options)
      // Resolves only when the process is killed: the servers are the point.
      await new Promise(() => {})
      return 0
    default:
      process.stdout.write(USAGE)
      return options.command === "" ? 0 : 1
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code)
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`)
      process.exit(1)
    })
}

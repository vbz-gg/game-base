/**
 * The harness: your game, framed the way the arcade frames it.
 *
 * It builds the two real artifacts, serves them content-addressed behind a
 * frame document with the arcade's sandbox and CSP, and serves a page on a
 * second origin that frames it. The point is that the first time a game meets
 * a sandboxed cross-origin frame should be on a laptop rather than in an
 * upload.
 *
 * What it does not do is replay, settle or rank. That is the arcade's half,
 * and a harness that pretended to do it would be teaching an author about a
 * server that does not exist.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { GameSource } from "../build"
import { type BuiltGame, buildAndAddress } from "./artifacts"
import { harnessPage } from "./page/document"
import { startFrameServer, startHostServer } from "./servers"

export interface HarnessOptions {
  readonly source: GameSource
  readonly hostPort?: number
  readonly framePort?: number
  /** The seed the run is played on. Fixed, so a session is repeatable. */
  readonly seed?: string
  /** Every path the frame origin was asked for, for a test. */
  readonly onRequest?: (path: string) => void
}

export interface Harness {
  readonly hostOrigin: string
  readonly frameOrigin: string
  readonly built: BuiltGame
  stop(): Promise<void>
}

/** What the harness needs from the game's manifest to start a session. */
interface HarnessManifest {
  readonly name?: string
  readonly session?: { readonly tickHz?: number; readonly maxTicks?: number }
  readonly inputs?: { readonly controls?: unknown }
}

export const DEFAULT_HOST_PORT = 4310
export const DEFAULT_FRAME_PORT = 4311

/**
 * A seed that does not move between runs.
 *
 * The arcade's is a keyed HMAC of the day, so every player gets the same one;
 * here a constant does the same job, which is that a run an author is
 * debugging is the run they had a moment ago.
 */
export const HARNESS_SEED = "harness"

export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const built = await buildAndAddress(options.source)
  const manifest = await readManifest(options.source.root)

  const title = manifest.name ?? "Game"

  // Bound first, because each server has to be told the other's origin and an
  // origin is the port the socket got rather than the port it was asked for.
  // The host's page is written last, once both are known.
  const host = startHostServer({
    port: options.hostPort ?? DEFAULT_HOST_PORT,
    script: await bundlePage(),
  })

  const frame = startFrameServer({
    port: options.framePort ?? DEFAULT_FRAME_PORT,
    title,
    built,
    // Only the harness page may frame it, which is what the arcade says of
    // its own shell. A game that works here against a real `frame-ancestors`
    // will not be surprised by one in production.
    siteOrigins: [host.origin],
    ...(options.onRequest === undefined ? {} : { log: options.onRequest }),
  })

  host.setPage(
    harnessPage({
      title,
      config: {
        frameOrigin: frame.origin,
        title,
        seed: options.seed ?? HARNESS_SEED,
        tickHz: manifest.session?.tickHz ?? 60,
        maxTicks: manifest.session?.maxTicks ?? 36000,
        config: null,
        controls: manifest.inputs?.controls ?? null,
      },
    }),
  )

  return {
    hostOrigin: host.origin,
    frameOrigin: frame.origin,
    built,
    stop: async () => {
      await Promise.all([host.stop(), frame.stop()])
    },
  }
}

/**
 * The manifest, read from the game's built output rather than imported.
 *
 * Importing the simulation to reach its `MANIFEST` would run a stranger's
 * module in this process. The build writes the manifest beside the artifacts
 * for exactly this reason.
 */
async function readManifest(root: string): Promise<HarnessManifest> {
  try {
    const text = await readFile(join(root, "dist", "manifest.json"), "utf8")
    return JSON.parse(text) as HarnessManifest
  } catch {
    return {}
  }
}

/** The parent page's script, bundled for the browser at start. */
async function bundlePage(): Promise<string> {
  const entry = join(import.meta.dir, "page", "main.ts")
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: false,
  })
  if (!result.success) {
    throw new Error(
      `the harness page did not build:\n${result.logs.map(String).join("\n")}`,
    )
  }
  const output = result.outputs[0]
  if (output === undefined) throw new Error("the harness page produced nothing")
  return await output.text()
}

export {
  type BuiltGame,
  blobKeys,
  buildAndAddress,
} from "./artifacts"
export { harnessPage } from "./page/document"
export {
  type RunningHostServer,
  type RunningServer,
  startFrameServer,
  startHostServer,
} from "./servers"

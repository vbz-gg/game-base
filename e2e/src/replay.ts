#!/usr/bin/env bun
/**
 * Replays a recording, in a process that can load the engine.
 *
 * It runs under bun rather than inside the Playwright runner, because
 * `@clockwork2/engine`'s built output imports its own files without
 * extensions - `from "./bits"` rather than `from "./bits.js"` - which a
 * bundler and bun both resolve and plain node ESM does not. Importing the
 * engine from a spec fails with ERR_MODULE_NOT_FOUND on the engine's first
 * relative import, measured on 0.6.0 under node 22.
 *
 * It reads `{ sim, recording }` on stdin - a URL to fetch the simulation
 * from, and the encoded recording - and writes what the replay found. The
 * simulation is fetched at its content address rather than read from the
 * source tree, so what runs here is the module the browser ran.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  compareToRecording,
  type GameModule,
  type Manifest,
  type PlainValue,
  RecordedInputSource,
  runSession,
} from "@clockwork2/engine"
import { decodeRecording } from "@clockwork2/engine/recording"

const request = (await new Response(Bun.stdin).json()) as {
  readonly sim: string
  readonly recording: string
}

// Decoding is itself a check: the format, the version and the shape of every
// input are what a platform would refuse a submission over.
const recording = decodeRecording(request.recording)

const source = await (await fetch(request.sim)).text()
const dir = await mkdtemp(join(tmpdir(), "game-base-replay-"))
try {
  const file = join(dir, "sim.js")
  await writeFile(file, source)
  const loaded = (await import(file)) as {
    default: () => GameModule<unknown, PlainValue>
    MANIFEST: Manifest
  }
  const replayed = runSession<unknown, PlainValue>({
    module: loaded.default(),
    seed: recording.seed,
    config: recording.config,
    inputs: new RecordedInputSource(recording.inputs),
    // The log ends where the player stopped. Without the cap the replay runs
    // past it and reports a different end tick for a run that never diverged.
    maxTicks: Math.max(recording.endTick, 1),
    checkpointEvery: recording.tickHz,
    counters: loaded.MANIFEST.counters,
  })
  process.stdout.write(
    JSON.stringify({
      endTick: replayed.endTick,
      terminal: replayed.terminal,
      counters: replayed.counters,
      comparison: compareToRecording(recording, replayed),
    }),
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}

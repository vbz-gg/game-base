/**
 * What a spec does with a harness: open it, play it, read what it recorded.
 *
 * These run under node, because Playwright's runner does. Until engine 0.7.1
 * that ruled the engine out entirely - its built output imported its own
 * files without extensions, which bun and every bundler resolve and plain
 * node ESM does not - and the replay ran in a bun subprocess. It no longer
 * has to.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  compareToRecording,
  decodeRecording,
  type GameModule,
  type Manifest,
  type PlainValue,
  RecordedInputSource,
  runSession,
} from "@clockwork2/engine"
import { expect, type Page } from "@playwright/test"
import { CONTROL_ORIGIN, hostOrigin, type SubjectName } from "./env"

export interface SubjectInfo {
  readonly hostOrigin: string
  readonly frameOrigin: string
  /** The path the artifact is served at, which is its own content address. */
  readonly sim: string
  readonly frame: string
}

/** As much of a recording as a spec reads. The engine owns the whole shape. */
export interface RecordedRun {
  readonly format: string
  readonly version: number
  readonly gameId: string
  readonly seed: string
  readonly tickHz: number
  readonly endTick: number
  readonly inputs: readonly {
    readonly tick: number
    readonly device: string
    readonly code: string
    readonly value: number
  }[]
  readonly checkpoints: readonly {
    readonly tick: number
    readonly hash: string
  }[]
}

/**
 * How a recording's checkpoints fall against whole seconds of play.
 *
 * A platform replays with one checkpoint per second, plus one on the tick the
 * run ended, so a frame that wrote them at any other interval disagrees with
 * every replay of every run. `seconds` counts the ones before the end, so a
 * test can refuse a run too short to show the interval at all.
 */
export function checkpointCadence(recording: RecordedRun): {
  readonly seconds: number
  readonly off: readonly number[]
} {
  const before = recording.checkpoints
    .map((checkpoint) => checkpoint.tick)
    .filter((tick) => tick !== recording.endTick)
  return {
    seconds: before.length,
    off: before.filter((tick) => tick % recording.tickHz !== 0),
  }
}

let known: Record<SubjectName, SubjectInfo> | null = null

/** Where each subject ended up, asked once and remembered. */
export async function subjects(): Promise<Record<SubjectName, SubjectInfo>> {
  if (known === null) {
    const response = await fetch(`${CONTROL_ORIGIN}/subjects`)
    known = (await response.json()) as Record<SubjectName, SubjectInfo>
  }
  return known
}

/** Opens the harness page and waits for the frame to finish its handshake. */
export async function open(page: Page, name: SubjectName): Promise<void> {
  await page.goto(hostOrigin(name))
  // `ready` is the frame saying its module loaded and its manifest is here.
  // Reaching it at all is the CORS assertion: the frame's own script is
  // cross-origin to an opaque origin, so without
  // `access-control-allow-origin: *` nothing loads and nothing says so.
  await expect(page.locator("#status")).toHaveText("ready")
}

/** Waits until the simulation has run at least `tick` ticks. */
export async function waitForTick(page: Page, tick: number): Promise<void> {
  await page.waitForFunction((at) => {
    const status = document.querySelector("#status")?.textContent ?? ""
    const match = /^tick (\d+)/.exec(status)
    return match !== null && Number(match[1]) >= at
  }, tick)
}

/** Starts the run and waits until the simulation has actually ticked. */
export async function play(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start" }).click()
  await expect(page.locator("#status")).toHaveText(/^tick [1-9]/)
}

export interface Run {
  readonly result: {
    readonly tick: number
    readonly counters: Record<string, number>
    readonly reason: string
  }
  /** The recording as the page published it, for handing to a replay. */
  readonly encoded: string
  readonly recording: RecordedRun
}

/**
 * Ends the run and reads what it produced.
 *
 * The page publishes the recording only once every piece of it has arrived,
 * so waiting on `body[data-run="recorded"]` is waiting for a whole one.
 */
export async function endRun(page: Page): Promise<Run> {
  await page.getByRole("button", { name: "End" }).click()
  await page.waitForSelector('body[data-run="recorded"]')
  const raw = (await page.locator("#run").textContent()) ?? ""
  const parsed = JSON.parse(raw) as {
    readonly result: Run["result"]
    readonly recording: string
  }
  return {
    result: parsed.result,
    encoded: parsed.recording,
    recording: JSON.parse(parsed.recording) as RecordedRun,
  }
}

/**
 * A point inside the framed game, as a fraction of it.
 *
 * Measured rather than assumed: the frame is not the viewport - on the phone
 * this suite emulates it is 412 by 839 inside a 412 by 915 window - and a
 * touch a few pixels below it lands on the page behind and reaches the game
 * as nothing at all. The fractions also map straight onto the simulation's
 * own space, since the frame hands `InputCapture` a viewport the width of the
 * playfield: 0.15 across is about 150 units in.
 */
export async function framePoint(
  page: Page,
  fx: number,
  fy: number,
): Promise<{ readonly x: number; readonly y: number }> {
  const box = await page.locator("#stage iframe").boundingBox()
  if (box === null) throw new Error("the game is not framed")
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

/** Every action in the log, in order, as `action=value` pairs. */
export function log(run: Run): string[] {
  return run.recording.inputs.map((input) => `${input.code}=${input.value}`)
}

export interface Replayed {
  readonly endTick: number
  readonly terminal: string
  readonly counters: Record<string, number>
  readonly comparison: {
    readonly matches: boolean
    readonly divergedAt: number | null
    readonly differences: readonly string[]
  }
}

/**
 * Replays a run against the very bytes the browser loaded.
 *
 * The simulation is fetched from the frame origin at its content address
 * rather than imported from the source tree, so what runs here is the module
 * the page ran and not a second build of the same file. Decoding the
 * recording is itself a check: the format, the version and the shape of every
 * input are what a platform would refuse a submission over.
 *
 * It is written as `.mjs` and not `.js`. A temp directory has no package.json
 * above it, so node reads a bare `.js` as CommonJS, and importing the
 * simulation then fails on its first `export` with a syntax error that says
 * nothing about the extension.
 */
export async function replay(name: SubjectName, run: Run): Promise<Replayed> {
  const info = (await subjects())[name]
  const recording = decodeRecording(run.encoded)
  const source = await (await fetch(`${info.frameOrigin}${info.sim}`)).text()

  const dir = await mkdtemp(join(tmpdir(), "game-base-replay-"))
  try {
    const file = join(dir, "sim.mjs")
    await writeFile(file, source)
    const loaded = (await import(pathToFileURL(file).href)) as {
      default: () => GameModule<unknown, PlainValue>
      MANIFEST: Manifest
    }
    const replayed = runSession<unknown, PlainValue>({
      module: loaded.default(),
      seed: recording.seed,
      config: recording.config,
      inputs: new RecordedInputSource(recording.inputs),
      // The log ends where the player stopped. Without the cap the replay
      // runs past it and reports a different end tick for a run that never
      // diverged.
      maxTicks: Math.max(recording.endTick, 1),
      checkpointEvery: recording.tickHz,
      counters: loaded.MANIFEST.counters,
    })
    return {
      endTick: replayed.endTick,
      terminal: replayed.terminal,
      counters: replayed.counters,
      comparison: compareToRecording(recording, replayed),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Forgets every path the frame origin was asked for, for this subject. */
export async function clearRequests(name: SubjectName): Promise<void> {
  await fetch(`${CONTROL_ORIGIN}/requests/${name}`, { method: "DELETE" })
}

export async function requests(name: SubjectName): Promise<string[]> {
  const response = await fetch(`${CONTROL_ORIGIN}/requests/${name}`)
  return (await response.json()) as string[]
}

/**
 * What a spec does with a harness: open it, play it, read what it recorded.
 *
 * These run under node, because Playwright's runner does, and nothing here
 * imports `@clockwork2/engine`. The engine's built output imports its own
 * files without extensions, which bun and every bundler resolve and plain
 * node ESM does not, so anything needing the engine runs in `replay.ts` under
 * bun instead. A recording is JSON either way, which is what lets a spec read
 * one without the engine at all.
 */

import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type Page } from "@playwright/test"
import { CONTROL_ORIGIN, hostOrigin, type SubjectName } from "./env"

const HERE = dirname(fileURLToPath(import.meta.url))

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
 * The work happens in a bun subprocess, for the reason at the top of this
 * file. It is also where somebody else's simulation belongs: the CLI already
 * refuses to import a game into its own process to read a manifest.
 */
export async function replay(name: SubjectName, run: Run): Promise<Replayed> {
  const info = (await subjects())[name]
  const payload = JSON.stringify({
    sim: `${info.frameOrigin}${info.sim}`,
    recording: run.encoded,
  })

  return await new Promise<Replayed>((resolve, reject) => {
    const child = spawn("bun", ["run", join(HERE, "replay.ts")], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`the replay exited ${code}:\n${err.trim()}`))
        return
      }
      resolve(JSON.parse(out) as Replayed)
    })
    child.stdin.write(payload)
    child.stdin.end()
  })
}

/** Forgets every path the frame origin was asked for, for this subject. */
export async function clearRequests(name: SubjectName): Promise<void> {
  await fetch(`${CONTROL_ORIGIN}/requests/${name}`, { method: "DELETE" })
}

export async function requests(name: SubjectName): Promise<string[]> {
  const response = await fetch(`${CONTROL_ORIGIN}/requests/${name}`)
  return (await response.json()) as string[]
}

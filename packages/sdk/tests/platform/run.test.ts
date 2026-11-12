/**
 * The run driver, against a frame that posts what a real one would and a
 * client that answers as the platform would. What it has to get right is
 * what reaches the platform, and in what order.
 */

import { describe, expect, test } from "bun:test"
import type { InputEvent } from "@clockwork2/engine"
import type { RunChunk, RunResult, StartedRun } from "../../src/api/index"
import { PlatformClientError, PlatformRefusal } from "../../src/platform/errors"
import {
  RUN_PHASE,
  Run,
  type RunFrame,
  type RunFrameHandlers,
  type RunState,
} from "../../src/platform/run"
import { settle } from "./fake-page"

const RUN: StartedRun = {
  sessionId: "s-1",
  mode: "ranked",
  day: "2026-11-11",
  rankedRunsLeft: 2,
  seed: "seed-1",
  config: { speed: 1 },
  game: {
    id: "v-1",
    frameUrl: "https://bundles.example/v/v-1",
    manifestHash: "mh-1",
    manifest: { id: "lane-runner" },
    tickHz: 60,
    maxTicks: 7200,
    maxWallSeconds: 300,
  },
  token: "t-run",
  expiresIn: 7_776_000,
}

const RESULT: RunResult = {
  sessionId: "s-1",
  mode: "ranked",
  day: "2026-11-11",
  state: "settled",
  committed: true,
  replay: { fault: null, code: null, counters: { motes: 4 }, endTick: 300 },
}

class FakeFrame implements RunFrame {
  calls: Array<[string, ...unknown[]]> = []
  init(...args: unknown[]): void {
    this.calls.push(["init", ...args])
  }
  start(): void {
    this.calls.push(["start"])
  }
  end(): void {
    this.calls.push(["end"])
  }
  destroy(): void {
    this.calls.push(["destroy"])
  }
  virtualInput(action: string, value: number): void {
    this.calls.push(["virtualInput", action, value])
  }
}

type Outcome = "ok" | "unreachable" | "refused" | "failed"

function failure(outcome: Exclude<Outcome, "ok">): Error {
  if (outcome === "unreachable") return new PlatformClientError("E_UNREACHABLE")
  if (outcome === "failed") {
    return new PlatformRefusal(500, {
      error: "E_INTERNAL",
      message: "something went wrong",
    })
  }
  return new PlatformRefusal(400, {
    error: "E_CHUNKS_INCOMPLETE",
    message: "what was committed does not reach the end of the run",
  })
}

/** A client that records each call and answers from a script per kind. */
function fakeClient(script: {
  chunks?: Outcome[]
  submits?: Outcome[]
  result?: RunResult | Error
}) {
  const order: string[] = []
  const chunks: RunChunk[] = []
  const chunkOutcomes = [...(script.chunks ?? [])]
  const submitOutcomes = [...(script.submits ?? [])]
  return {
    order,
    chunks,
    client: {
      async sendChunk(run: StartedRun, chunk: RunChunk) {
        expect(run.token).toBe("t-run")
        order.push(`chunk ${chunk.seq}`)
        const outcome = chunkOutcomes.shift() ?? "ok"
        if (outcome !== "ok") throw failure(outcome)
        chunks.push(chunk)
        return { seq: chunk.seq, throughTick: chunk.throughTick }
      },
      async submit(run: StartedRun, recording: unknown) {
        order.push(`submit ${JSON.stringify(recording)}`)
        const outcome = submitOutcomes.shift() ?? "ok"
        if (outcome !== "ok") throw failure(outcome)
        return { sessionId: run.sessionId, recordingSha256: "r" }
      },
      async awaitResult(sessionId: string, options?: { token?: string }) {
        expect(options?.token).toBe("t-run")
        order.push(`result ${sessionId}`)
        if (script.result instanceof Error) throw script.result
        return script.result ?? RESULT
      },
    },
  }
}

function start(
  script: Parameters<typeof fakeClient>[0] = {},
  run: StartedRun = RUN,
) {
  const frame = new FakeFrame()
  const fake = fakeClient(script)
  const states: RunState[] = []
  let handlers: RunFrameHandlers | undefined
  const driver = new Run({
    client: fake.client,
    run,
    mount: (given) => {
      handlers = given
      return frame
    },
    onState: (state) => states.push(state),
    retryDelayMs: 1,
  })
  if (handlers === undefined) throw new Error("mount was not called")
  return { frame, driver, states, handlers, ...fake }
}

const input = (tick: number): InputEvent => ({
  tick,
  device: "key",
  code: "Space",
  value: 1,
})

/** A run that played 300 ticks with one input, ended, and sent its recording. */
async function playedThrough(ready: ReturnType<typeof start>) {
  const { handlers } = ready
  handlers.onReady({
    type: "ready",
    protocol: 1,
    manifestHash: "mh-1",
    kernelVersion: "0.8.0",
  })
  handlers.onProgress({ type: "progress", tick: 120, counters: { motes: 1 } })
  handlers.onCheckpoint({ type: "checkpoint", tick: 60, hash: "h60" })
  handlers.onLogChunk({ type: "log-chunk", fromIndex: 0, inputs: [input(42)] })
  handlers.onEnded({
    type: "ended",
    tick: 300,
    counters: { motes: 4 },
    reason: "ended",
    finalSnapshot: {},
  } as never)
  handlers.onRecordingChunk({
    type: "recording-chunk",
    index: 1,
    total: 2,
    data: "1}",
  })
  handlers.onRecordingChunk({
    type: "recording-chunk",
    index: 0,
    total: 2,
    data: '{"v":',
  })
  await settle()
}

describe("before a tick runs", () => {
  test("a frame serving another game is caught and taken down", () => {
    const { frame, handlers, states } = start()
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-other",
      kernelVersion: "0.8.0",
    })
    expect(frame.calls).toEqual([["destroy"]])
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_WRONG_GAME",
    })
  })

  test("a tick rate the engine does not run at is caught", () => {
    const { frame, handlers, states } = start(
      {},
      { ...RUN, game: { ...RUN.game, tickHz: 50 } },
    )
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    expect(frame.calls).toEqual([["destroy"]])
    expect(states.at(-1)?.errorCode).toBe("E_TICK_RATE_UNSUPPORTED")
  })

  test("the right game starts with the run's seed, config, rate and cap", () => {
    const { frame, handlers, states, driver } = start()
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    expect(frame.calls).toEqual([
      ["init", "seed-1", { speed: 1 }, 60, 7200],
      ["start"],
    ])
    expect(states.at(-1)?.phase).toBe(RUN_PHASE.PLAYING)
    expect(driver.current.phase).toBe(RUN_PHASE.PLAYING)
  })
})

describe("committing the run as it goes", () => {
  test("each chunk ends one tick short of the last reported, and none overlap", async () => {
    const ready = start()
    const { handlers, chunks } = ready
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    handlers.onProgress({ type: "progress", tick: 61, counters: { motes: 0 } })
    handlers.onCheckpoint({ type: "checkpoint", tick: 60, hash: "h60" })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 0,
      inputs: [input(42)],
    })
    // Nothing new is complete: the next progress is the same tick.
    handlers.onProgress({ type: "progress", tick: 61, counters: { motes: 0 } })
    handlers.onProgress({ type: "progress", tick: 130, counters: { motes: 2 } })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 1,
      inputs: [input(130)],
    })
    await settle()
    expect(
      chunks.map((c) => [
        c.seq,
        c.throughTick,
        c.checkpoints.length,
        c.inputs.length,
      ]),
    ).toEqual([
      [0, 60, 1, 1],
      [1, 130, 0, 1],
    ])
    expect(chunks[1]?.counters).toEqual({ motes: 2 })
  })

  test("a chunk that got no answer goes again, unchanged, before the next", async () => {
    const ready = start({ chunks: ["unreachable", "ok", "ok"] })
    const { handlers, order, chunks } = ready
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    handlers.onProgress({ type: "progress", tick: 61, counters: {} })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 0,
      inputs: [input(10)],
    })
    await settle()
    handlers.onProgress({ type: "progress", tick: 121, counters: {} })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 1,
      inputs: [input(100)],
    })
    await settle()
    expect(order).toEqual(["chunk 0", "chunk 0", "chunk 1"])
    expect(chunks.map((c) => c.seq)).toEqual([0, 1])
  })

  test("a refused chunk is not sent again", async () => {
    const ready = start({ chunks: ["refused"] })
    const { handlers, order } = ready
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    handlers.onProgress({ type: "progress", tick: 61, counters: {} })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 0,
      inputs: [input(10)],
    })
    await settle()
    handlers.onProgress({ type: "progress", tick: 121, counters: {} })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 1,
      inputs: [input(100)],
    })
    await settle()
    expect(order).toEqual(["chunk 0", "chunk 1"])
  })
})

describe("the end of the run", () => {
  test("the last chunk reaches the end, then the recording, then the result", async () => {
    const ready = start()
    await playedThrough(ready)
    expect(ready.order).toEqual([
      "chunk 0",
      "chunk 1",
      'submit {"v":1}',
      "result s-1",
    ])
    expect(ready.chunks.at(-1)?.throughTick).toBe(300)
    expect(ready.states.map((s) => s.phase)).toEqual([
      RUN_PHASE.PLAYING,
      RUN_PHASE.SUBMITTING,
      RUN_PHASE.REPLAYING,
      RUN_PHASE.DONE,
    ])
    expect(ready.states.at(-1)?.result).toEqual(RESULT)
  })

  test("a final chunk that got no answer goes before the recording", async () => {
    const ready = start({ chunks: ["ok", "unreachable", "ok"] })
    await playedThrough(ready)
    expect(ready.order).toEqual([
      "chunk 0",
      "chunk 1",
      "chunk 1",
      'submit {"v":1}',
      "result s-1",
    ])
  })

  test("a final chunk still unsent holds the recording back", async () => {
    // Sent with the recording first, the platform would find the chunks short
    // of the end and refuse the run for good.
    const ready = start({ chunks: ["ok", "unreachable", "unreachable", "ok"] })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ready.order).toEqual([
      "chunk 0",
      "chunk 1",
      "chunk 1",
      "chunk 1",
      'submit {"v":1}',
      "result s-1",
    ])
  })

  test("a final chunk that never arrives fails the run, and nothing is submitted", async () => {
    const ready = start({
      chunks: ["ok", ...Array<Outcome>(6).fill("unreachable")],
    })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ready.order.some((call) => call.startsWith("submit"))).toBe(false)
    expect(ready.states.at(-1)?.errorCode).toBe("E_UNREACHABLE")
  })

  test("a submit that got no answer, or that the platform failed, goes again", async () => {
    const ready = start({ submits: ["unreachable", "failed", "ok"] })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      ready.order.filter((call) => call.startsWith("submit")),
    ).toHaveLength(3)
    expect(ready.states.at(-1)?.phase).toBe(RUN_PHASE.DONE)
  })

  test("a submit the platform refuses fails the run with its code", async () => {
    const ready = start({ submits: ["refused"] })
    await playedThrough(ready)
    expect(ready.states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_CHUNKS_INCOMPLETE",
    })
  })

  test("a submit that never gets an answer fails after its attempts", async () => {
    const ready = start({
      submits: [
        "unreachable",
        "unreachable",
        "unreachable",
        "unreachable",
        "unreachable",
      ],
    })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(
      ready.order.filter((call) => call.startsWith("submit")),
    ).toHaveLength(5)
    expect(ready.states.at(-1)?.errorCode).toBe("E_UNREACHABLE")
  })

  test("a result the platform refuses fails the run", async () => {
    const ready = start({
      result: new PlatformRefusal(401, {
        error: "E_SIGN_IN_REQUIRED",
        message: "sign in",
      }),
    })
    await playedThrough(ready)
    expect(ready.states.at(-1)?.errorCode).toBe("E_SIGN_IN_REQUIRED")
  })

  test("an error that is neither kind still ends the run, naming it", async () => {
    const ready = start({ result: new TypeError("a bug") })
    await playedThrough(ready)
    expect(ready.states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_UNEXPECTED",
      detail: "TypeError: a bug",
    })
  })

  test("a recording that does not parse fails the run and sends nothing", async () => {
    const ready = start()
    const { handlers } = ready
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    handlers.onEnded({
      type: "ended",
      tick: 10,
      counters: {},
      reason: "ended",
      finalSnapshot: {},
    } as never)
    handlers.onRecordingChunk({
      type: "recording-chunk",
      index: 0,
      total: 1,
      data: "{",
    })
    await settle()
    expect(ready.states.at(-1)?.errorCode).toBe("E_RECORDING_UNREADABLE")
    expect(ready.order.some((call) => call.startsWith("submit"))).toBe(false)
  })

  test("the frame's own error fails the run, with what it said", () => {
    const { handlers, states } = start()
    handlers.onError({
      type: "error",
      code: "E_INIT_FAILED",
      detail: "no canvas",
    })
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_FRAME_FAILED",
      detail: "E_INIT_FAILED: no canvas",
    })
  })
})

describe("after a failure", () => {
  test("nothing more is sent, and the failure is the last state", async () => {
    const ready = start()
    const { handlers, states, order } = ready
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    handlers.onError({
      type: "error",
      code: "E_FRAME_THREW",
      detail: "tick threw",
    })
    handlers.onProgress({ type: "progress", tick: 200, counters: {} })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 0,
      inputs: [input(150)],
    })
    handlers.onEnded({
      type: "ended",
      tick: 300,
      counters: {},
      reason: "ended",
      finalSnapshot: {},
    } as never)
    handlers.onRecordingChunk({
      type: "recording-chunk",
      index: 0,
      total: 1,
      data: "{}",
    })
    await settle()
    expect(order).toEqual([])
    expect(states.at(-1)?.errorCode).toBe("E_FRAME_FAILED")
  })

  test("a second ready does not start the game again", () => {
    const { frame, handlers } = start()
    const ready = {
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    } as const
    handlers.onReady(ready)
    handlers.onReady(ready)
    expect(frame.calls.filter(([name]) => name === "init")).toHaveLength(1)
  })

  test("destroying a run waiting to resend a submit stops it at once", async () => {
    const frame = new FakeFrame()
    const fake = fakeClient({ submits: ["unreachable", "ok"] })
    let handlers: RunFrameHandlers | undefined
    const driver = new Run({
      client: fake.client,
      run: RUN,
      mount: (given) => {
        handlers = given
        return frame
      },
      retryDelayMs: 60_000,
    })
    if (handlers === undefined) throw new Error("mount was not called")
    await playedThrough({ handlers } as ReturnType<typeof start>)
    driver.destroy()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fake.order.filter((call) => call.startsWith("submit"))).toHaveLength(
      1,
    )
  })
})

describe("the page's own controls", () => {
  test("a press reaches the frame only while the run plays", () => {
    const { frame, handlers, driver } = start()
    driver.press("left", 1)
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    driver.press("left", 1)
    handlers.onEnded({
      type: "ended",
      tick: 10,
      counters: {},
      reason: "ended",
      finalSnapshot: {},
    } as never)
    driver.press("left", 0)
    expect(frame.calls.filter(([name]) => name === "virtualInput")).toEqual([
      ["virtualInput", "left", 1],
    ])
  })

  test("leaving ends the run in the frame; destroying stops everything", async () => {
    const ready = start()
    const { frame, handlers, driver, states } = ready
    handlers.onReady({
      type: "ready",
      protocol: 1,
      manifestHash: "mh-1",
      kernelVersion: "0.8.0",
    })
    driver.end()
    driver.destroy()
    const seen = states.length
    handlers.onProgress({ type: "progress", tick: 61, counters: {} })
    handlers.onLogChunk({
      type: "log-chunk",
      fromIndex: 0,
      inputs: [input(10)],
    })
    await settle()
    expect(frame.calls.slice(-2)).toEqual([["end"], ["destroy"]])
    expect(ready.order).toEqual([])
    expect(states).toHaveLength(seen)
  })
})

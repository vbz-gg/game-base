/**
 * Driving one run: the frame plays it, this commits it as it goes, submits
 * the recording at the end, and waits for the replay's answer.
 *
 * The frame is a seam rather than the engine's `GameFrame` directly, so this
 * file can be driven by a test that posts the messages a real frame would and
 * reads what reached the platform. The engine's `createGameFrame` satisfies
 * it: hand `mount` a function that makes one with the handlers it is given.
 *
 * What it holds:
 *
 * - **The frame plays the game the run was issued for.** The manifest hash
 *   the frame reports must be the run's, or nothing starts.
 * - **Chunks do not overlap, and each ends at the last complete tick**
 *   (`throughTickFor`). They are sent one at a time, in order, and one that
 *   got no answer goes again, unchanged, before the next.
 * - **The last chunk reaches the platform before the recording.** A submit
 *   whose chunks stop short of the run's end is refused.
 * - **A submit that got no answer goes again.** The same recording answers
 *   the same, so a retry cannot score a run twice.
 * - **Nothing here reads a score.** The counters go into a chunk as evidence.
 *   The result's counters are what the replay computed.
 */

import type { GameToHost } from "@clockwork2/engine/protocol"
import type { RunChunk, RunResult, StartedRun } from "../api/index.js"
import { throughTickFor } from "./chunks.js"
import type { PlatformClient } from "./client.js"
import {
  type ClientErrorCode,
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "./errors.js"

type FromFrame<Type extends GameToHost["type"]> = Extract<
  GameToHost,
  { type: Type }
>

/** What the driver needs of a frame. The engine's `GameFrame` satisfies it. */
export interface RunFrame {
  init(
    seed: string,
    config: unknown,
    tickHz: 30 | 60 | 120,
    maxTicks: number,
  ): void
  start(): void
  end(): void
  destroy(): void
  virtualInput(action: string, value: number): void
}

/** The handlers to give the frame: `createGameFrame`'s options of the same names. */
export interface RunFrameHandlers {
  onReady(message: FromFrame<"ready">): void
  onProgress(message: FromFrame<"progress">): void
  onCheckpoint(message: FromFrame<"checkpoint">): void
  onLogChunk(message: FromFrame<"log-chunk">): void
  onEnded(message: FromFrame<"ended">): void
  onRecordingChunk(message: FromFrame<"recording-chunk">): void
  onError(message: FromFrame<"error">): void
}

export const RUN_PHASE = {
  /** The frame is loading, and has not said which game it serves. */
  WAITING: "waiting",
  PLAYING: "playing",
  /** The run ended, and its recording is going to the platform. */
  SUBMITTING: "submitting",
  /** The platform took the recording, and a server is replaying it. */
  REPLAYING: "replaying",
  /** The result is final: `result` says what the replay decided. */
  DONE: "done",
  FAILED: "failed",
} as const

export type RunPhase = (typeof RUN_PHASE)[keyof typeof RUN_PHASE]

export interface RunState {
  readonly phase: RunPhase
  /** Why it failed: a `PlatformRefusal`'s or a `PlatformClientError`'s code. */
  readonly errorCode: string | null
  /** For a failure, what the frame or the platform said about it. */
  readonly detail: string | null
  /** Once the phase is `done`. */
  readonly result: RunResult | null
}

export interface RunOptions {
  readonly client: Pick<PlatformClient, "sendChunk" | "submit" | "awaitResult">
  /** The run, as `startRun` answered it. Its token is used for every write. */
  readonly run: StartedRun
  /** Makes the frame, with the handlers the driver gives it. */
  readonly mount: (handlers: RunFrameHandlers) => RunFrame
  readonly onState?: (state: RunState) => void
  /** How many times a submit is sent before the run fails. */
  readonly submitAttempts?: number
  /** The wait before the first resend of a submit, doubled each time after. */
  readonly retryDelayMs?: number
}

export const SUBMIT_ATTEMPTS = 5
export const SUBMIT_RETRY_MS = 1_000

const TICK_RATES = [30, 60, 120] as const

export class Run {
  private readonly options: RunOptions
  private readonly frame: RunFrame
  private readonly abort = new AbortController()
  private state: RunState = {
    phase: RUN_PHASE.WAITING,
    errorCode: null,
    detail: null,
    result: null,
  }

  /** Arrived from the frame and not yet in a chunk. */
  private checkpoints: Array<{ tick: number; hash: string }> = []
  private inputs: unknown[] = []
  private counters: Record<string, number> = {}
  private tick = 0
  private ended = false

  private seq = 0
  private postedThrough = -1
  /** Chunks that got no answer, oldest first, sent again before the next. */
  private unsent: RunChunk[] = []
  /** Sends in order: two chunks in flight could arrive out of sequence. */
  private posting: Promise<unknown> = Promise.resolve()

  private recordingParts: string[] = []
  private recordingTotal = 0
  private submitting = false

  constructor(options: RunOptions) {
    this.options = options
    this.frame = options.mount({
      onReady: (message) => this.ready(message.manifestHash),
      onProgress: (message) => {
        this.tick = Math.max(this.tick, message.tick)
        this.counters = { ...message.counters }
        this.commit()
      },
      onCheckpoint: (message) => {
        this.checkpoints.push({ tick: message.tick, hash: message.hash })
      },
      onLogChunk: (message) => {
        this.inputs.push(...message.inputs)
        this.commit()
      },
      onEnded: (message) => {
        this.tick = Math.max(this.tick, message.tick)
        this.counters = { ...message.counters }
        this.ended = true
        this.commit()
        this.submitIfReady()
      },
      onRecordingChunk: (message) => {
        this.recordingTotal = message.total
        this.recordingParts[message.index] = message.data
        this.submitIfReady()
      },
      onError: (message) =>
        this.fail("E_FRAME_FAILED", `${message.code}: ${message.detail}`),
    })
  }

  get current(): RunState {
    return this.state
  }

  /**
   * The frame says which game it serves, and it has to be this run's. A frame
   * serving another version would play a different game against this seed,
   * and the replay would not agree.
   */
  private ready(manifestHash: string): void {
    const { run } = this.options
    if (manifestHash !== run.game.manifestHash) {
      this.fail("E_WRONG_GAME", `the frame reports ${manifestHash}`)
      this.frame.destroy()
      return
    }
    const tickHz = TICK_RATES.find((rate) => rate === run.game.tickHz)
    if (tickHz === undefined) {
      this.fail("E_TICK_RATE_UNSUPPORTED", `${run.game.tickHz}`)
      this.frame.destroy()
      return
    }
    this.frame.init(run.seed, run.config, tickHz, run.game.maxTicks)
    this.frame.start()
    this.move(RUN_PHASE.PLAYING)
  }

  /** Sends what is complete since the last chunk, if anything is. */
  private commit(): void {
    if (
      this.checkpoints.length === 0 &&
      this.inputs.length === 0 &&
      !this.ended
    ) {
      return
    }
    const throughTick = throughTickFor({
      tick: this.tick,
      inputTicks: this.inputs.map(tickOf),
      ended: this.ended,
      postedThrough: this.postedThrough,
    })
    // Nothing new is complete: keep what arrived for the next chunk.
    if (throughTick === null) return

    const chunk: RunChunk = {
      seq: this.seq,
      throughTick,
      checkpoints: this.checkpoints,
      inputs: this.inputs,
      counters: this.counters,
    }
    this.seq += 1
    this.postedThrough = throughTick
    this.checkpoints = []
    this.inputs = []
    this.posting = this.posting.then(() => this.send(chunk))
  }

  /** Sends the chunks that got no answer, then this one, in order. */
  private async send(chunk?: RunChunk): Promise<void> {
    const queue = chunk === undefined ? this.unsent : [...this.unsent, chunk]
    this.unsent = []
    for (const [index, body] of queue.entries()) {
      if (this.abort.signal.aborted) return
      try {
        await this.options.client.sendChunk(this.options.run, body)
      } catch (error) {
        if (worthRetrying(error)) {
          // Keep it, and everything after it, for the next send.
          this.unsent = queue.slice(index)
          return
        }
        // A refusal is the platform's answer to this body; sending it again
        // gets the same one. The submit says whether the run still stands.
      }
    }
  }

  /** Submits once the run has ended and every part of its recording is here. */
  private submitIfReady(): void {
    if (this.submitting || !this.ended || this.recordingTotal === 0) return
    for (let index = 0; index < this.recordingTotal; index += 1) {
      if (this.recordingParts[index] === undefined) return
    }
    this.submitting = true

    let recording: unknown
    try {
      recording = JSON.parse(this.recordingParts.join(""))
    } catch (error) {
      this.fail("E_RECORDING_UNREADABLE", String(error))
      return
    }
    this.move(RUN_PHASE.SUBMITTING)
    // After the chunks, so the last chunk reaches the platform first.
    this.posting = this.posting.then(() => this.submit(recording))
  }

  private async submit(recording: unknown): Promise<void> {
    const attempts = this.options.submitAttempts ?? SUBMIT_ATTEMPTS
    let delay = this.options.retryDelayMs ?? SUBMIT_RETRY_MS
    for (let attempt = 1; ; attempt += 1) {
      if (this.abort.signal.aborted) return
      // A chunk that got no answer has to arrive before the recording.
      if (this.unsent.length > 0) await this.send()
      try {
        await this.options.client.submit(this.options.run, recording)
        break
      } catch (error) {
        if (!worthRetrying(error) || attempt >= attempts) {
          this.failWith(error)
          return
        }
      }
      await wait(delay)
      delay *= 2
    }

    this.move(RUN_PHASE.REPLAYING)
    try {
      const result = await this.options.client.awaitResult(
        this.options.run.sessionId,
        { signal: this.abort.signal },
      )
      this.settle(result)
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.failWith(error)
    }
  }

  /** From a host-drawn control, and from nowhere else. */
  press(action: string, value: number): void {
    if (this.ended || this.state.phase !== RUN_PHASE.PLAYING) return
    this.frame.virtualInput(action, value)
  }

  /** The player leaving. The run ends where they left it, and is submitted. */
  end(): void {
    this.frame.end()
  }

  /** Stops everything: the frame, and any request still to be sent. */
  destroy(): void {
    this.abort.abort()
    this.frame.destroy()
  }

  private move(phase: RunPhase): void {
    if (this.abort.signal.aborted) return
    this.state = { phase, errorCode: null, detail: null, result: null }
    this.options.onState?.(this.state)
  }

  private settle(result: RunResult): void {
    if (this.abort.signal.aborted) return
    this.state = {
      phase: RUN_PHASE.DONE,
      errorCode: null,
      detail: null,
      result,
    }
    this.options.onState?.(this.state)
  }

  private fail(code: ClientErrorCode | string, detail: string | null): void {
    if (this.abort.signal.aborted) return
    this.state = {
      phase: RUN_PHASE.FAILED,
      errorCode: code,
      detail,
      result: null,
    }
    this.options.onState?.(this.state)
  }

  /**
   * A refusal or a client error fails the run with its own code. Anything
   * else is a bug, and it still ends the run where the page can see it,
   * rather than leaving it waiting forever behind a rejection nobody holds.
   */
  private failWith(error: unknown): void {
    if (
      error instanceof PlatformRefusal ||
      error instanceof PlatformClientError
    ) {
      this.fail(error.code, error.message)
      return
    }
    this.fail("E_UNEXPECTED", String(error))
  }
}

function tickOf(input: unknown): number {
  const tick = (input as { readonly tick?: unknown } | null)?.tick
  return typeof tick === "number" ? tick : 0
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

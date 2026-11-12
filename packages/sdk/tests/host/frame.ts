/**
 * A frame for the host's tests: what `createGameFrame` was asked for, what
 * the host then told the frame, and a way to post what a real frame would.
 *
 * The real one is an iframe whose messages only a browser delivers, and the
 * browser suite drives that through the harness.
 */

import type { GameFrameOptions } from "@clockwork2/engine/parent"
import { PROTOCOL_VERSION } from "@clockwork2/engine/protocol"
import type { RunFrame } from "../../src/platform/run"

export class FakeFrame implements RunFrame {
  readonly calls: Array<[string, ...unknown[]]> = []
  options!: GameFrameOptions

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

  /** The frame's hello back, in this engine's protocol unless told otherwise. */
  ready(manifestHash: string, protocol = PROTOCOL_VERSION): void {
    this.options.onReady?.({
      type: "ready",
      protocol,
      manifestHash,
      kernelVersion: "0.8.0",
    })
  }
}

/** A `createFrame` that records the frame it made. */
export function frameMaker(): {
  readonly made: FakeFrame[]
  readonly createFrame: (options: GameFrameOptions) => FakeFrame
} {
  const made: FakeFrame[] = []
  return {
    made,
    createFrame(options) {
      const frame = new FakeFrame()
      frame.options = options
      made.push(frame)
      return frame
    },
  }
}

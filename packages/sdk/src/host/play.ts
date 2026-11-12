/**
 * One platform run, framed and driven: `mountHost` for the frame and the
 * controls, `Run` for what reaches the platform.
 *
 * The controls send their presses through the run, never to the frame
 * directly, so a press before the run has started or after it has ended is
 * dropped rather than reaching a frame that is not recording.
 */

import type { StartedRun } from "../api/index.js"
import type { PlatformClient } from "../platform/client.js"
import { RUN_PHASE, Run, type RunState } from "../platform/run.js"
import { type Host, type HostOptions, mountHost } from "./host.js"

export interface PlayOptions {
  readonly client: Pick<PlatformClient, "sendChunk" | "submit" | "awaitResult">
  /** The run, as `startRun` answered it: its frame and its manifest. */
  readonly run: StartedRun
  /** The frame's title, for a screen reader. */
  readonly title?: string
  readonly onState?: (state: RunState) => void
  /** For a test: makes the frame. The engine's `createGameFrame` by default. */
  readonly createFrame?: HostOptions["createFrame"]
}

export interface PlayedRun {
  readonly run: Run
  readonly host: Host
  /** The player leaving: the run ends where it stands, and is submitted. */
  end(): void
  /** Takes everything down, and sends nothing more. */
  destroy(): void
}

/**
 * Frames `run` in `element` and plays it.
 *
 * Throws a `PlatformClientError` before anything is framed when the run's
 * manifest asks for something a host cannot do (`hostedControls`). Every
 * failure after that arrives as the run's state: `onState` is told, with the
 * code that says why.
 */
export function playRun(element: HTMLElement, options: PlayOptions): PlayedRun {
  // A press arrives only from a control, and a control exists only once the
  // host has drawn it, which is inside the run's own construction.
  let playing: Run | undefined
  let host: Host | undefined
  const run = new Run({
    client: options.client,
    run: options.run,
    onState: (state) => {
      // Once the run is no longer playing, nothing a control sends reaches
      // it, so the controls go: a failed run whose frame is gone would
      // otherwise leave buttons over nothing.
      if (state.phase !== RUN_PHASE.PLAYING) host?.hideControls()
      options.onState?.(state)
    },
    mount: (handlers) => {
      host = mountHost(element, {
        frameUrl: options.run.game.frameUrl,
        manifest: options.run.game.manifest,
        handlers,
        onPress: (action, value) => playing?.press(action, value),
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options.createFrame === undefined
          ? {}
          : { createFrame: options.createFrame }),
      })
      return host.frame
    },
  })
  playing = run
  const mounted = host as Host
  return {
    run,
    host: mounted,
    end: () => run.end(),
    destroy() {
      run.destroy()
      mounted.destroy()
    },
  }
}

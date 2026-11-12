/**
 * A game, framed on a page: the sandboxed frame, the check that it speaks this
 * engine's protocol, and the on-screen controls its manifest asks for.
 *
 * Plain DOM behind one function, as the controls are, so a page in any
 * framework or none mounts it into an element of its own. `playRun` puts a
 * platform run on top of it; the harness drives the frame directly.
 */

import {
  createGameFrame,
  type GameFrameOptions,
} from "@clockwork2/engine/parent"
import { PROTOCOL_VERSION } from "@clockwork2/engine/protocol"
import { type MountedControls, mountControls } from "../controls/index.js"
import { PlatformClientError } from "../platform/errors.js"
import type { RunFrame, RunFrameHandlers } from "../platform/run.js"
import { type HostedControls, hostedControls } from "./manifest.js"

/** What the frame tells the page. Each is optional for a page that only plays. */
export type HostHandlers = Partial<
  RunFrameHandlers & {
    readonly onStarted: () => void
    readonly onHeartbeat: NonNullable<GameFrameOptions["onHeartbeat"]>
  }
>

export interface HostOptions {
  /**
   * The game document: a run's `game.frameUrl`, or the harness's own. The
   * host adds `parent`, the page's origin, which the frame document names in
   * its `frame-ancestors`.
   */
  readonly frameUrl: string
  /** The manifest of the version the frame serves. */
  readonly manifest: unknown
  /** The frame's title, for a screen reader. */
  readonly title?: string
  readonly handlers?: HostHandlers
  /**
   * Where a press on a drawn control goes. `playRun` passes the run's own
   * `press`, which drops a press outside the run; the frame's
   * `virtualInput` by default.
   */
  readonly onPress?: (action: string, value: number) => void
  /** For a test: makes the frame. The engine's `createGameFrame` by default. */
  readonly createFrame?: (options: GameFrameOptions) => RunFrame
}

export interface Host {
  readonly frame: RunFrame
  /** The controls the manifest asks for, read before anything was framed. */
  readonly controls: HostedControls
  /**
   * Draws other controls than the manifest's: the harness's picker. A
   * game's page has no reason to call it, since the manifest is what the
   * platform checked.
   */
  showControls(controls: HostedControls): void
  /** Takes the controls down and leaves the frame: a run that is over. */
  hideControls(): void
  /** Takes the frame and the controls down. Safe to call twice. */
  destroy(): void
}

/**
 * Frames the game in `element` and draws its controls over it.
 *
 * `element` needs its own positioning context: the frame fills it and the
 * controls sit on top. It throws a `PlatformClientError` before anything is
 * framed when the manifest asks for something a host cannot do
 * (`hostedControls`). A frame that answers `ready` in another protocol
 * version reaches `onRefused` with `E_FRAME_PROTOCOL` and not `onReady`, so
 * nothing is started in a frame that would misread every message after.
 */
export function mountHost(element: HTMLElement, options: HostOptions): Host {
  const controls = hostedControls(options.manifest)
  const handlers = options.handlers ?? {}
  const create = options.createFrame ?? createGameFrame
  const origin = element.ownerDocument.defaultView?.location.origin ?? "null"
  const src = new URL(options.frameUrl)
  src.searchParams.set("parent", origin)

  let pad: MountedControls | null = null
  let destroyed = false

  const frame = create({
    container: element,
    src: src.toString(),
    ...(options.title === undefined ? {} : { title: options.title }),
    onReady: (message) => {
      if (message.protocol !== PROTOCOL_VERSION) {
        handlers.onRefused?.(
          new PlatformClientError("E_FRAME_PROTOCOL", {
            cause: { frame: message.protocol, page: PROTOCOL_VERSION },
          }),
        )
        return
      }
      handlers.onReady?.(message)
    },
    onStarted: () => handlers.onStarted?.(),
    onProgress: (message) => handlers.onProgress?.(message),
    onCheckpoint: (message) => handlers.onCheckpoint?.(message),
    onLogChunk: (message) => handlers.onLogChunk?.(message),
    onEnded: (message) => handlers.onEnded?.(message),
    onRecordingChunk: (message) => handlers.onRecordingChunk?.(message),
    onError: (message) => handlers.onError?.(message),
    onHeartbeat: (message) => handlers.onHeartbeat?.(message),
  })

  const press =
    options.onPress ??
    ((action: string, value: number) => frame.virtualInput(action, value))

  function showControls(next: HostedControls): void {
    pad?.destroy()
    pad = null
    if (destroyed || next.mode !== "scheme") return
    pad = mountControls(element, {
      scheme: next.scheme,
      bind: next.bind,
      onPress: press,
    })
  }

  showControls(controls)

  return {
    frame,
    controls,
    showControls,
    hideControls: () => showControls({ mode: "keyboard" }),
    destroy() {
      if (destroyed) return
      destroyed = true
      pad?.destroy()
      pad = null
      frame.destroy()
    },
  }
}

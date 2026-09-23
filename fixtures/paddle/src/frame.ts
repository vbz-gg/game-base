/**
 * Paddle's frame document entry.
 *
 * It waits for `init` before it builds anything, so the seed arrives over the
 * bridge rather than in the URL where it would reach a referrer and a log.
 *
 * The one line that matters for this fixture is `pointerTarget`. Without it
 * `InputCapture` listens for keys and nothing else, and a game whose controls
 * are its own has no way to be touched at all. `viewport` is the simulation's
 * own space, so what reaches the log is already in the units the hit test
 * uses.
 */

import createGame, {
  type Config,
  DEFAULT_CONFIG,
  MANIFEST,
  PLAYFIELD,
} from "cw2:sim"
import { RecordedInputSource } from "@clockwork2/engine"
import { connectToParent, encodeRecording } from "@clockwork2/engine/frame"
import { GameHost, InputCapture } from "@clockwork2/engine/host"
import { FRAME_ERRORS } from "@clockwork2/engine/protocol"
import { createPaddlePresentation } from "./present/canvas"
import type { View } from "./sim"

const params = new URL(location.href).searchParams
const parentOrigin = params.get("parent") ?? location.origin
const container = document.querySelector("#stage") as HTMLElement

connectToParent<View>({
  manifest: MANIFEST,
  parentOrigin,
  createHost: (init, bridge) => {
    const host = new GameHost<View, HTMLElement, Config>({
      module: createGame(),
      manifest: MANIFEST,
      seed: init.seed,
      config: (init.config as Config | null) ?? DEFAULT_CONFIG,
      presentation: createPaddlePresentation(),
      container,
      checkpointEvery: 60,
      maxTicks: init.maxTicks,
      ...(init.inputs === undefined
        ? {}
        : { inputs: new RecordedInputSource(init.inputs) }),
      ...(init.speed === undefined ? {} : { speed: init.speed }),
      onCheckpoint: (checkpoint) => {
        bridge.checkpoint(checkpoint.tick, checkpoint.hash)
      },
      onFrame: (frame) => {
        const now = performance.now()
        bridge.progress(frame.tick, host.counters(), now)
        bridge.logChunk(now)
      },
      onEnded: (result) => {
        bridge.ended(result, encodeRecording(host.recording()))
      },
      onError: (error) => {
        bridge.error(FRAME_ERRORS.THREW, String(error))
      },
    })

    // A replay has no live queue, so there is nothing to capture into.
    if (host.live !== null) {
      new InputCapture({
        manifest: MANIFEST,
        queue: host.live,
        pointerTarget: container,
        viewport: { width: PLAYFIELD, height: PLAYFIELD },
      }).attach()
    }
    return host
  },
})

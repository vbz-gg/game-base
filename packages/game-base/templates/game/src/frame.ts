/**
 * The frame document's entry: the page your game runs inside.
 *
 * It waits for `init` before it builds anything, so the seed arrives over the
 * bridge rather than in the URL, where it would reach a referrer and a server
 * log.
 *
 * This game declares a control scheme, so the arcade draws its buttons and
 * sends each press as a `virtual-input`; `InputCapture` turns that into an
 * action without this file doing anything. A game declaring
 * `{ mode: "custom" }` instead has to pass `pointerTarget` and `viewport`
 * here, or it will listen for keys and nothing else and cannot be touched at
 * all. See the `paddle` fixture.
 */

import createGame, { type Config, DEFAULT_CONFIG, MANIFEST } from "cw2:sim"
import { RecordedInputSource } from "@clockwork2/engine"
import { connectToParent, encodeRecording } from "@clockwork2/engine/frame"
import { GameHost, InputCapture } from "@clockwork2/engine/host"
import { FRAME_ERRORS } from "@clockwork2/engine/protocol"
import { createPresentation } from "./present/canvas"
import type { View } from "./sim/game"

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
      presentation: createPresentation(),
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
      new InputCapture({ manifest: MANIFEST, queue: host.live }).attach()
    }
    return host
  },
})

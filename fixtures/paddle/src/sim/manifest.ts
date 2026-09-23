/**
 * A game that draws its own controls.
 *
 * `controls: { mode: "custom" }` says the host draws nothing. Everything a
 * player touches is painted by this game's renderer and hit-tested by its
 * simulation, which is the whole point of the fixture: the custom path is
 * the one a game takes when its controls are part of its art, and it is the
 * path that cannot work unless pointer input carries an identity.
 *
 * The bindings are the two fingers the game handles. A third is bound by
 * nobody and its events are dropped, exactly as an unbound key is.
 */

import type { Manifest } from "@clockwork2/engine/manifest"

export const MANIFEST: Manifest = {
  schemaVersion: 1,
  id: "paddle",
  version: "1.0.0",
  name: "Paddle",
  kernel: { version: "0.7.3" },
  session: {
    tickHz: 60,
    maxTicks: 60 * 120,
    maxWallSeconds: 180,
    hasEnding: true,
  },
  inputs: {
    map: {
      // Where the first finger is, across the playfield. The simulation
      // decides what that position means, because a renderer may not build
      // an input and so may not decide what was pressed.
      aimX: [{ code: "pointer0-x", device: "pointer", label: "Drag" }],
      aimY: [{ code: "pointer0-y", device: "pointer", label: "Drag" }],
      touch: [{ code: "pointer0", device: "pointer", label: "Touch" }],
      // A second finger, held while the first still drags. This pair is what
      // one shared pointer stream could never express.
      boostX: [{ code: "pointer1-x", device: "pointer", label: "Boost" }],
      boost: [{ code: "pointer1", device: "pointer", label: "Boost" }],
      // A keyboard too, so the fixture is playable on a desktop.
      left: [{ code: "ArrowLeft", device: "key", label: "Left" }],
      right: [{ code: "ArrowRight", device: "key", label: "Right" }],
    },
    controls: { mode: "custom" },
  },
  counters: [
    { name: "caught", direction: "up", monotonic: true, label: "Caught" },
    { name: "ticksSurvived", direction: "up", monotonic: true, label: "Ticks" },
  ],
  rankBy: ["caught", "ticksSurvived"],
  tiePolicy: "shared",
  display: { orientation: "any", minViewport: { width: 240, height: 320 } },
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "canvas2d",
    multiplayer: false,
  },
}

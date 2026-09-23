/**
 * What the platform knows about this game without running it.
 *
 * Every field here is read before a single tick executes: how fast it runs,
 * how long it may run for, what it counts, how it ranks, and how somebody on
 * a phone steers it.
 */

import type { Manifest } from "@clockwork2/engine/manifest"

export const MANIFEST: Manifest = {
  schemaVersion: 1,
  /** Immutable. Change it and this is a different game with a new board. */
  id: "lane-runner",
  version: "1.0.0",
  name: "Lane Runner",
  kernel: { version: "0.7.3" },
  session: {
    tickHz: 60,
    /** A hard cap: the kernel ends the run here whatever the game says. */
    maxTicks: 60 * 120,
    maxWallSeconds: 300,
    hasEnding: true,
  },
  inputs: {
    map: {
      left: [
        { code: "ArrowLeft", device: "key", label: "Left" },
        { code: "KeyA", device: "key" },
      ],
      right: [
        { code: "ArrowRight", device: "key", label: "Right" },
        { code: "KeyD", device: "key" },
      ],
    },
    /**
     * A layout the **arcade** draws, with this game's actions in its slots.
     *
     * Bind the slots you use and leave the rest of the layout empty: this
     * game moves sideways only, so it sits in a d-pad's left and right
     * positions and the other two cells stay blank. The arcade owns every
     * pixel of those buttons, which is what lets it promise they are
     * thumb-sized and clear of the notch.
     *
     * If your controls are part of your art, declare `{ mode: "custom" }`
     * instead, paint them in your renderer and hit-test them in `tick`. See
     * the `paddle` fixture. And if your game needs a keyboard, leave this
     * field out: the arcade then says so to somebody holding a phone rather
     * than framing a canvas they cannot steer.
     */
    controls: {
      mode: "scheme",
      scheme: "dpad",
      bind: { left: "left", right: "right" },
    },
  },
  counters: [
    { name: "motes", direction: "up", monotonic: true, label: "Motes" },
    { name: "ticksSurvived", direction: "up", monotonic: true, label: "Ticks" },
  ],
  /** Ties on motes break on how long you lasted. */
  rankBy: ["motes", "ticksSurvived"],
  tiePolicy: "shared",
  params: {
    speed: { type: "int", label: "Speed", min: 1, max: 3, default: 1 },
  },
  display: { orientation: "any", minViewport: { width: 320, height: 480 } },
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "canvas2d",
    multiplayer: false,
  },
}

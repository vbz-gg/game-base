---
name: arcade-game
description: Build a game the vbz arcade can run, on top of a Clockwork 2 simulation - the two artifacts an upload carries, the manifest the platform reads without running anything, on-screen controls for a phone, and the sandboxed cross-origin frame a game plays inside. Use when starting a game for the arcade, choosing or binding controls, writing the frame entry, testing against the harness, or working out why ingest refused an upload. For the simulation's own rules - fixed ticks, seeded randomness, dmath, snapshots - use the platform-game skill instead.
---

# Building a game the arcade can run

Two skills, and they do not overlap. **platform-game** is how to write a
simulation that replays to the same state on somebody else's server: fixed
ticks, `Prng`, `dmath`, snapshots, the twelve conformance checks. Read it
first and keep it open. **This one** is everything between a conforming
simulation and a game somebody can play on vbz: how it is laid out, how it is
built, how a phone steers it, and what the platform checks before it will list
it.

## Start here

```bash
bunx @vbz-gg/game-base new ./my-game
cd ./my-game && bun install
bun run dev                       # your game, framed the way the arcade frames it
```

The copy builds and plays before a line of it is changed, so anything that
breaks afterwards is something you just did. Its id is taken from the
directory name and is **immutable once published**: changing it later is a
different game with a different board.

## The shape of a game

```
src/sim/index.ts     the simulation's entry: default export + MANIFEST
src/sim/manifest.ts  what the platform reads without running anything
src/sim/game.ts      the rules
src/present/         the renderer
src/frame.ts         the page the game runs in, inside the arcade's frame
```

Two entries, and they become two files:

| Entry | Becomes | Loaded by |
|---|---|---|
| `src/sim/index.ts` | the **simulation** | the browser **and** the server that replays you |
| `src/frame.ts` | the **frame bundle** | the browser |

`src/sim/index.ts` must never reach `src/present/`. The import graph is
scanned transitively, and a simulation that can reach a canvas is a simulation
that can decide a score from one. The frame does not carry its own copy of the
simulation either: it imports `cw2:sim`, which the platform rewrites to the
simulation's content address at upload. One object, fetched by the browser and
loaded by the validator, same bytes and same hash.

`bun run build` writes all three files a submission carries:
`dist/sim.js`, `dist/frame.js` and `dist/manifest.json`.

## Controls

A manifest's `inputs.controls` has three shapes and they mean different things.

**A scheme the host draws.** Name a layout and bind its slots to your own
actions:

```ts
inputs: {
  map: {
    left: [{ code: "ArrowLeft", device: "key", label: "Left" }],
    right: [{ code: "ArrowRight", device: "key" }],
  },
  controls: {
    mode: "scheme",
    scheme: "dpad",
    bind: { left: "left", right: "right" },
  },
}
```

Bind the slots you use and leave the rest empty. The host owns every pixel,
which is what lets it promise the buttons are thumb-sized and clear of the
notch. `tap`, `dpad`, `dpad+1` and `dpad+2` are the layouts; their slots are in
`references/controls.md`.

**Your own, drawn by your renderer.** `{ mode: "custom" }` and the host draws
nothing. You paint the controls and **hit-test them in `tick`**, in simulation
units, from pointer positions the host puts in the input log. Not in the
renderer: a game may not construct an input event, and a renderer that decided
which control was pressed would be deciding the result on the client.

**Nothing.** Leave the field out and you have said the game needs a keyboard.
The arcade marks it as such rather than handing a phone a canvas it cannot
steer.

Every action a control sends must appear in `inputs.map`. That is checked.

## What the frame entry does

`src/frame.ts` waits for `init` before it builds anything, so the seed arrives
over the bridge rather than in the URL where it would reach a referrer and a
server log. The template's copy is the one to keep; the only line worth
thinking about is `InputCapture`:

```ts
new InputCapture({ manifest: MANIFEST, queue: host.live }).attach()
```

A game declaring a scheme needs no more than that: the host sends each press as
a virtual input and `InputCapture` turns it into your action. A game drawing
its own controls must pass `pointerTarget` and `viewport` as well, or it
listens for keys and nothing else and cannot be touched at all.

## Testing it

`bun run dev` is the arcade's play view on your laptop: the game in a sandboxed
frame on one origin, the page that frames it on another, the pad your manifest
asked for drawn over it. Two ports are two origins, so the traps a sandboxed
cross-origin frame actually has turn up here rather than in an upload.

The picker switches layouts without editing your manifest, which is how to see
`dpad+2` against a game that binds four slots. End stops the run and publishes
its recording, so you can check that what the browser produced replays to the
score it showed.

Check a phone width before you ship. The pad is drawn over the game, so a game
that puts its own score in the bottom corners is a game whose score is under a
thumb.

## When ingest refuses

Every refusal carries a code. The ones that are about this skill rather than
about determinism:

- `E_SIM_NOT_SELF_CONTAINED` - the simulation imports something. It runs with
  no network at all, so an import is a fault on every session.
- `E_FRAME_IMPORT_MISSING` - the frame carries its own copy of the simulation
  instead of importing `cw2:sim`. Two copies is the thing the whole split
  exists to prevent.
- `E_FRAME_IMPORT_UNEXPECTED` - the frame imports something besides the
  simulation. Bundle it in.
- `E_FRAME_SPECIFIER_AMBIGUOUS` - `"cw2:sim"` also appears as data, so
  rewriting the specifier would change something the game reads.
- `E_MANIFEST_INVALID` - the shape is wrong, or a bound slot names an action
  that is not in `inputs.map`.
- `E_RANKBY_UNDECLARED` - `rankBy` names a counter you did not declare. The
  game would list and never rank anybody.

`references/ingest.md` has the whole path from an upload to a listing.

## Never

- **Build an input event.** The host builds them. This is why a custom control
  is hit-tested in `tick` and not in the renderer.
- **Hit-test in CSS pixels.** The host quantises a pointer against a viewport
  before the log sees it, so a coordinate in your `tick` is already in the
  space your manifest declared.
- **Draw a control somewhere the simulation does not believe it is.** Read one
  constant from both sides, as `fixtures/paddle` does with `GRAB_TOP`.
- **Reach the renderer from the simulation.** Not for a canvas size, not for a
  device pixel ratio, not once.
- **Change what the simulation does without bumping `version`.** Every score
  already recorded becomes unverifiable and nothing announces it.
- **Change `id` after publishing.** It is the board.
- **Upload control art.** There are two artifacts. A game that wants its
  controls to look like its own draws them itself.
- **Put the seed in a URL.** It arrives over the bridge.

## References

- `references/controls.md` - every scheme, its slots, and the custom path.
- `references/artifacts.md` - the two entries, `cw2:sim`, the rewrite, the
  content addressing and the size caps.
- `references/harness.md` - what `game-base dev` serves and what it does not
  reproduce.
- `references/ingest.md` - what the platform checks, in the order it checks it.

## Commands

- `game-base new <dir>` - a game that already conforms.
- `game-base build <dir>` - the three files a submission carries.
- `game-base dev <dir>` - the arcade's play view, locally, on two origins.

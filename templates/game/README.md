# Lane Runner

A starting point for a game the vbz arcade can run. Three lanes, rocks coming
towards you, motes to collect.

```bash
bun install
bun run dev      # play it, framed the way the arcade frames it
bun run build    # the three files an upload carries
```

## What is where

```
src/sim/index.ts      the bundle's entry: a default export and MANIFEST
src/sim/game.ts       the simulation - the only thing that decides a score
src/sim/manifest.ts   what the platform knows without running anything
src/present/canvas.ts the renderer, which reads and never writes
src/frame.ts          the page the game runs inside
```

The line that matters is between `src/sim/` and `src/present/`. The
conformance checker is pointed at `src/sim/index.ts` and scans its imports
transitively: a simulation that can reach a canvas is a simulation that can
decide a score from one. Swap the renderer and nothing in `sim/` changes,
which is what lets the platform replay your game on a server with no canvas
at all.

## Controls

This game declares a scheme, so the **arcade** draws its buttons:

```ts
controls: { mode: "scheme", scheme: "dpad", bind: { left: "left", right: "right" } }
```

It moves sideways only, so it binds two of a d-pad's four slots and the other
two cells stay empty. `tap`, `dpad`, `dpad+1` and `dpad+2` are the schemes;
`bun run dev` has a picker so you can see your game under each one without
editing this file.

If your controls are part of your art, declare `{ mode: "custom" }`, paint
them in your renderer and hit-test them in `tick` - the `paddle` fixture is
the worked example. If your game needs a keyboard, leave `controls` out
entirely, and the arcade tells a phone player so rather than handing them a
canvas they cannot steer.

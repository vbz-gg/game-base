# paddle

A game whose controls are its own.

`inputs.controls` is `{ mode: "custom" }`, so the arcade draws nothing. The
grab bar along the bottom is painted by `src/present/canvas.ts` and hit-tested
by `src/sim/index.ts`, and both read the same `GRAB_TOP` constant - which is
the whole contract of the custom path. A control drawn somewhere the
simulation does not believe it is, is a control a player presses to no effect.

Two things it exists to prove:

**The hit test belongs in `tick`.** A game may not construct an input event,
so a renderer deciding which control was pressed and handing the answer to the
simulation is the hole that rule closes. What the renderer gets is a pointer
position; what it does with it is draw.

**Two fingers have to be told apart.** Dragging the paddle while holding a
second finger to widen it is a thing one shared pointer stream could not
express: the coordinates interleaved and the first finger to lift sent the
release the other was waiting on. The manifest binds `pointer0-*` and
`pointer1-*`, and a third finger is bound by nobody and dropped, exactly as an
unbound key is.

It is also playable with the arrow keys, so it works on a desktop.

```bash
bun run packages/game-base/src/cli/index.ts dev fixtures/paddle
```

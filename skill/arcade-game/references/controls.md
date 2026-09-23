# Controls

Three answers, four layouts, and one rule about where a hit test lives.

## The three answers

`inputs.controls` in the manifest:

| Value | Means | The host draws |
|---|---|---|
| `{ mode: "scheme", scheme, bind }` | use a layout the host owns | the layout, in its own art |
| `{ mode: "custom" }` | the controls are part of the game's art | nothing |
| absent | the game needs a keyboard | nothing, and says so |

The third is not the same as the second, and telling them apart is why the
field exists. Before it, an absent declaration meant both, so a phone player
got a canvas they could not steer with nothing to explain it.

## The layouts

```
tap        tap
dpad       up  down  left  right
dpad+1     up  down  left  right  a
dpad+2     up  down  left  right  a  b
```

`tap` is one button covering the viewport, drawn transparent: it is what a
game steered by tapping anywhere wants, and the only layout with no furniture.
The others put their slots in two thumb-sized clusters along the bottom, the
directions on the left and the actions on the right.

Bind the slots you use:

```ts
controls: { mode: "scheme", scheme: "dpad", bind: { left: "left", right: "right" } }
```

That draws two buttons in a d-pad's left and right positions and leaves the
other two cells empty. The order buttons are drawn and tabbed in comes from the
scheme, not from your binding, so two games under one scheme behave the same
however their manifests happened to list things.

**Every bound action must appear in `inputs.map`.** A binding naming an action
the game does not have is a control that sends something nothing listens for,
and it is refused rather than drawn.

**A slot the scheme does not have is refused too.** Drawing what it recognises
and dropping the rest would be a control the player never sees and the author
never hears about.

## Why the list is short

Each layout is something a host has to draw correctly at every screen size, in
a skin it chose, forever. A scheme earns its place by covering games that
exist. Before asking for one, check whether a subset of an existing layout
does the job: `dpad` already serves a game that only moves sideways.

There are no sticks. `virtual-input` carries one value per press and a stick
sends two axes, so a stick is a change to the engine's protocol before it is a
row in this table.

## What the host guarantees

- At least 44 CSS pixels on a side, whatever a skin asks for.
- Clear of `env(safe-area-inset-*)`: the notch, the home indicator, the
  rounded corners.
- Only the buttons take pointer events. Everything between and around them
  reaches the game underneath.
- A press that goes down comes up. `pointerup`, `pointercancel` and
  `lostpointercapture` all release, and so does a scheme swapped mid-run. A
  finger that slides off the button it pressed still releases that button.

A host skins the pad by setting CSS custom properties - `--gb-control-bg`,
`--gb-control-fg`, `--gb-control-size` and the rest - on any ancestor. None of
them can take away the size or the clearance.

## The custom path

A game drawing its own controls paints them in its renderer and decides what a
touch means in `tick()`. That division is forced rather than chosen: a game may
not construct an input event, so a renderer that worked out which control was
pressed and handed the answer over would be deciding the result on the client,
where nothing can check it.

Pointers arrive as device codes, bound in `inputs.map` like keys:

```ts
inputs: {
  map: {
    aimX:  [{ code: "pointer0-x", device: "pointer", label: "Drag" }],
    aimY:  [{ code: "pointer0-y", device: "pointer" }],
    touch: [{ code: "pointer0",   device: "pointer" }],
    boost: [{ code: "pointer1",   device: "pointer" }],
  },
  controls: { mode: "custom" },
}
```

The slot number is the lowest free index when a finger lands and is freed when
it lifts, so it is a pure function of the order events arrived in and a replay
reproduces it. One finger is always slot 0. The position goes into the log
before the press, so `tick` knows where a finger landed in the same tick it
learns that it landed.

Two things to get right:

**Hit-test in simulation units.** The host quantises a pointer against the
viewport your frame declared before the log ever sees it, so a coordinate in
`tick` is already in your own space. A hit test written in CSS pixels works on
the screen it was written on.

**Draw each control where the simulation believes it is.** Read one constant
from both sides. `fixtures/paddle` has the worked example: its grab bar is
drawn at `GRAB_TOP` and hit-tested against `GRAB_TOP`.

And the frame entry has to ask for pointers at all:

```ts
new InputCapture({
  manifest: MANIFEST,
  queue: host.live,
  pointerTarget: container,
  viewport: { width: PLAYFIELD, height: PLAYFIELD },
}).attach()
```

Without `pointerTarget` and `viewport` the capture listens for keys and nothing
else, and the game cannot be touched.

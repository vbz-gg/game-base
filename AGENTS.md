# Working in this repository

Guidance for coding agents. `README.md` says what the project is;
`packages/game-base/README.md` is what a game author reads.

This repository sits between two others. [clockwork2](https://github.com/vbz-gg/clockwork2)
is the engine and owns determinism, the manifest and the host bridge; the
[arcade](https://github.com/vbz-gg/arcade) runs the platform. Read clockwork2's
`docs/engine.md` before changing anything that touches a manifest or an input.

## Commands

```bash
bun install
bun run build          # tsc -b over project references
bun run typecheck
bun run lint           # biome check .
bun run lint:fix
bun test               # the unit suite
bun run test:coverage  # the same tests, then the 99% floor over packages/*/src
bun run test:e2e       # the browser suite, against a real sandboxed frame
bun run check:publishable   # pack the package and read what a consumer gets
```

Never start a dev server. Ask the user to run it.

## The one rule

**The arcade and this repository draw the same pad, because they run the same
code.** A scheme the arcade renders differently from the harness is a scaffold
that lies to the author who trusted it, and they find out when a player does.
So the scheme table and the renderer live here, the arcade imports them, and
nothing about a layout is re-derived on either side.

That is also why the renderer is plain DOM behind
`mountControls(element, options)` rather than a component. The arcade's shell
is React and the harness is not; a component would make one of them wrap the
other, and a wrapper is where a difference starts.

## Controls

A game declares `inputs.controls` in its manifest, and there are three answers:
a named scheme the host draws, `{ mode: "custom" }` for a game that paints its
own, and leaving the field out, which says the game needs a keyboard.

**The scheme list is short on purpose.** Each entry is a layout a host has to
draw correctly at every screen size, in a skin it chose, forever. A scheme
earns its place by covering games that exist rather than by completing a grid.
Before adding one, check whether the game could bind a subset of a scheme that
is already there: a game binds the slots it uses, so `dpad` already serves a
left-and-right game.

**A stick is not a row in that table.** `virtual-input` carries one value per
press and a stick sends two axes, so adding one is a change to the engine's
protocol first.

**The renderer sets layout, hit target and safe-area clearance itself**, and
takes every colour from a CSS custom property with a fallback. A host restyles
it without a stylesheet from us, and cannot restyle away a 44px minimum or the
`env(safe-area-inset-*)` clearance, because a control the player cannot reach
is the same as one that is not there.

**A control that goes down must come up.** The arcade's first pad bound
`pointerdown` and nothing else, so a held control never released. A game
reading a direction change survived it; a platformer holding `right` ran into
the wall for the rest of the session. `pointerup`, `pointercancel` and
`lostpointercapture` all release, and so do `update()` and `destroy()`, because
a button that is about to stop existing will never send an event.

## Tests

- Add a test for a concrete failure mode. A test that restates the
  implementation passes for as long as the implementation exists and tells you
  nothing.
- `bun run test:coverage` holds `packages/*/src` at 99% of lines and 99% of
  functions. `scripts/check-coverage.ts` measures it over `coverage/lcov.info`;
  `coverageThreshold` is absent from `bunfig.toml`, which says why. Two things
  get past a failure: a test for a concrete failure mode, or a path excluded in
  `bunfig.toml` with a written reason.
- The gate has been watched failing. Raising `MIN_LINES` above the measurement
  exits 1 and names the shortfall in lines; a gate nobody has seen fail is one
  that reports green because it is checking nothing.
- **happy-dom for the unit tests, Playwright for what a browser decides.**
  happy-dom cannot represent `max(14px, env(safe-area-inset-bottom))` at all -
  the longhand reads back empty and `setProperty` mangles it to `14px` - so
  asserting safe-area clearance there would be measuring happy-dom's CSS
  parser. Anything about real layout, a real thumb or a real cross-origin frame
  belongs in the browser suite.
- Playwright runs with `retries: 0`. For a suite about determinism, flake is
  the finding.

## The browser suite

`e2e/` drives the harness an author runs, against both subjects this
repository ships: the template, which declares a scheme, and the paddle
fixture, which declares `{ mode: "custom" }`. One process builds each game
through the real CLI and serves it, so a stale `dist` cannot be what is
tested, and it keeps a request log per subject that a spec reads to see what
the browser actually fetched.

What only a browser can settle, and what each one caught: a sandboxed frame
loading its own modules from an opaque origin; `max()` around an `env()`
resolving at all; a pointer that presses a button and is released somewhere
else, which without `setPointerCapture` records the press and never the
release; two fingers, where lifting one must not lift the other; and a
recording replaying to the counters the page displayed. The picker test found
a live bug while it was being written - the harness page handed a game's
declared binding to every layout the picker offered, so a game binding two
slots drew two buttons under `dpad+2` and called it six.

Two things about the tools themselves, measured rather than read:

- **A spec cannot import `@clockwork2/engine`.** Its built output imports its
  own files without extensions - `from "./bits"` - which bun and every bundler
  resolve and plain node ESM does not, and Playwright's runner is node. So
  `e2e/src/replay.ts` runs under bun and everything node-side treats a
  recording as the JSON it is. Measured on engine 0.6.0 under node 22:
  `ERR_MODULE_NOT_FOUND` on the engine's first relative import.
- **A CDP `touchEnd` carries the finger being lifted**, not the ones still
  down, although the protocol describes `touchPoints` as "active touch
  points". With two fingers down, ending with the point that is still down
  releases that one. `e2e/src/fingers.ts` has the sequence that measured it.

## Why the engine is a peer dependency

A game installs `@clockwork2/engine` itself - its simulation and its frame
both import it - and the manifest, the recording format and the parent-frame
protocol are a contract between the engine the game carries and the engine the
host runs. A regular dependency here would let a game hold two copies on two
versions and have the halves of that contract disagree at runtime, which the
frame reports as a protocol error and nothing reports as an install problem.

The range is `>=0.6.0 <0.7.0` rather than open-ended. clockwork2 is 0.x and
maps a breaking change to a minor, so `0.7.0` may move the very things this
package is about: `inputs.controls` arrived in a minor, and so did pointer
identity. Each engine minor is a deliberate bump here.

Only `/harness` imports the engine at all, from one line: the page script
bundles `@clockwork2/engine/parent`. `/controls`, `/build` and `/serve` reach
it nowhere, which is what lets the arcade import the renderer into a browser
bundle without dragging anything behind it.

## Releasing

Patch and minor only. **No major releases for now**, here, in clockwork2 or in
the arcade. On a 0.x version commit-and-tag-version maps a breaking change to a
minor, so `bun run release` cannot reach 1.0.0 on its own, and there is no
`release:major` script. `scripts/release-version.test.ts` holds the major at 0,
so lifting the policy means deleting a test in a diff somebody reads.

Publishing is npm Trusted Publishing, as clockwork2 does it: no `NPM_TOKEN`,
and npm signs a provenance attestation naming the commit and the workflow.
A trusted publisher cannot be configured for a package that does not exist, so
**the first version is published from a laptop** and the publisher configured
afterwards.

`.versionrc.json`'s `prerelease` hook runs the gate before the version is
bumped, so it never sees the tree a release actually ships. Anything holding
the version literal therefore has to be in `bumpFiles`; clockwork2 lost several
releases to exactly that, and `scripts/release-version.test.ts` is where the
next such file gets caught.

## Prose

Run the `humanizer` skill over anything a person reads before committing it:
`README.md`, the package README, `SKILL.md` and its references, and release
notes. Rewrite what it flags rather than patching the flagged phrase.

The house rules it does not cover:

- Hyphens, never em dashes, in code, comments, docs and commit messages alike.
- Sentence case in headings.
- Write for a reader who has not seen this before. Explain the thing itself.
- State the measurement rather than the adjective.

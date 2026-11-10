# From an upload to a listing

What the platform does with a submission, in order. Everything before the
first storage write, so a refused submission leaves nothing behind.

## 1. The manifest

`assertManifest` on the shape, and then two things it does not cover:

- every name in `rankBy` is a declared counter, and `rankBy` is not empty
  (`E_RANKBY_UNDECLARED`). Without this a game lists, plays fine all day and
  can never rank anybody.
- every action a control binds appears in `inputs.map` (`E_MANIFEST_INVALID`).

The manifest is also compared against the one the built simulation exports.
The code's copy wins: a submission whose JSON says something the simulation
does not is refused rather than believed.

## 2. The artifacts

The contract in `references/artifacts.md`, on the uploaded bytes:
`E_ARTIFACT_NOT_UTF8`, `E_ARTIFACT_TOO_LARGE`, `E_SIM_NOT_SELF_CONTAINED`,
`E_FRAME_IMPORT_MISSING`, `E_FRAME_IMPORT_UNEXPECTED`,
`E_FRAME_DYNAMIC_IMPORT`, `E_FRAME_SPECIFIER_AMBIGUOUS`.

Then the addressing: the simulation is hashed, the frame's specifier is
rewritten to that address, and the frame is hashed afterwards.

## 3. The conformance suite

The twelve checks from `@clockwork2/engine/validate`, run against the built
simulation laid out as a subject directory. They are the platform-game skill's
subject: determinism, banned APIs, no async, restore, bounded runs, counters,
headless, assets and the rest.

Plus a thirteenth the arcade owns, **seed sensitivity**: two different seeds
on the same input log must reach different states. A game that ignores its
seed passes all twelve - check 1 compares same-seed runs to each other, so a
seed-blind generator is perfectly deterministic - and turns a daily board into
an all-time board.

## 4. The cross-engine sweep

The candidate's own logs replayed under JavaScriptCore and SpiderMonkey as
well as V8, once per version rather than per play.

This is the real admission boundary. `banned-apis` is a static scan and a
static scan is evadable: `Math["si"+"n"]` walks past it and straight into
here, where the engines disagree. Measured in clockwork2: 32.6% of inputs
differ for `Math.hypot` between JavaScriptCore and V8, 10.3% for `Math.exp`,
9.0% for `Math.pow`, 3.2% for `Math.cos`.

## 5. A human

An invited submitter's first version of a game reaches a review queue rather
than the catalogue. The automated checks carry the weight; the human gate is a
glance at what the game does - it renders, it plays, it is what its listing
claims - and never at its code.

## What is not checked, and cannot be

A game with a backdoor keyed on a magic input satisfies every check here: the
replay agrees with the client because both run the same code, and both are
wrong together. No amount of determinism fixes that and no reading of a
minified bundle finds it. What answers it is the invite, the per-version
mismatch rate, and watching a new game's score distribution against its peers.

A verified score means the server recomputed it from your own inputs. It does
not mean the game is fair, and the platform should never be read as saying
otherwise.

## Source is never asked for

A submission is a built bundle. Every property that matters is behavioural -
two seeds reach different states, the same log replays identically, three
engines agree, the isolate has no network - so source would add nothing to the
checking and cost an author their code.

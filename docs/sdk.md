# How the SDK works

This explains the SDK from first principles, for somebody who has not seen it.
`README.md` says what the repository is, `packages/sdk/README.md` is what
a game author reads, and `AGENTS.md` is the working guidance that assumes this
page.

## Three repositories, one game

A game on [vbz.gg](https://vbz.gg) is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation. The engine owns determinism: the seed, `dmath`, the manifest, the
recording format and the bridge between a page and the frame a game runs in. It
knows nothing about vbz.gg.

The vbz.gg platform is the backend for game studios. It owns studios and their
keys, player sign-in, the checks on an upload, the daily seed, the server-side
replay and the board. A studio serves its game from its own page, which frames
the game document the platform serves.

Between them sits a set of decisions that belong to neither. What a d-pad looks
like is not the engine's business, because the engine is general. It is also
not something the platform can own alone, because an author has to be able to
build against it before an upload, and a pad drawn one way locally and another
way in production is a scaffold that lies to the person who trusted it. That
set of decisions is this package.

So the SDK owns six things, one per subpath export:

| Subpath | What it is |
|---|---|
| `/api` | The shapes of the platform's public routes, as types only |
| `/platform` | A game page's client for those routes: sign-in, runs, the board |
| `/controls` | The scheme table and the renderer that draws it |
| `/build` | A game's source to the two artifacts an upload carries |
| `/serve` | The frame document, its CSP, and the routes the artifacts are fetched from |
| `/harness` | Both of those, wired into a local two-origin play view |

Beside them the package ships a CLI (`vbz new | build | dev`), the
template `new` copies, and `skill/vbz-game/`, which is the same material
written for an agent to follow literally.

The platform imports `/api`, and declares each public route's answer with its
types. It imports `/build` and `/controls`, so it checks an upload against
the contract and the scheme table an author builds with. It serves the frame
document and the two artifacts with `/serve`, the code the harness serves a
laptop with. A studio's page talks to the platform through `/platform` and
draws the pad with `/controls`. An author runs `/harness`.

## The platform's route shapes

`/api` is types only: every route a game's page or a build system calls,
keyed by method and path in `PlatformRoutes`, with its credential, its body
and its answer, and `PublicRefusalCode`, every refusal those routes answer by
name. It compiles to an empty module, so importing it adds nothing to a
bundle, and a test holds it to exporting no value.

The types live here and not in the platform so the dependency runs one way.
The platform depends on this package and this package on nothing of the
platform's, so a change to a route's shape lands here first, is released, and
is then taken by the platform. The platform's build fails when one of its
routes answers a shape, or a refusal code, these types do not name.

## The page's client

`/platform` is what a studio's page uses to talk to the platform. It follows
the protocol the platform's page guide describes, `docs/your-game-page.md` in
vbz-gg/platform, and every request it makes goes through one function keyed
by `PlatformRoutes`, so it cannot call a route the platform does not declare.
A build system's routes are not offered: a secret key never belongs in a page.

`createPlatformClient({ apiOrigin, signInOrigin, pageKey })` makes the client.
It reads the browser only when it is made, never when the module loads, so a
page's bundle may import it during server-side rendering, and a test hands it
a page of its own through `environment`.

**Signing in** opens the sign-in window before anything is awaited, because a
browser opens one only in the turn of the click that asked. It sends a PKCE
challenge and a state, takes a message only from that window, on the sign-in
origin, of type `vbz.signin`, carrying that state, and trades the code at
`POST /v1/oauth/token`. A window closed with no code fails after 500 ms of
grace, because the window closes itself right after posting and a browser can
report the close first.

**The player's token** is kept in `localStorage`, one entry per page key,
because a token is good only beside a page key of its own studio. Every run
start renews it, and the renewed one is kept. A token the platform answers
with `E_SIGN_IN_REQUIRED` is dropped, but only while it is still the kept one:
an older run's token refused after the player signed in again says nothing
about the new one. The page also holds the player in memory and reads that
copy once it has one, so a browser that keeps nothing (a private window, a
blocked or full store) still plays this visit, and signs in again on the next.

A run's own writes and its result are sent with the token from its own start,
not with whatever player is kept by then.

**`Run`** drives one run through a frame the page makes with
`createGameFrame`. It checks the frame's manifest hash against the run's
before a tick runs. It ends each chunk at the last complete tick: one short of
the last tick the frame reported while the run plays, because the engine
takes a tick's inputs before running it, and the end tick once the run has
ended (`throughTickFor`). Chunks go one at a time; one that got no answer goes
again, unchanged, before the next. The last chunk reaches the platform before
the recording, a submit that got no answer goes again (the same recording
answers the same), and then it asks for the result until the replay has run.

The client's own failures are `PlatformClientError`, with codes from
`CLIENT_ERROR`; the platform's are `PlatformRefusal`, with a
`PublicRefusalCode`. The two sets never share a code, and a compile-time check
holds them apart.

## Controls

### The three answers

A manifest's `inputs.controls` has exactly three shapes, and they mean
different things:

```ts
{ mode: "scheme", scheme: "dpad", bind: { left: "left", right: "right" } }
{ mode: "custom" }
// or the field left out entirely
```

A **scheme** names a layout the host draws, in the host's own art, and binds
that layout's slots to the game's own action names. A game calling its actions
`north` and `south` works without the host knowing those words.

**Custom** says the game paints its controls itself, because they are part of
its art: a drawn wheel, a slingshot, a radial menu. The host draws nothing at
all.

**Absent** says the game needs a keyboard. Before `inputs.controls` existed,
an absent field meant both "I draw my own" and "I need a keyboard" and nothing
could tell them apart, so a phone got a canvas it could not steer with no way
to say so. A page hosting such a game can read that from its manifest and tell
a phone player before a run starts.

A game does not upload control art for the host to render. That is a possible
later change, and it costs a third artifact kind: contract checks, storage
keys, a publish path, serving and size caps, against a platform that stores
exactly two artifacts today.

### The scheme table

Four layouts, in `src/controls/schemes.ts`:

| Scheme | Slots | For |
|---|---|---|
| `tap` | `tap` | The whole viewport is one button, and no furniture is drawn |
| `dpad` | `up` `down` `left` `right` | Snake |
| `dpad+1` | the four, plus `a` | A platformer |
| `dpad+2` | the four, plus `a` `b` | Jump and shoot |

A game binds the slots it uses and no more, so a left-and-right game sits in a
d-pad's left and right positions with the other two cells empty. `boundSlots`
walks the **scheme's** order rather than the binding's, so two games under one
scheme draw and tab identically however their manifests happened to list
things. `unknownSlots` is the other half: a binding naming a slot the scheme
does not have is something a host refuses, because a silently dropped binding
is a control the player never sees and the author never hears about.

There are no sticks. `virtual-input` carries one value per press and a stick
sends two axes, so a stick is a change to the engine's protocol before it is a
row in this table.

### What the renderer owns

`mountControls(element, options)` draws into an element and hands back
`update` and `destroy`. Plain DOM rather than a component: a studio's page may
use React, another framework or none, and the harness uses none, so a
component would make every other host wrap it.

It sets layout, hit target and safe-area clearance itself, and takes every
colour from a CSS custom property with a fallback, so a host restyles it by
setting `--gb-control-bg` on any ancestor and needs no stylesheet from here.
What a skin cannot restyle away is the 44px minimum or the
`env(safe-area-inset-*)` clearance, because a control the player cannot reach
is the same as one that is not there.

The container takes no pointer events; only the buttons do. Everything between
and around them reaches the game underneath, which is what lets the pad sit
over a game's letterbox margin where there is one and over its art where there
is not.

**A control that goes down must come up.** The pad the vbz arcade drew before
this package existed bound `pointerdown` and nothing else, so a held control
never released: a game reading a direction change survived it, and a
platformer holding `right` ran into the wall for the rest of the session.
`pointerup`, `pointercancel` and `lostpointercapture` all release. So do
`update()` and `destroy()`, because a button that is about to stop existing
will never send an event of its own.
A press also takes a pointer capture, so a finger that slides off the button
still sends its release to that button rather than to whatever is underneath.

### The custom path

A game that draws its own controls hit-tests them in `tick()`, never in its
renderer. That is not a style preference. `InputCapture.virtual()` is the
host's door, and a game that could reach it would be doing its hit-testing in
the renderer and handing the answer over as a press - which replays perfectly
and still decides the result on the client, where no conformance check can see
it. So the game receives inputs and never makes one.

Pointers arrive as device codes a manifest binds like any key:

```ts
aimX:  [{ code: "pointer0-x", device: "pointer" }]
aimY:  [{ code: "pointer0-y", device: "pointer" }]
touch: [{ code: "pointer0",   device: "pointer" }]
boost: [{ code: "pointer1",   device: "pointer" }]
```

The slot number is the lowest free index at `pointerdown`, freed at
`pointerup`, so it is a pure function of the order events arrived in and a
replay reproduces it. The position goes into the log before the press, so a
game learns where a finger landed in the same tick it learns that it landed.

Two consequences an author gets wrong otherwise. The hit test works in
**simulation units**, because the host quantises a pointer against a viewport
before the log ever sees it - a coordinate in the log is already in the space
the game declared, not CSS pixels on somebody's phone. And the renderer has to
draw each control where the simulation believes it is: `fixtures/paddle` keeps
them honest by reading one `GRAB_TOP` constant from both sides.

For any of this to reach the game, the frame has to hand `InputCapture` a
`pointerTarget` and a `viewport`. Without them it listens for keys and nothing
else, and a game whose controls are its own cannot be touched at all.

## The two artifacts

`buildGameArtifacts` turns a source tree into two files:

- the **simulation**, built from `src/sim/index.ts`, with **zero** imports
- the **frame**, built from `src/frame.ts`, importing exactly one thing

A frame refers to its simulation as the bare specifier `cw2:sim` and by no
other name, for three measured reasons. Bun ignores `external` for a relative
import, so a relative sim import cannot be externalised under a name we choose.
Two spellings of one module emit two imports, two URLs and two module
instances, which is two `MANIFEST` objects in one frame. And `cw2:` is not
resolvable by a browser, so an unrewritten frame fails loudly at load rather
than half-working.

What the contract checks, on the bytes rather than on the source:

1. One ES module, decodable as strict UTF-8.
2. `scanImports` returns at least one entry for a frame and **zero** for a
   simulation, every entry is an import statement, and the frame's distinct
   path set is exactly `{"cw2:sim"}`.
3. The quoted literal `"cw2:sim"` occurs exactly as many times as there are
   import entries. A higher count means the string is also data, so a text
   rewrite would change something the game reads: refuse rather than rewrite.
4. Within `MAX_SIM_BYTES` (2 MiB) and `MAX_FRAME_BYTES` (8 MiB).

Then the addressing. Each artifact is stored under the SHA-256 of its own
bytes. `rewriteSimImport` replaces the frame's specifier with
`/sim/<64 hex>.js` - root-relative, so the frame's bytes carry no domain and
changing the bundle host later is configuration rather than a re-publish - and
re-scans to prove the result imports exactly that one path. The frame is
hashed **after** the rewrite, so a stored frame's hash is taken over bytes that
already name one simulation. A frame can name exactly one sim, forever, which
is what makes "the browser and the validator ran the same code" checkable
rather than asserted.

`buildAndAddress` in `/harness` performs that whole sequence, which is the
same one the platform performs on an upload. The CLI's `build` command writes
the frame **unrewritten**, with its `cw2:sim` intact: a frame that arrived
already pointing somewhere would be a frame naming a module nobody checked.

## Serving

The frame document is one module tag and a container, so its CSP needs no
`'unsafe-inline'` for scripts. The game's title comes from its manifest and is
escaped.

Two headers carry the weight.

`Content-Security-Policy` leads with `sandbox allow-scripts
allow-pointer-lock`. The `sandbox` attribute on an iframe element lives in the
parent document, so it is gone the moment somebody opens the game's URL
directly - out of devtools, from a crawler, or the day somebody adds "open in
a new tab". As a response header it is a property of the document however it
was loaded. The rest of the policy is `default-src 'none'` with the few
sources a game actually needs, plus `connect-src 'none'` and
`frame-ancestors` naming the one site that may frame it.

`Access-Control-Allow-Origin: *` on the artifacts is not laziness. A frame
sandboxed without `allow-same-origin` sits in an opaque origin, so its origin
is the string `null` and every script it fetches - including its own, from the
host that served the document - is a cross-origin request. A server answering
with its own origin never matches `null`: the frame loads nothing, posts no
`ready`, and shows a blank game with no error in the parent. The 404 carries
the header too, or a miss reads to the page as a network failure and sends the
reader to the wrong layer.

Both artifacts are immutable by construction, so they are served
`public, max-age=31536000, immutable`. The document is `no-store`, because it
names an artifact by hash and a rebuild changes that hash.

## Starting a game

`vbz new ./my-game` copies the template out of the package and renames
it: the game's id comes from the directory, because an id is immutable once
published and a placeholder somebody forgets is a board under the wrong name.
The copy builds and plays before anything is changed, so an author's first
failure is one they caused.

The template ships inside the package rather than beside it in this
repository, at the same path relative to the CLI in the source tree and in
`dist`, which is what lets an installed copy find it.

## The harness

`vbz dev ./my-game` builds the two real artifacts and serves them behind
the frame document above, then serves a page on a **second port** that frames
it the way a game's page would: full viewport, the floating mark, the pad the
manifest asked for.

Two ports are two origins, which is what puts an author in front of the traps a
sandboxed cross-origin frame actually has rather than after an upload. What two
ports do not reproduce is the second *registrable* domain: production serves
frames from a different site so a game cannot set a cookie for the platform,
and two ports on localhost are one site. Cookie scope is not something a game
author can get wrong from inside a sandbox, so the gap is named rather than
closed with an `/etc/hosts` entry.

The page adds three things a game's page in production does not need. A
**picker** switches between every scheme, `custom` and `off` without editing a
manifest; under a scheme the game did not declare, the slots it did not bind
are bound to their own names so the layout is visible and plainly inert.
**Start** and **End** drive the session. And when a run ends, the page
collects the recording's chunks and publishes the whole thing, so an author can
read or save the evidence the platform would replay.

The seed is a constant, so a run an author is debugging is the run they had a
moment ago. The platform's daily seed is a keyed HMAC of the game and the day,
which does the same job for a different reason. A studio can also give each
ranked run a seed of its own.

What the harness does not do is replay, settle or rank. That is the
platform's half, and a harness pretending to do it would be teaching an author
about a server that does not exist.

## The package

`@vbz-gg/sdk` is `"sideEffects": false` with one export per half, so
importing `/controls` pulls the scheme table and a DOM renderer and nothing
else. That matters because a studio's page imports `/controls` into a browser
bundle: that subpath may reach no node built-in and no part of the CLI or the
harness.

Every relative import inside `src/` carries `.js`, and a directory import
carries the whole `/index.js`. `tsc` emits a relative specifier exactly as the
source wrote it and node ESM has no extension resolution, so `from "./schemes"`
builds, typechecks and passes the whole suite under bun and then fails on a
consumer's first `import` with ERR_MODULE_NOT_FOUND. `bun run check:publishable`
is what catches the next one: it packs the tarball and imports every subpath the
exports map names with plain node.

The same check covers a file the package **reads** rather than imports. The
harness bundles its page script when it starts, from a path built off
`import.meta.dir`, which resolves to the TypeScript here and has to resolve to
the compiled file in an installed copy. Nothing that imports the package would
notice its absence; the failure would arrive when somebody ran `vbz dev`.

`@clockwork2/engine` is a **peer** dependency. A game installs the engine
itself - its simulation and its frame both import it - and the manifest, the
recording format and the parent-frame protocol are a contract between the
engine the game carries and the engine the host runs. A regular dependency
would let a game hold two copies on two versions and have the halves of that
contract disagree at runtime, which surfaces as a protocol error and never as
an install problem.

The range is `>=0.8.0 <0.9.0` rather than open-ended. clockwork2 is 0.x and
maps a breaking change to a minor, so `0.7.0` may move the very things this
package is about: `inputs.controls` arrived in a minor, and so did pointer
identity. Each engine minor is a deliberate bump here.

Only `/harness` imports the engine at all, from one line: the page script
bundles `@clockwork2/engine/parent`. `/platform` names the frame's message
types with `import type`, which leaves nothing in a bundle, and the page hands
`Run` a frame it made itself. `/controls`, `/build` and `/serve` reach it
nowhere.

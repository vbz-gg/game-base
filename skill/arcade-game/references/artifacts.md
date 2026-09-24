# The two artifacts

A game version is two files, each stored under the SHA-256 of its own bytes.

| File | Built from | Imports | Loaded by |
|---|---|---|---|
| the simulation | `src/sim/index.ts` | **nothing** | the browser and the validator |
| the frame | `src/frame.ts` | exactly `cw2:sim` | the browser |

## Why the frame imports rather than embeds

The claim the arcade rests on is that replaying your input log reproduces your
score. That is worth nothing if the simulation your browser ran is not the
simulation the server runs, and two copies of one source, built twice, is not
the same thing as one file.

So the frame is built with the simulation left out, and emits a real import.
At upload the platform rewrites the specifier to the simulation's content
address and takes the frame's hash **after** that rewrite, so a stored frame's
bytes already name one simulation and can never name another.

## Why `cw2:sim` and no other name

Three reasons, measured on bun rather than assumed:

- **Bun ignores `external` for a relative import.** A relative sim import
  cannot be externalised under a name we choose; it stays compiled in.
- **Two spellings of one module emit two imports.** A frame reaching the
  simulation through `./index` in one file and `./sim` in another would load it
  twice, which is two `MANIFEST` objects in one page.
- **`cw2:` is not resolvable by a browser.** An unrewritten frame fails at load
  with "Failed to resolve module specifier" rather than half-working.

Import it in `src/frame.ts` and nowhere else:

```ts
import createGame, { type Config, DEFAULT_CONFIG, MANIFEST } from "cw2:sim"
```

Your renderer imports its types from the simulation the same way, so the frame
bundle holds one copy:

```ts
import { PLAYFIELD, type View } from "cw2:sim"
```

## The frame writes a checkpoint each second

The template's frame passes `checkpointEvery: MANIFEST.session.tickHz` to
`GameHost`. Keep it that way when you change `tickHz`. The arcade replays a
run with one checkpoint per second of play, so a frame that wrote them every
60 ticks would agree at 60 Hz and disagree on every run at 30 or 120 Hz, and
each of those runs would count against your game.

## What is checked, on the bytes

1. One ES module, decodable as strict UTF-8.
2. The simulation's import list is empty. The frame's distinct import set is
   exactly `{"cw2:sim"}`, every entry a static import statement.
3. The quoted literal `"cw2:sim"` occurs exactly as many times as there are
   import entries. A higher count means the string is also data, so a text
   rewrite would change something the game reads, and the upload is refused
   rather than corrupted.
4. Size: 2 MiB for the simulation, 8 MiB for the frame.

A dynamic `import("cw2:sim")` is refused: it chooses its module at runtime,
past the scan.

## The rewritten path is root-relative

`/sim/<64 hex>.js`, never a full URL. It resolves against the frame document's
own origin, so the stored bytes carry no domain and the bundle host can change
without re-publishing anything. It is also why the frame document and the
artifacts are served from one origin.

## What `game-base build` writes

```
dist/sim.js        the simulation
dist/frame.js      the frame, with cw2:sim still intact
dist/manifest.json the manifest, read out of the built simulation
```

The frame is written **unrewritten** on purpose. The rewrite belongs to the
platform: a frame that arrived already pointing at an address would be a frame
naming a module nobody checked.

`dist/manifest.json` is read by evaluating the built simulation in a
subprocess, so what it holds is the manifest the code carries rather than a
second copy that can drift.

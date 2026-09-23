# Working in this repository

Guidance for coding agents. **Read `docs/sdk.md` first**: it explains how this
package works from first principles, and everything below assumes it. The rest
of the reading, in order of how far away it is: `README.md` says what the
repository is, `packages/game-base/README.md` is what a game author reads, and
clockwork2's `docs/engine.md` is required before changing anything that touches
a manifest or an input.

This repository sits between two others. [clockwork2](https://github.com/vbz-gg/clockwork2)
is the engine and owns determinism, the manifest and the host bridge; the
[arcade](https://github.com/vbz-gg/arcade) runs the platform.

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

## Working on controls

`docs/sdk.md` has the three answers a manifest can give, the scheme table and
the custom path. What to hold while changing any of it:

**The scheme list is short on purpose.** Each entry is a layout a host has to
draw correctly at every screen size, in a skin it chose, forever. A scheme
earns its place by covering games that exist rather than by completing a grid.
Before adding one, check whether the game could bind a subset of a scheme that
is already there: a game binds the slots it uses, so `dpad` already serves a
left-and-right game.

**A stick is not a row in that table.** `virtual-input` carries one value per
press and a stick sends two axes, so adding one is a change to the engine's
protocol first.

**Layout, hit target and safe-area clearance belong to the renderer**, and
every colour to a CSS custom property with a fallback. A host must be able to
restyle it without a stylesheet from us, and must not be able to restyle away
the 44px minimum or the `env(safe-area-inset-*)` clearance.

**A control that goes down must come up.** `pointerup`, `pointercancel`,
`lostpointercapture`, `update()` and `destroy()` all release. Adding a fifth
way for a press to end means adding a sixth release.

**A game may not construct an input.** Anything that would let a renderer
decide which control was pressed and hand the answer over is the hole the
custom path exists to close.

## Publishing what a consumer can actually use

**Every relative import inside `packages/game-base/src` carries `.js`**, and a
directory import carries the whole `/index.js`. `tsc` emits a relative
specifier exactly as the source wrote it, and node ESM has no extension
resolution, so `from "./schemes"` runs everywhere in this repository and
nowhere under plain node.

`bun run check:publishable` packs the tarball and imports every subpath the
exports map names with plain node, which is the only check that sees this. It
also asserts the files the package reads at runtime rather than imports are in
the tarball - `RUNTIME_FILES` in the script - because the harness bundles its
page script from a path built off `import.meta.dir`, and nothing importing the
package would notice that file missing.

## The skill

`skill/arcade-game/` is prose an agent follows literally, so a stale sentence
is worse than a missing one. It has one subject: everything between a
conforming simulation and a game the arcade can run. Determinism belongs to
clockwork2's `platform-game`, and this one points at it rather than repeating
it - two copies of that rulebook is how one of them goes quietly out of date.

`skill/tests/skill.test.ts` measures the drift a machine can see: every scheme
and slot in the reference matches `SCHEMES`, the size caps and the 44px
minimum match the code, every refusal code named exists and every one that
exists is explained, the commands are the CLI's, the layout it prints is the
template's, and every reference is linked both ways. Adding a scheme fails it
until the reference has a line.

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
- A record-and-replay test needs a non-triviality guard. Assert the recording
  holds the presses the test made, or a page that silently records nothing
  passes every comparison.

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

One thing about the tools themselves, measured rather than read:

- **A CDP `touchEnd` carries the finger being lifted**, not the ones still
  down, although the protocol describes `touchPoints` as "active touch
  points". With two fingers down, ending with the point that is still down
  releases that one. `e2e/src/fingers.ts` has the sequence that measured it.

Until engine 0.7.1 a spec could not import `@clockwork2/engine` at all, because
its built output imported its own files without extensions and Playwright's
runner is node, so the replay ran in a bun subprocess. That is what the `.js`
rule below is about, and it is why `check:publishable` imports every subpath
under plain node.

## Releasing

Patch and minor only. **No major releases for now**, here, in clockwork2 or in
the arcade. On a 0.x version commit-and-tag-version maps a breaking change to a
minor, so `bun run release` cannot reach 1.0.0 on its own, there is no
`release:major` script, and the workflow's bump offers no major either.
`scripts/release-version.test.ts` holds the major at 0, so lifting the policy
means deleting a test in a diff somebody reads.

**A release is one dispatch of `release.yml`.** Pick `patch` or `minor`, leave
the dry-run box unticked, and the job does the rest: it runs the gate CI runs,
bumps the version, pushes the bump commit, rebuilds `dist` at the version being
published, publishes, and creates the tag and the GitHub release at the commit
it bumped. The release body is that version's own `CHANGELOG.md` section, so
the notes are the changelog rather than a second description of the same
commits.

The filename is the configuration. npm's trusted publisher is set up against
this repository and `release.yml` by name, so renaming the file revokes the
credential: the next release fails at the OIDC exchange rather than at a test.
There is no `NPM_TOKEN` here and nothing to rotate.

Every guard in that job is a mistake clockwork2 made and paid for, and each is
held by `scripts/release-version.test.ts` because a workflow cannot be unit
tested:

- **A dispatch bumps.** It used to publish whatever version the tree held, so
  a dispatch after a merge found that version on the registry, skipped, and
  reported success having released nothing.
- **The checkout is `fetch-depth: 0`.** commit-and-tag-version reads the
  commits since the most recent tag, and a shallow clone has none: it compared
  from the wrong tag and re-listed a release's worth of commits that had
  already shipped.
- **It rebuilds after the bump**, because `dist` is what the tarball carries.
- **It refuses a tree with nothing new since the last tag**, and
  `scripts/release-notes.ts` throws on an empty changelog section. Between
  them that is the version whose release body says nothing about itself.
- **The tag names the bump commit**, not the one the job checked out.

`.versionrc.json`'s `prerelease` hook runs the gate before the version is
bumped, so it never sees the tree a release actually ships. Anything holding
the version literal therefore has to be in `bumpFiles`; clockwork2 lost several
releases to exactly that, and `scripts/release-version.test.ts` is where the
next such file gets caught.

## Following the engine

`.github/workflows/engine-update.yml` asks the registry once a day whether
`@clockwork2/engine` has a newer release, and opens a pull request when it
does. It asks the registry rather than listening to clockwork2: a dispatch
from there would need a long-lived token with write access here, which is the
thing trusted publishing exists to avoid, and it would only fire for a release
cut that particular way.

The bump itself is `scripts/bump-engine.ts`, which moves the version in all six
places it is written - the root's pin, the peer range, the template's own
dependency, the kernel version each example manifest declares, and the range
`docs/sdk.md` quotes - and throws rather than skipping a file that does not
hold what it expected. Raising the range is still a deliberate act: the pull
request is where it is decided, not the merge.

**That pull request has no checks of its own.** GitHub starts no workflow for a
pull request opened with `GITHUB_TOKEN`, so the gate runs in the job that opens
it and the result goes in the body with a link to the run. A failing gate still
opens the pull request, because "the new engine breaks us" is the most useful
form this notification takes. Pushing any commit to the branch gives it real
checks.

## Commit gates

Two hooks run on every commit. `pre-commit` lints. `commit-msg` runs
commitlint and demands a `Docs-Updated:` trailer. Never bypass either with
`--no-verify`.

The trailer records the pass no test can make. Most of what this package
documents is a contract rather than a behaviour - which slots a scheme has,
what a frame may import, which headers make a sandboxed frame load - and
nothing measures whether a paragraph about one of those is still true. Writing
the trailer says you re-read the pages covering what you changed and brought
them back in line.

It is demanded when the commit stages anything under `packages/`, `e2e/`,
`scripts/`, `skill/`, `docs/`, `templates/` or `fixtures/`, or `README.md`,
`package.json`, `tsconfig*.json`, `biome.json`, `bunfig.toml` or `.github/`.
Merge, revert, fixup, squash and `chore(release)` commits are exempt: git and
commit-and-tag-version write those messages themselves, some with no editor at
all.

A value under ten characters is rejected, as is a stamp from the list in
`scripts/check-docs-updated.ts`. Say what you did, inside the 100 columns
commitlint allows a trailer line:

    Docs-Updated: added the dpad+2 slots to sdk.md and to the skill's controls page
    Docs-Updated: re-read sdk.md on the two artifacts; the rewrite is unchanged
    Docs-Updated: new browser test only, no documented contract moved

The trailer has to be true. A new path carrying documentation joins
`BEARING_PATTERNS` in `scripts/check-docs-updated.ts` in the same change.

## Prose

Run the `humanizer` skill over anything a person reads before committing it:
`README.md`, the package README, `docs/sdk.md`, `SKILL.md` and its references,
and release notes. Rewrite what it flags rather than patching the flagged
phrase.

The house rules it does not cover:

- Hyphens, never em dashes, in code, comments, docs and commit messages alike.
- Sentence case in headings.
- Write for a reader who has not seen this before. Explain the thing itself.
- State the measurement rather than the adjective.

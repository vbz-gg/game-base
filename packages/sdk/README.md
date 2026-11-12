# @vbz-gg/sdk

The SDK for building a game that runs on [vbz.gg](https://vbz.gg), the backend
that checks and ranks the scores of a game studio's games.

A game on vbz.gg is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation: fixed-step ticks, seeded randomness, and an input log that a server
replays to check the score. This package is what sits between that, the vbz.gg
platform and your studio's page: the on-screen controls, the two artifacts an
upload carries, and a harness that frames your game locally the way it runs in
production.

Versions up to 0.2.0 were published as `@vbz-gg/game-base`, with the command
`game-base`. The command is now `vbz`.

```bash
bunx @vbz-gg/sdk new ./my-game
cd ./my-game && bun install
bun run dev
```

That copy builds and plays before a line of it is changed, so anything that
breaks afterwards is something you just did. Its id comes from the directory
name and is immutable once published.

`@clockwork2/engine` is a peer dependency, so your game installs one copy of
the engine rather than two.

## The four commands

```bash
vbz new     <dir>   copy a game that already conforms, and rename it
vbz build   <dir>   write dist/sim.js, dist/frame.js and dist/manifest.json
vbz dev     <dir>   serve the game on two origins, the way production does
vbz publish <dir> --game <id>   upload dist/ and wait for the verdict
```

`dev` is your game's page on your laptop: the game in a sandboxed frame
on one origin, the page that frames it on another, and the pad your manifest
asked for drawn over it. A scheme picker switches layouts without editing the
manifest, and ending a run publishes its recording.

`publish` is for your build system. It uploads `dist/` to the game you name,
with one of your studio's secret keys from `VBZ_STUDIO_KEY`, then waits for
the platform's checks:

```bash
VBZ_STUDIO_KEY=vbz_sk_... vbz publish . --game <game id>
```

It exits 0 only when the version went live. A rejection exits 1 and prints
the code and the first check that failed. The platform is
`https://studio.vbz.gg` unless `--api` or `VBZ_API_ORIGIN` names another.
Don't add a script called `publish` to your `package.json`: npm runs a script
with that name on its own, as part of `npm publish`.

## On-screen controls

A phone has no keyboard, so a game says in its manifest how it expects to be
steered there. There are two ways, and the difference is who draws the buttons.

**The page hosting your game draws them**, with this package's renderer. Name a
scheme and put your own actions in its slots:

```ts
inputs: {
  map: {
    left: [{ code: "ArrowLeft", device: "key" }],
    right: [{ code: "ArrowRight", device: "key" }],
  },
  controls: {
    mode: "scheme",
    scheme: "dpad",
    bind: { left: "left", right: "right" },
  },
}
```

Four schemes: `tap` is one button covering the viewport, and `dpad`, `dpad+1`
and `dpad+2` are a direction pad with nought, one or two action buttons beside
it. Bind the slots you use and leave the rest of the layout empty - the example
above draws two buttons in a d-pad's left and right positions.

The renderer owns every pixel of those buttons, which is what lets it promise
they are thumb-sized, clear of the notch and the home indicator, and the same
in every game that uses them. The platform refuses an upload that names a
scheme this package cannot draw.

**You draw them.** Declare `controls: { mode: "custom" }`, paint the controls
in your own renderer, and read pointer input. The host draws nothing and
promises nothing. Two rules follow from the engine's own: a game may not build
an input event, so the hit test goes in `tick()` rather than in the renderer,
and it works in simulation units because the host has already quantised the
pointer against a viewport that differs from one device to the next.

Leaving `controls` out says your game wants a keyboard. A page hosting it can
read that from the manifest and tell a phone player so, rather than framing a
canvas they cannot steer.

## Typing your calls to the platform

`@vbz-gg/sdk/api` holds the shapes of every route a game's page or a build
system calls on vbz.gg, as TypeScript types only:

```ts
import type { PlatformRoutes, PublicRefusalCode, StartedRun } from "@vbz-gg/sdk/api"

type Board = PlatformRoutes["GET /v1/board"]["response"]
```

A refusal arrives as `{ error, message }`, where `error` is one of
`PublicRefusalCode`. Switch on the code, never on the status.

## Talking to the platform from your page

`@vbz-gg/sdk/platform` is your page's client for vbz.gg: it signs a player
in, starts a run, sends the run as it goes, submits it, and reads the board.
`@vbz-gg/sdk/host` puts the game on your page: the sandboxed frame, the
controls its manifest asks for, a sign-in button and a board table.

```ts
import { mountBoard, mountSignIn, playRun } from "@vbz-gg/sdk/host"
import { createPlatformClient } from "@vbz-gg/sdk/platform"

const platform = createPlatformClient({
  apiOrigin: API_ORIGIN, // from vbz.gg
  signInOrigin: SIGN_IN_ORIGIN, // from vbz.gg
  pageKey: PAGE_KEY, // vbz_pk_..., from the dashboard
})

// Opens the sign-in window in the click itself, the only place a browser
// opens one.
mountSignIn(signInSlot, { client: platform })
const board = mountBoard(boardSlot, { client: platform, period: "week" })
await board.refresh()

playButton.onclick = async () => {
  const run = await platform.startRun()
  playRun(stage, {
    client: platform,
    run,
    onState: (state) => render(state), // ends at "done", with the replay's result
  })
}
```

`stage` needs a positioning context of its own: the frame fills it and the
controls sit on top. A press on a control goes through the run, so one before
the run starts or after it ends reaches nothing. The widgets take their
colours from `--gb-widget-*` custom properties, as the pad takes its from
`--gb-control-*`. `mountHost` is the frame and controls alone, for a page that
drives `Run` from `@vbz-gg/sdk/platform` itself.

The player's token is kept in `localStorage` and renewed at every run start.
A failure is a `PlatformRefusal`, carrying the platform's code, or a
`PlatformClientError`, carrying the client's, such as `E_POPUP_BLOCKED`.
Switch on `code`. The platform's page guide has every route, and the
`page.md` reference in the skill has every client code.

## Using the renderer yourself

If you are building a host rather than a game:

```ts
import { mountControls } from "@vbz-gg/sdk/controls"

const pad = mountControls(playView, {
  scheme: "dpad+1",
  bind: { left: "left", right: "right", a: "jump" },
  onPress: (action, value) => frame.virtualInput(action, value),
})
```

It takes an element and gives back `update` and `destroy`. Plain DOM, so it
works in React and outside it. It sets its own layout, hit target and
safe-area clearance and takes its appearance from CSS custom properties
(`--gb-control-bg`, `--gb-control-size`, `--gb-control-radius` and the rest),
so a host restyles it without importing a stylesheet.

`destroy` and `update` both send a release for anything still held. A held
control that never comes up is not a visual bug: it runs the player into a
wall for the rest of the session.

## License

MIT

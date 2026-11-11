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

## The three commands

```bash
vbz new   <dir>   copy a game that already conforms, and rename it
vbz build <dir>   write dist/sim.js, dist/frame.js and dist/manifest.json
vbz dev   <dir>   serve the game on two origins, the way production does
```

`dev` is your game's page on your laptop: the game in a sandboxed frame
on one origin, the page that frames it on another, and the pad your manifest
asked for drawn over it. A scheme picker switches layouts without editing the
manifest, and ending a run publishes its recording.

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

```ts
import { createGameFrame } from "@clockwork2/engine/parent"
import { createPlatformClient, Run } from "@vbz-gg/sdk/platform"

const platform = createPlatformClient({
  apiOrigin: API_ORIGIN, // from vbz.gg
  signInOrigin: SIGN_IN_ORIGIN, // from vbz.gg
  pageKey: PAGE_KEY, // vbz_pk_..., from the dashboard
})

// From the click itself: the browser opens the sign-in window only there.
signInButton.onclick = () => platform.signIn()

playButton.onclick = async () => {
  const run = await platform.startRun()
  const driver = new Run({
    client: platform,
    run,
    mount: (handlers) =>
      createGameFrame({ container: stage, src: run.game.frameUrl, ...handlers }),
    onState: (state) => render(state), // ends at "done", with the replay's result
  })
}

const board = await platform.board({ period: "week" })
```

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

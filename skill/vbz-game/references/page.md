# The page: `@vbz-gg/sdk/platform` and `@vbz-gg/sdk/host`

A studio serves its game from a page of its own. The page signs a player in,
starts a run, frames the game, sends the run to the platform as it goes,
submits the recording and reads the board. `@vbz-gg/sdk/platform` does all of
that against the platform's routes, and `@vbz-gg/sdk/host` puts the frame,
its controls and two widgets on the page. The platform's page guide,
`docs/your-game-page.md` in vbz-gg/platform, is the protocol they follow.

## The client

```ts
import { createGameFrame } from "@clockwork2/engine/parent"
import { createPlatformClient, Run } from "@vbz-gg/sdk/platform"

const platform = createPlatformClient({
  apiOrigin: API_ORIGIN, // from vbz.gg
  signInOrigin: SIGN_IN_ORIGIN, // from vbz.gg
  pageKey: PAGE_KEY, // vbz_pk_..., from the dashboard
})

const page = await platform.game() // today's round, or null
signInButton.onclick = () => platform.signIn() // from the click, nothing awaited first
```

- `signIn()` opens the sign-in window before it awaits anything, because a
  browser opens one only in the click's own turn. Call it straight from the
  handler.
- The player's token is kept in `localStorage`, one entry per page key, and
  in memory, so a browser that keeps nothing still plays this visit. Every run
  start renews it. A token the platform stops honouring is dropped, and
  `onSignedOut` is told.
- `signOut()` forgets the player on this page. No route signs a player out;
  the sign-in window's own page does that.

## A run

```ts
import { mountBoard, mountSignIn, playRun } from "@vbz-gg/sdk/host"

mountSignIn(signInSlot, { client: platform }) // opens the window in the click
const board = mountBoard(boardSlot, { client: platform, period: "day" })
await board.refresh()

const run = await platform.startRun() // { practice: true } for practice
const played = playRun(stage, {
  client: platform,
  run,
  onState: (state) => show(state), // waiting, playing, submitting, replaying, done, failed
})
// played.end() when the player leaves; played.destroy() before the next run
```

`playRun` frames `run.game.frameUrl` in `stage`, draws the controls the
run's own manifest asks for, and sends their presses through the run, so a
press before the run starts or after it ends is dropped. `stage` needs a
positioning context of its own: the frame fills it and the controls sit on
top. The widgets take their colours from `--gb-widget-*` custom properties,
as the pad takes its from `--gb-control-*`.

A page that frames the game itself uses `Run` directly, and keeps the host so
it can take the controls down with the frame:

```ts
let host: Host | undefined
const driver = new Run({
  client: platform,
  run,
  mount: (handlers) => {
    host = mountHost(stage, {
      frameUrl: run.game.frameUrl,
      manifest: run.game.manifest,
      handlers,
      onPress: (action, value) => driver.press(action, value),
    })
    return host.frame
  },
  onState: (state) => show(state),
})
// before the next run: driver.destroy(), then host?.destroy()
```

`Run` holds the rules a page would otherwise get wrong:

- The frame must report the run's manifest hash before a tick runs, or the
  run fails with `E_WRONG_GAME`.
- Each chunk ends at the last complete tick: one short of the last tick the
  frame reported while the run plays, the end tick once it has ended.
- A chunk or a submit that got no answer, or that the platform or a proxy in
  front of it failed with a 5xx, goes again, unchanged. A refusal does not.
- A failure is final: nothing more is sent, and the state stays `failed`.
- The last chunk reaches the platform before the recording.
- After the submit it waits for the replay, and `done` carries the result:
  what the replay computed, never what the frame showed.

Frame each run with its own `run.game.frameUrl`, and make a new frame for each
run. A drawn pad passes presses to `driver.press(action, value)`.

`mountHost` refuses before anything is framed when the manifest asks for
something a host cannot do, and refuses a frame that answers in another
version of the engine's frame protocol, so nothing is started in it.

## Codes

A `PlatformRefusal` carries the platform's own code, from `PublicRefusalCode`
in `@vbz-gg/sdk/api`. A `PlatformClientError` is the client's:

| Code | What it means |
|---|---|
| `E_POPUP_BLOCKED` | The browser blocked the sign-in window: `signIn()` ran outside a click, or after an await. |
| `E_SIGNIN_CLOSED` | The window closed without handing a code over. If it closed by itself at once, the page sends `Cross-Origin-Opener-Policy: same-origin`, which cuts it off from the window. |
| `E_NOT_SIGNED_IN` | A run route, and no player is signed in on this page. Nothing was sent. |
| `E_UNREACHABLE` | No answer. The request may or may not have arrived; a run write can be sent again. |
| `E_ANSWER_UNREADABLE` | An answer that is not JSON, or a failure without a code. |
| `E_WRONG_GAME` | The frame serves another version than the run plays. |
| `E_TICK_RATE_UNSUPPORTED` | The run's tick rate is not 30, 60 or 120. |
| `E_RECORDING_UNREADABLE` | The frame's recording did not parse. |
| `E_FRAME_FAILED` | The frame posted an error of its own; the state's `detail` has it. |
| `E_FRAME_PROTOCOL` | The frame answered in another version of the engine's frame protocol than the page's engine. Build the page and the game against the same engine minor. |
| `E_MANIFEST_UNREADABLE` | The manifest handed to a host is not an object with readable `inputs`. |
| `E_SCHEME_UNDRAWABLE` | The manifest names a scheme this SDK does not draw, or binds a slot the scheme does not have. |
| `E_SIM_PACKS` | The manifest declares a data pack the simulation reads. The platform cannot store or replay one yet, and refuses such an upload too. |
| `E_UNEXPECTED` | An error the client has no code for. It is a bug; report the `detail`. |

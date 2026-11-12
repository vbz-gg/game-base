/**
 * The page that frames the game, as a game's page in production does.
 *
 * Full viewport, one floating mark, and the controls the game's manifest asks
 * for, all through `mountHost`, the code a game's page frames a game with.
 * What it adds, which a game's page does not need, is a scheme picker, so an
 * author can see their game under `dpad`, `dpad+2` and its own custom
 * controls without editing a manifest between each one.
 *
 * This file is bundled for the browser at harness start and served from the
 * host origin. It is the only part of the harness that runs in a page.
 */

import {
  CONTROL_SCHEMES,
  type ControlScheme,
  isControlScheme,
  SCHEMES,
} from "../../controls/index.js"
import { type Host, type HostedControls, mountHost } from "../../host/index.js"

interface HarnessConfig {
  readonly frameOrigin: string
  readonly title: string
  readonly seed: string
  readonly tickHz: 30 | 60 | 120
  readonly maxTicks: number
  readonly config: unknown
  /** The game's own manifest, as the frame origin serves its game. */
  readonly manifest: unknown
}

const config = JSON.parse(
  document.getElementById("harness-config")?.textContent ?? "{}",
) as HarnessConfig

const stage = document.getElementById("stage") as HTMLElement
const status = document.getElementById("status") as HTMLElement
const picker = document.getElementById("picker") as HTMLSelectElement
const save = document.getElementById("save") as HTMLAnchorElement
const runBlock = document.getElementById("run") as HTMLScriptElement

/**
 * The run's result, and the recording of it.
 *
 * A recording arrives in pieces after `ended`, because it is one string and a
 * long run makes a long one. They are collected by index rather than
 * appended, since nothing in the protocol promises the order they are
 * delivered in, and the whole thing is published only once every piece is
 * here - half a recording decodes to nothing and would read as a corrupt run
 * rather than an incomplete download.
 */
let result: {
  readonly tick: number
  readonly counters: Record<string, number>
  readonly reason: string
} | null = null
const pieces = new Map<number, string>()

function collect(index: number, total: number, data: string): void {
  pieces.set(index, data)
  if (pieces.size < total) return
  const recording = Array.from(
    { length: total },
    (_, at) => pieces.get(at) ?? "",
  ).join("")
  runBlock.textContent = JSON.stringify({ result, recording })
  save.href = URL.createObjectURL(
    new Blob([recording], { type: "application/json" }),
  )
  save.hidden = false
  // What a reader outside the page waits for: the run is over and its
  // evidence is complete.
  document.body.dataset.run = "recorded"
}

function say(message: string): void {
  status.textContent = message
}

/**
 * Mounts the game, or says why a host would refuse it. A manifest naming a
 * scheme this SDK does not draw, or a data pack the simulation reads, is
 * refused by every host, so it is refused here before an upload is.
 */
function mount() {
  try {
    return mountHost(stage, {
      frameUrl: `${config.frameOrigin}/play`,
      manifest: config.manifest,
      title: config.title,
      handlers: {
        onReady: () => {
          say("ready")
          host?.frame.init(
            config.seed,
            config.config,
            config.tickHz,
            config.maxTicks,
          )
        },
        onStarted: () => say("playing"),
        onProgress: (message) => say(`tick ${message.tick}`),
        onEnded: (message) => {
          result = {
            tick: message.tick,
            counters: message.counters,
            reason: message.reason,
          }
          const counters = Object.entries(message.counters)
            .map(([name, value]) => `${name} ${value}`)
            .join(", ")
          say(
            `${message.reason} at tick ${message.tick}${counters === "" ? "" : ` - ${counters}`}`,
          )
        },
        onRecordingChunk: (message) =>
          collect(message.index, message.total, message.data),
        onError: (message) =>
          say(`the frame reported ${message.code}: ${message.detail ?? ""}`),
        onRefused: (error) => refuse(error.code, error.message),
      },
    })
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string }
    refuse(code ?? "refused", message ?? String(error))
    return null
  }
}

/**
 * What a host refused, said in the status line and marked on the body,
 * the same way for a manifest refused before framing and a frame refused
 * at its hello.
 */
function refuse(code: string, message: string): void {
  say(`${code}: ${message}`)
  document.body.dataset.refused = code
}

const host: Host | null = mount()

/**
 * The controls for whatever the picker says.
 *
 * `custom` and `keyboard` both draw nothing, and they mean different things:
 * the game paints its own, or the game wants a keyboard. An author should be
 * able to see both, because on a phone they look identical until you try to
 * play.
 */
function chosen(host: Host, choice: string): HostedControls {
  if (!isControlScheme(choice)) {
    return choice === "custom" ? { mode: "custom" } : { mode: "keyboard" }
  }
  // The game's own binding, but only for the scheme the game named. Under
  // any other layout it binds different slots, and handing its d-pad binding
  // to `dpad+2` drew that game's two buttons and called it six.
  const declared = host.controls.mode === "scheme" ? host.controls : null
  return {
    mode: "scheme",
    scheme: choice,
    bind:
      declared !== null && declared.scheme === choice
        ? declared.bind
        : defaultBind(host, choice),
  }
}

/**
 * What to bind when the picker shows a scheme the game did not declare.
 *
 * An author trying `dpad+2` on a game whose manifest says `dpad` has bound
 * four slots and not six, so the two extra buttons would have no action to
 * send. Binding a slot to its own name makes them visible and inert, which is
 * what an author wants to see: the layout, with the slots their game does not
 * use plainly doing nothing.
 */
function defaultBind(
  host: Host,
  scheme: ControlScheme,
): Record<string, string> {
  const declared = host.controls.mode === "scheme" ? host.controls.bind : {}
  const own = SCHEMES[scheme].slots.map((s) => [s.slot, s.slot] as const)
  // Only the declared slots this layout has: a `dpad+2` binding of `b`
  // would otherwise reach `dpad+1`, which has no `b` to draw it in.
  const known = new Set(own.map(([slot]) => slot))
  return {
    ...Object.fromEntries(own),
    ...Object.fromEntries(
      Object.entries(declared).filter(([slot]) => known.has(slot)),
    ),
  }
}

function applyScheme(host: Host, choice: string): void {
  const controls = chosen(host, choice)
  host.showControls(controls)
  if (controls.mode === "custom") say("the game draws its own")
  if (controls.mode === "keyboard") say("no on-screen pad")
}

// A game a host refused gets no picker and no buttons that would do nothing.
if (host !== null) wire(host)

function wire(host: Host): void {
  for (const option of [...CONTROL_SCHEMES, "custom", "off"]) {
    const node = document.createElement("option")
    node.value = option
    node.textContent = option
    picker.append(node)
  }

  const initial =
    host.controls.mode === "scheme"
      ? host.controls.scheme
      : host.controls.mode === "custom"
        ? "custom"
        : "off"
  picker.value = initial
  picker.addEventListener("change", () => applyScheme(host, picker.value))
  applyScheme(host, initial)

  document.getElementById("start")?.addEventListener("click", () => {
    host.frame.start()
  })

  // Ends the run where it stands, which is how an author gets a recording out
  // of a game they do not intend to lose at.
  document.getElementById("end")?.addEventListener("click", () => {
    host.frame.end()
  })
}

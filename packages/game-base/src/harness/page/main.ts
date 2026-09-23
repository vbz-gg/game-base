/**
 * The page that frames the game, as the arcade's play view does.
 *
 * Full viewport, one floating mark, and the controls the game's manifest asks
 * for. What it adds that the arcade does not is a scheme picker, so an author
 * can see their game under `dpad`, `dpad+2` and its own custom controls
 * without editing a manifest between each one.
 *
 * This file is bundled for the browser at harness start and served from the
 * host origin. It is the only part of the harness that runs in a page.
 */

import { createGameFrame } from "@clockwork2/engine/parent"
import {
  CONTROL_SCHEMES,
  type ControlScheme,
  isControlScheme,
  type MountedControls,
  mountControls,
} from "../../controls/index.js"

interface HarnessConfig {
  readonly frameOrigin: string
  readonly title: string
  readonly seed: string
  readonly tickHz: 30 | 60 | 120
  readonly maxTicks: number
  readonly config: unknown
  /** What the game's own manifest declares, if it declares anything. */
  readonly controls:
    | {
        readonly mode: "scheme"
        readonly scheme: string
        readonly bind: Record<string, string>
      }
    | { readonly mode: "custom" }
    | null
}

const config = JSON.parse(
  document.getElementById("harness-config")?.textContent ?? "{}",
) as HarnessConfig

const stage = document.getElementById("stage") as HTMLElement
const status = document.getElementById("status") as HTMLElement
const picker = document.getElementById("picker") as HTMLSelectElement
const save = document.getElementById("save") as HTMLAnchorElement
const runBlock = document.getElementById("run") as HTMLScriptElement

let pad: MountedControls | null = null

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

const frame = createGameFrame({
  container: stage,
  src: `${config.frameOrigin}/play?parent=${encodeURIComponent(location.origin)}`,
  title: config.title,
  onReady: () => {
    say("ready")
    frame.init(config.seed, config.config, config.tickHz, config.maxTicks)
  },
  onStarted: () => say("playing"),
  onProgress: (message) => {
    say(`tick ${message.tick}`)
  },
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
  onRecordingChunk: (message) => {
    collect(message.index, message.total, message.data)
  },
  onError: (message) => {
    say(`the frame reported ${message.code}: ${message.detail ?? ""}`)
  },
})

/**
 * Redraws the pad for whatever the picker says.
 *
 * `custom` and `off` both draw nothing, and they mean different things: the
 * game paints its own, or the game wants a keyboard. An author should be able
 * to see both, because on a phone they look identical until you try to play.
 */
function applyScheme(choice: string): void {
  pad?.destroy()
  pad = null
  if (!isControlScheme(choice)) {
    say(choice === "custom" ? "the game draws its own" : "no on-screen pad")
    return
  }
  // The game's own binding, but only for the scheme the game named. Under
  // any other layout it binds different slots, and handing its d-pad binding
  // to `dpad+2` drew that game's two buttons and called it six.
  const declared = config.controls?.mode === "scheme" ? config.controls : null
  const bind =
    declared !== null && declared.scheme === choice
      ? declared.bind
      : defaultBind(choice)
  pad = mountControls(stage, {
    scheme: choice,
    bind,
    onPress: (action, value) => frame.virtualInput(action, value),
  })
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
function defaultBind(scheme: ControlScheme): Record<string, string> {
  const declared =
    config.controls?.mode === "scheme" ? config.controls.bind : {}
  return {
    ...Object.fromEntries(slotsOf(scheme).map((s) => [s, s])),
    ...declared,
  }
}

function slotsOf(scheme: ControlScheme): string[] {
  return scheme === "tap"
    ? ["tap"]
    : scheme === "dpad"
      ? ["up", "down", "left", "right"]
      : scheme === "dpad+1"
        ? ["up", "down", "left", "right", "a"]
        : ["up", "down", "left", "right", "a", "b"]
}

for (const option of [...CONTROL_SCHEMES, "custom", "off"]) {
  const node = document.createElement("option")
  node.value = option
  node.textContent = option
  picker.append(node)
}

const initial =
  config.controls === null
    ? "off"
    : config.controls.mode === "custom"
      ? "custom"
      : config.controls.scheme
picker.value = initial
picker.addEventListener("change", () => applyScheme(picker.value))
applyScheme(initial)

document.getElementById("start")?.addEventListener("click", () => {
  frame.start()
})

// Ends the run where it stands, which is how an author gets a recording out
// of a game they do not intend to lose at.
document.getElementById("end")?.addEventListener("click", () => {
  frame.end()
})

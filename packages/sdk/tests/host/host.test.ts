/**
 * The host, against a document and a recording frame: what the frame is
 * asked to load, what reaches the page from it, and where a press on a
 * drawn control goes.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { mountHost } from "../../src/host/host"
import type { PlatformClientError } from "../../src/platform/errors"
import { frameMaker } from "./frame"

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://studio-page.example/play" })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let stage: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  stage = document.createElement("div")
  document.body.append(stage)
})

const DPAD = {
  inputs: {
    controls: {
      mode: "scheme",
      scheme: "dpad",
      bind: { left: "west", right: "east" },
    },
  },
}

const buttons = () => [...stage.querySelectorAll("button")]

function press(button: HTMLElement): void {
  button.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 1, bubbles: true }),
  )
}

describe("the frame", () => {
  test("loads the game document with the page's origin as its parent", () => {
    const frames = frameMaker()
    mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1?theme=dark",
      manifest: DPAD,
      title: "Lane runner",
      createFrame: frames.createFrame,
    })
    const [frame] = frames.made
    const src = new URL(frame?.options.src ?? "")
    expect(src.origin + src.pathname).toBe("https://bundles.example/v/v-1")
    expect(src.searchParams.get("parent")).toBe("https://studio-page.example")
    expect(src.searchParams.get("theme")).toBe("dark")
    expect(frame?.options.container).toBe(stage)
    expect(frame?.options.title).toBe("Lane runner")
  })

  test("a frame in this engine's protocol reaches the page", () => {
    const frames = frameMaker()
    const ready: string[] = []
    const refused: string[] = []
    mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1",
      manifest: DPAD,
      handlers: {
        onReady: (message) => ready.push(message.manifestHash),
        onRefused: (error) => refused.push(error.code),
      },
      createFrame: frames.createFrame,
    })
    frames.made[0]?.ready("mh-1")
    expect(ready).toEqual(["mh-1"])
    expect(refused).toEqual([])
  })

  test("a frame in another protocol is refused, and never reported ready", () => {
    // Every message after the hello would be misread, so nothing starts.
    const frames = frameMaker()
    const ready: string[] = []
    const refused: PlatformClientError[] = []
    mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1",
      manifest: DPAD,
      handlers: {
        onReady: (message) => ready.push(message.manifestHash),
        onRefused: (error) => refused.push(error),
      },
      createFrame: frames.createFrame,
    })
    frames.made[0]?.ready("mh-1", 2)
    expect(ready).toEqual([])
    expect(refused.map((error) => error.code)).toEqual(["E_FRAME_PROTOCOL"])
    expect(refused[0]?.cause).toEqual({ frame: 2, page: 1 })
  })

  test("every other message reaches the handler of its name", () => {
    const frames = frameMaker()
    const seen: string[] = []
    mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1",
      manifest: DPAD,
      handlers: {
        onStarted: () => seen.push("started"),
        onProgress: () => seen.push("progress"),
        onCheckpoint: () => seen.push("checkpoint"),
        onLogChunk: () => seen.push("log-chunk"),
        onEnded: () => seen.push("ended"),
        onRecordingChunk: () => seen.push("recording-chunk"),
        onError: () => seen.push("error"),
        onHeartbeat: () => seen.push("heartbeat"),
      },
      createFrame: frames.createFrame,
    })
    const options = frames.made[0]?.options
    options?.onStarted?.()
    options?.onProgress?.({ type: "progress", tick: 1, counters: {} })
    options?.onCheckpoint?.({ type: "checkpoint", tick: 1, hash: "h" })
    options?.onLogChunk?.({ type: "log-chunk", fromIndex: 0, inputs: [] })
    options?.onEnded?.({
      type: "ended",
      tick: 2,
      counters: {},
      reason: "completed",
      finalSnapshot: {} as never,
    })
    options?.onRecordingChunk?.({
      type: "recording-chunk",
      index: 0,
      total: 1,
      data: "{}",
    })
    options?.onError?.({ type: "error", code: "E_X", detail: "" })
    options?.onHeartbeat?.({ type: "heartbeat", tick: 3 })
    expect(seen).toEqual([
      "started",
      "progress",
      "checkpoint",
      "log-chunk",
      "ended",
      "recording-chunk",
      "error",
      "heartbeat",
    ])
  })

  test("with no handlers, a frame's messages go nowhere and break nothing", () => {
    const frames = frameMaker()
    mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1",
      manifest: DPAD,
      createFrame: frames.createFrame,
    })
    const frame = frames.made[0]
    frame?.ready("mh-1")
    frame?.ready("mh-1", 9)
    frame?.options.onStarted?.()
    frame?.options.onError?.({ type: "error", code: "E_X", detail: "" })
    frame?.options.onHeartbeat?.({ type: "heartbeat", tick: 1 })
    expect(frame?.calls).toEqual([])
  })

  test("a manifest a host cannot draw is refused before anything is framed", () => {
    const frames = frameMaker()
    expect(() =>
      mountHost(stage, {
        frameUrl: "https://bundles.example/v/v-1",
        manifest: { inputs: { controls: { mode: "scheme", scheme: "stick" } } },
        createFrame: frames.createFrame,
      }),
    ).toThrow("the game's manifest names on-screen controls")
    expect(frames.made).toEqual([])
    expect(stage.children).toHaveLength(0)
  })
})

describe("the controls", () => {
  test("are the manifest's, and press into the frame", () => {
    const frames = frameMaker()
    const host = mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1",
      manifest: DPAD,
      createFrame: frames.createFrame,
    })
    expect(host.controls).toEqual({
      mode: "scheme",
      scheme: "dpad",
      bind: { left: "west", right: "east" },
    })
    // The two slots the game binds, in the scheme's order.
    expect(buttons().map((b) => b.dataset.slot)).toEqual(["left", "right"])
    press(buttons()[1] as HTMLElement)
    expect(frames.made[0]?.calls).toEqual([["virtualInput", "east", 1]])
  })

  test("press where the page says, when it says", () => {
    const frames = frameMaker()
    const pressed: Array<[string, number]> = []
    mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1",
      manifest: DPAD,
      onPress: (action, value) => pressed.push([action, value]),
      createFrame: frames.createFrame,
    })
    press(buttons()[0] as HTMLElement)
    expect(pressed).toEqual([["west", 1]])
    expect(frames.made[0]?.calls).toEqual([])
  })

  test("custom and keyboard games get none", () => {
    for (const controls of [{ mode: "custom" }, undefined]) {
      const frames = frameMaker()
      const host = mountHost(stage, {
        frameUrl: "https://bundles.example/v/v-1",
        manifest: { inputs: controls === undefined ? {} : { controls } },
        createFrame: frames.createFrame,
      })
      expect(buttons()).toEqual([])
      host.destroy()
    }
  })

  test("can be swapped, and are gone with the host", () => {
    const frames = frameMaker()
    const host = mountHost(stage, {
      frameUrl: "https://bundles.example/v/v-1",
      manifest: DPAD,
      createFrame: frames.createFrame,
    })
    host.showControls({ mode: "scheme", scheme: "tap", bind: { tap: "go" } })
    expect(buttons().map((b) => b.dataset.slot)).toEqual(["tap"])
    host.showControls({ mode: "custom" })
    expect(buttons()).toEqual([])
    host.showControls({ mode: "scheme", scheme: "tap", bind: { tap: "go" } })
    host.hideControls()
    expect(buttons()).toEqual([])
    expect(frames.made[0]?.calls).toEqual([])

    host.showControls({ mode: "scheme", scheme: "dpad", bind: { up: "n" } })
    host.destroy()
    host.destroy()
    expect(buttons()).toEqual([])
    expect(frames.made[0]?.calls).toEqual([["destroy"]])
    // A host taken down draws nothing again.
    host.showControls({ mode: "scheme", scheme: "dpad", bind: { up: "n" } })
    expect(buttons()).toEqual([])
  })
})

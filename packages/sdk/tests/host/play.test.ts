/**
 * One platform run through a host: the frame is the run's, the controls press
 * through the run, and a frame the host refuses fails the run with its code.
 * What the run sends the platform is held in `tests/platform/run.test.ts`;
 * this holds the wiring between the two.
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
import type { StartedRun } from "../../src/api/index"
import { playRun } from "../../src/host/play"
import { RUN_PHASE, type RunState } from "../../src/platform/run"
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

const RUN: StartedRun = {
  sessionId: "s-1",
  mode: "ranked",
  day: "2026-11-12",
  rankedRunsLeft: null,
  seed: "seed-1",
  config: {},
  game: {
    id: "v-1",
    frameUrl: "https://bundles.example/v/v-1",
    manifestHash: "mh-1",
    manifest: {
      inputs: {
        controls: { mode: "scheme", scheme: "tap", bind: { tap: "flap" } },
      },
    },
    tickHz: 60,
    maxTicks: 600,
    maxWallSeconds: 60,
  },
  token: "t-run",
  expiresIn: 3600,
}

/** A client that never has to answer: these runs never reach a submit. */
const CLIENT = {
  sendChunk: async () => ({ seq: 0, throughTick: 0 }),
  submit: async () => ({ sessionId: "s-1", recordingSha256: "r" }),
  awaitResult: async () => {
    throw new Error("not reached")
  },
}

/** A whole tap: the control goes down and comes up again. */
function tap(): void {
  const button = stage.querySelector("button") as HTMLElement
  for (const type of ["pointerdown", "pointerup"]) {
    button.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, bubbles: true }),
    )
  }
}

describe("a run through a host", () => {
  test("frames the run's own document, with the run's controls", () => {
    const frames = frameMaker()
    const played = playRun(stage, {
      client: CLIENT,
      run: RUN,
      title: "Flapper",
      createFrame: frames.createFrame,
    })
    const frame = frames.made[0]
    expect(new URL(frame?.options.src ?? "").pathname).toBe("/v/v-1")
    expect(frame?.options.title).toBe("Flapper")
    expect(played.host.frame).toBe(frame as never)
    expect(played.host.controls.mode).toBe("scheme")
  })

  test("a press reaches the frame only while the run plays", () => {
    const frames = frameMaker()
    playRun(stage, {
      client: CLIENT,
      run: RUN,
      createFrame: frames.createFrame,
    })
    const frame = frames.made[0]
    // Before the frame is ready, nothing is recording a press.
    tap()
    frame?.ready("mh-1")
    tap()
    expect(frame?.calls.filter(([call]) => call === "virtualInput")).toEqual([
      ["virtualInput", "flap", 1],
      ["virtualInput", "flap", 0],
    ])
  })

  test("a frame in another protocol fails the run with its code", () => {
    const frames = frameMaker()
    const states: RunState[] = []
    const played = playRun(stage, {
      client: CLIENT,
      run: RUN,
      onState: (state) => states.push(state),
      createFrame: frames.createFrame,
    })
    frames.made[0]?.ready("mh-1", 2)
    expect(states.at(-1)?.phase).toBe(RUN_PHASE.FAILED)
    expect(states.at(-1)?.errorCode).toBe("E_FRAME_PROTOCOL")
    // Which side is which, so an author can tell which one is stale.
    expect(states.at(-1)?.detail).toContain('{"frame":2,"page":1}')
    // Nothing was started in it.
    expect(frames.made[0]?.calls.map(([call]) => call)).toEqual([])
    expect(played.run.current.phase).toBe(RUN_PHASE.FAILED)
  })

  test("a run that fails takes its controls with it", () => {
    // A frame serving another version is destroyed by the run itself; its
    // buttons would otherwise stay over an empty stage.
    const frames = frameMaker()
    const states: RunState[] = []
    playRun(stage, {
      client: CLIENT,
      run: RUN,
      onState: (state) => states.push(state),
      createFrame: frames.createFrame,
    })
    expect(stage.querySelectorAll("button")).toHaveLength(1)
    frames.made[0]?.ready("mh-other")
    expect(states.at(-1)?.errorCode).toBe("E_WRONG_GAME")
    expect(stage.querySelectorAll("button")).toHaveLength(0)
  })

  test("the controls stay while the run plays", () => {
    const frames = frameMaker()
    playRun(stage, {
      client: CLIENT,
      run: RUN,
      createFrame: frames.createFrame,
    })
    frames.made[0]?.ready("mh-1")
    expect(stage.querySelectorAll("button")).toHaveLength(1)
  })

  test("the player leaving ends the run in the frame", () => {
    const frames = frameMaker()
    const played = playRun(stage, {
      client: CLIENT,
      run: RUN,
      createFrame: frames.createFrame,
    })
    frames.made[0]?.ready("mh-1")
    played.end()
    expect(frames.made[0]?.calls.at(-1)).toEqual(["end"])
  })

  test("taken down, the frame and the controls are gone", () => {
    const frames = frameMaker()
    const played = playRun(stage, {
      client: CLIENT,
      run: RUN,
      createFrame: frames.createFrame,
    })
    played.destroy()
    expect(stage.querySelectorAll("button")).toHaveLength(0)
    expect(frames.made[0]?.calls.map(([call]) => call)).toContain("destroy")
  })

  test("a run whose manifest a host cannot draw is refused before a frame", () => {
    const frames = frameMaker()
    const run: StartedRun = {
      ...RUN,
      game: { ...RUN.game, manifest: { assets: [{ requiredForSim: true }] } },
    }
    expect(() =>
      playRun(stage, { client: CLIENT, run, createFrame: frames.createFrame }),
    ).toThrow("data pack")
    expect(frames.made).toEqual([])
  })
})

/**
 * The renderer, against a document.
 *
 * happy-dom rather than a hand-rolled fake, because what is being tested here
 * is largely what a browser does with the nodes: which listeners fire, in what
 * order, and what a grid position ends up as. A fake that answered those
 * questions would be a second browser with its own bugs.
 *
 * What it cannot answer is whether a control is reachable by a thumb on a real
 * screen. That is the Playwright suite's job.
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
import { MIN_TOUCH_PX, mountControls } from "../../src/controls/render"

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let host: HTMLElement
let pressed: Array<[string, number]>

beforeEach(() => {
  document.body.replaceChildren()
  host = document.createElement("div")
  document.body.append(host)
  pressed = []
})

function mount(
  scheme: Parameters<typeof mountControls>[1]["scheme"],
  bind: Record<string, string>,
  labels?: Record<string, string>,
) {
  return mountControls(host, {
    scheme,
    bind,
    onPress: (action, value) => pressed.push([action, value]),
    ...(labels === undefined ? {} : { labels }),
  })
}

function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")]
}

/** A pointer event happy-dom will dispatch with the fields the code reads. */
function pointer(type: string, pointerId = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId, isPrimary: true })
  return event
}

describe("drawing a scheme", () => {
  test("a bound slot becomes a button and an unbound one does not", () => {
    mount("dpad", { left: "port", right: "starboard" })
    expect(buttons().map((b) => b.dataset.slot)).toEqual(["left", "right"])
  })

  test("a slot the scheme does not have draws nothing", () => {
    mount("dpad", { left: "port", jump: "hop" })
    expect(buttons().map((b) => b.dataset.slot)).toEqual(["left"])
  })

  /**
   * The directions and the action buttons are separate clusters, so a thumb
   * reaches each without the other moving. One flat grid would put `a` beside
   * `right` and leave the player pressing the wrong one.
   */
  test("directions and actions are laid out as two clusters", () => {
    mount("dpad+2", {
      up: "u",
      down: "d",
      left: "l",
      right: "r",
      a: "jump",
      b: "shoot",
    })
    const left = host.querySelector(".gb-controls-left")
    const right = host.querySelector(".gb-controls-right")
    expect(
      [...(left?.children ?? [])].map((c) => (c as HTMLElement).dataset.slot),
    ).toEqual(["up", "left", "down", "right"])
    expect(
      [...(right?.children ?? [])].map((c) => (c as HTMLElement).dataset.slot),
    ).toEqual(["a", "b"])
  })

  test("a side with nothing bound gets no cluster at all", () => {
    mount("dpad+2", { a: "jump" })
    expect(host.querySelector(".gb-controls-left")).toBeNull()
    expect(host.querySelector(".gb-controls-right")).not.toBeNull()
  })

  /**
   * The container must not swallow taps. Everything between and around the
   * buttons belongs to the game underneath, which on a `dpad` is most of the
   * screen.
   */
  test("only the buttons take a tap", () => {
    mount("dpad", { left: "l" })
    const root = host.querySelector(".gb-controls") as HTMLElement
    expect(root.style.pointerEvents).toBe("none")
    expect(buttons()[0]?.style.pointerEvents).toBe("auto")
  })

  /** A control smaller than this is one a thumb misses. */
  test("a control is never drawn below the minimum touch size", () => {
    mount("dpad", { up: "u" })
    const button = buttons()[0] as HTMLElement
    expect(button.style.minWidth).toBe(`${MIN_TOUCH_PX}px`)
    expect(button.style.minHeight).toBe(`${MIN_TOUCH_PX}px`)
  })

  /**
   * The pad sits along the bottom rather than filling the element, so the
   * game above it stays visible.
   *
   * Its safe-area clearance is not asserted here and cannot be: happy-dom
   * drops `max(14px, env(safe-area-inset-bottom))` on the floor, returning
   * an empty string for the longhand and `14px` through `setProperty`. A
   * test against that would be measuring happy-dom's CSS parser. The
   * clearance is checked in the browser suite, where the value is real.
   */
  test("the pad sits along the bottom", () => {
    mount("dpad", { up: "u" })
    const root = host.querySelector(".gb-controls") as HTMLElement
    expect(root.style.alignItems).toBe("flex-end")
    expect(root.style.justifyContent).toBe("space-between")
  })

  test("tap covers the viewport and draws no furniture", () => {
    mount("tap", { tap: "flap" })
    const button = buttons()[0] as HTMLElement
    expect(button.style.inset).toBe("0")
    expect(button.style.background).toContain("transparent")
    expect(button.textContent).toBe("")
  })

  test("tap with nothing bound draws no button", () => {
    mount("tap", {})
    expect(buttons()).toHaveLength(0)
  })

  /** A game whose "A" means "Jump" says so, and a screen reader reads that. */
  test("a game's own label wins over the slot's default", () => {
    mount("dpad+1", { a: "jump" }, { a: "Jump" })
    expect(buttons()[0]?.getAttribute("aria-label")).toBe("Jump")
    mount("dpad+1", { a: "jump" })
    expect(buttons().at(-1)?.getAttribute("aria-label")).toBe("Action")
  })
})

describe("pressing a control", () => {
  test("a press sends 1 and a release sends 0", () => {
    mount("dpad", { left: "port" })
    const button = buttons()[0] as HTMLElement
    button.dispatchEvent(pointer("pointerdown"))
    button.dispatchEvent(pointer("pointerup"))
    expect(pressed).toEqual([
      ["port", 1],
      ["port", 0],
    ])
  })

  /**
   * The defect this renderer exists to stop. The arcade's own pad bound
   * `pointerdown` and nothing else, so a held control never came up: a game
   * reading a direction change survived it, and a platformer holding `right`
   * ran into the wall for the rest of the session.
   */
  test("a press that is never released is not possible to produce", () => {
    mount("dpad+1", { a: "jump" })
    const button = buttons()[0] as HTMLElement
    for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
      pressed.length = 0
      button.dispatchEvent(pointer("pointerdown"))
      button.dispatchEvent(pointer(ending))
      expect(pressed).toEqual([
        ["jump", 1],
        ["jump", 0],
      ])
    }
  })

  /**
   * `pointercancel` is the browser taking the pointer away - a scroll gesture
   * winning, a finger leaving the screen edge. A renderer listening only for
   * `pointerup` leaves that control held with no event coming.
   */
  test("a cancelled pointer releases", () => {
    mount("dpad", { down: "duck" })
    const button = buttons()[0] as HTMLElement
    button.dispatchEvent(pointer("pointerdown"))
    button.dispatchEvent(pointer("pointercancel"))
    expect(pressed.at(-1)).toEqual(["duck", 0])
  })

  test("a second press while already held sends nothing", () => {
    mount("dpad", { up: "u" })
    const button = buttons()[0] as HTMLElement
    button.dispatchEvent(pointer("pointerdown"))
    button.dispatchEvent(pointer("pointerdown"))
    expect(pressed).toEqual([["u", 1]])
  })

  test("a release with no press behind it sends nothing", () => {
    mount("dpad", { up: "u" })
    const button = buttons()[0] as HTMLElement
    button.dispatchEvent(pointer("pointerup"))
    expect(pressed).toEqual([])
  })

  /** Two controls at once, which is what a d-pad and a button are for. */
  test("two controls can be held together and release independently", () => {
    mount("dpad+1", { right: "east", a: "jump" })
    const [right, jump] = buttons()
    right?.dispatchEvent(pointer("pointerdown", 1))
    jump?.dispatchEvent(pointer("pointerdown", 2))
    jump?.dispatchEvent(pointer("pointerup", 2))
    expect(pressed).toEqual([
      ["east", 1],
      ["jump", 1],
      ["jump", 0],
    ])
  })

  test("the default is prevented, so a tap does not also scroll or select", () => {
    mount("dpad", { up: "u" })
    const button = buttons()[0] as HTMLElement
    const event = pointer("pointerdown")
    button.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe("swapping and tearing down", () => {
  /**
   * A scheme swapped while a control is held has to put it down first. The
   * button it was sent from is about to stop existing, so no event will ever
   * arrive to release it.
   */
  test("changing the scheme releases what was held", () => {
    const mounted = mount("dpad", { left: "port" })
    ;(buttons()[0] as HTMLElement).dispatchEvent(pointer("pointerdown"))
    mounted.update({
      scheme: "dpad+2",
      bind: { a: "jump" },
      onPress: (action, value) => pressed.push([action, value]),
    })
    expect(pressed).toEqual([
      ["port", 1],
      ["port", 0],
    ])
    expect(buttons().map((b) => b.dataset.slot)).toEqual(["a"])
  })

  test("destroy releases what was held and removes the element", () => {
    const mounted = mount("dpad", { left: "port" })
    ;(buttons()[0] as HTMLElement).dispatchEvent(pointer("pointerdown"))
    mounted.destroy()
    expect(pressed).toEqual([
      ["port", 1],
      ["port", 0],
    ])
    expect(host.querySelector(".gb-controls")).toBeNull()
  })

  test("destroy with nothing held sends nothing", () => {
    mount("dpad", { left: "port" }).destroy()
    expect(pressed).toEqual([])
  })

  /**
   * A release goes to whoever is listening now, not to whoever was listening
   * when the control went down. A host that swapped its handler mid-run would
   * otherwise send the release into a closure nobody reads.
   */
  test("a release after update reaches the new handler", () => {
    const mounted = mount("dpad", { left: "port" })
    const later: Array<[string, number]> = []
    mounted.update({
      scheme: "dpad",
      bind: { left: "port" },
      onPress: (action, value) => later.push([action, value]),
    })
    const button = buttons()[0] as HTMLElement
    button.dispatchEvent(pointer("pointerdown"))
    button.dispatchEvent(pointer("pointerup"))
    expect(later).toEqual([
      ["port", 1],
      ["port", 0],
    ])
  })
})

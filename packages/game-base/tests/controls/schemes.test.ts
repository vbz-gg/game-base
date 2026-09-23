import { describe, expect, test } from "bun:test"
import {
  boundSlots,
  CONTROL_SCHEMES,
  type ControlScheme,
  isControlScheme,
  SCHEMES,
  unknownSlots,
} from "../../src/controls/schemes"

describe("the scheme table", () => {
  /**
   * The table is a contract between three places that cannot see each other:
   * a game's manifest names a scheme, the arcade draws it, and ingest refuses
   * a name it does not know. A scheme in the list with no entry here, or an
   * entry whose id disagrees with its key, breaks one of the three silently.
   */
  test("every listed scheme has an entry that agrees with its own name", () => {
    expect(Object.keys(SCHEMES).sort()).toEqual([...CONTROL_SCHEMES].sort())
    for (const id of CONTROL_SCHEMES) {
      expect(SCHEMES[id].id).toBe(id)
      expect(SCHEMES[id].slots.length).toBeGreaterThan(0)
    }
  })

  /**
   * Two slots in one cell of one side draw on top of each other, and the one
   * underneath takes no taps at all. Nothing else would report that: both
   * buttons exist in the DOM and one of them is simply unreachable.
   */
  test("no two slots of a scheme share a cell", () => {
    for (const id of CONTROL_SCHEMES) {
      const cells = SCHEMES[id].slots.map(
        (slot) => `${slot.side}:${slot.column}:${slot.row}`,
      )
      expect(new Set(cells).size).toBe(cells.length)
    }
  })

  test("slot names are unique within a scheme", () => {
    for (const id of CONTROL_SCHEMES) {
      const names = SCHEMES[id].slots.map((slot) => slot.slot)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  /** Every scheme names its slots; a label is what a screen reader reads. */
  test("every slot carries a label", () => {
    for (const id of CONTROL_SCHEMES) {
      for (const slot of SCHEMES[id].slots) {
        expect(slot.label.length).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The four directions keep their names across every scheme that has them,
   * so a game moving from `dpad` to `dpad+2` changes one word in its manifest
   * and not its binding.
   */
  test("the d-pad schemes share the same four direction slots", () => {
    const directions = (id: ControlScheme) =>
      SCHEMES[id].slots
        .filter((slot) => slot.side === "left")
        .map((slot) => slot.slot)
        .sort()
    expect(directions("dpad")).toEqual(["down", "left", "right", "up"])
    expect(directions("dpad+1")).toEqual(directions("dpad"))
    expect(directions("dpad+2")).toEqual(directions("dpad"))
  })

  test("tap is the only layout that covers the viewport", () => {
    expect(SCHEMES.tap.layout).toBe("full")
    expect(SCHEMES.tap.slots).toHaveLength(1)
    for (const id of ["dpad", "dpad+1", "dpad+2"] as const) {
      expect(SCHEMES[id].layout).toBe("pad")
    }
  })

  test("a name outside the table is not a scheme", () => {
    expect(isControlScheme("dpad")).toBe(true)
    expect(isControlScheme("twin-stick")).toBe(false)
    expect(isControlScheme("constructor")).toBe(false)
  })
})

describe("binding slots to a game's actions", () => {
  /**
   * A game binds what it uses. A left-and-right game sits in a d-pad's left
   * and right positions rather than being refused or being given two buttons
   * that send nothing.
   */
  test("only bound slots come back", () => {
    const bound = boundSlots("dpad", { left: "port", right: "starboard" })
    expect(bound.map((slot) => [slot.slot, slot.action])).toEqual([
      ["left", "port"],
      ["right", "starboard"],
    ])
  })

  /**
   * Read from the scheme rather than from the binding. Iterating the binding
   * would put the buttons in whatever order the manifest happened to list
   * them, so two games on one scheme would tab differently and a screenshot
   * of one would not describe the other.
   */
  test("the order is the scheme's, not the manifest's", () => {
    const declared = boundSlots("dpad+2", {
      b: "special",
      right: "east",
      up: "north",
      a: "jump",
    })
    expect(declared.map((slot) => slot.slot)).toEqual(["up", "right", "a", "b"])
  })

  test("a slot the scheme does not have is reported rather than drawn", () => {
    expect(unknownSlots("dpad", { left: "l", jump: "j" })).toEqual(["jump"])
    expect(unknownSlots("dpad+2", { a: "x", b: "y" })).toEqual([])
    // A scheme with no action buttons is where this bites: `a` looks
    // plausible and is not there.
    expect(unknownSlots("dpad", { a: "jump" })).toEqual(["a"])
  })

  test("an empty binding draws nothing", () => {
    expect(boundSlots("dpad", {})).toEqual([])
  })
})

/**
 * Where a chunk ends. Claiming the last reported tick while the run plays
 * gets the next chunk refused for an input at that tick.
 */

import { describe, expect, test } from "bun:test"
import { throughTickFor } from "../../src/platform/chunks"

describe("a chunk's throughTick", () => {
  test("while the run plays, it stops one tick short of the last reported", () => {
    expect(
      throughTickFor({
        tick: 120,
        inputTicks: [],
        ended: false,
        postedThrough: -1,
      }),
    ).toBe(119)
  })

  test("but it always reaches the highest input it carries", () => {
    expect(
      throughTickFor({
        tick: 120,
        inputTicks: [42, 120],
        ended: false,
        postedThrough: 50,
      }),
    ).toBe(120)
  })

  test("once the run has ended, it reaches the end tick", () => {
    expect(
      throughTickFor({
        tick: 300,
        inputTicks: [10],
        ended: true,
        postedThrough: 119,
      }),
    ).toBe(300)
  })

  test("nothing new complete is no chunk at all", () => {
    expect(
      throughTickFor({
        tick: 120,
        inputTicks: [],
        ended: false,
        postedThrough: 119,
      }),
    ).toBeNull()
  })
})

/**
 * A game whose controls are its own, steered by two fingers.
 *
 * This is the fixture that proves the engine's pointer work landed rather
 * than typechecked. Before it, every touch shared one stream of coordinates
 * and the first finger to lift sent a release while the other was still down,
 * so a game drawing its own d-pad and its own jump button could not have
 * both. Nothing short of two real fingers on a real page shows that.
 */

import { devices, expect, test } from "@playwright/test"
import { Fingers } from "../src/fingers"
import { endRun, framePoint, log, open, play } from "../src/run"

test.use({ ...devices["Pixel 7"] })

/** Down the frame, inside the grab bar the simulation hit-tests for. */
const GRAB = 0.9

test("a game that draws its own controls gets no pad from the host", async ({
  page,
}) => {
  await open(page, "paddle")
  await expect(page.locator("#stage .gb-controls")).toHaveCount(0)
  // The picker opens on what the manifest declared, which is the harness
  // saying it understood `{ mode: "custom" }` rather than finding nothing.
  await expect(page.locator("#picker")).toHaveValue("custom")
})

test("two fingers are two pointers, and lifting one does not lift the other", async ({
  page,
}) => {
  await open(page, "paddle")
  await play(page)

  const first = await framePoint(page, 0.25, GRAB)
  const dragged = await framePoint(page, 0.7, GRAB)
  const second = await framePoint(page, 0.85, 0.45)

  const fingers = await Fingers.on(page)
  await fingers.down(1, first.x, first.y)
  await fingers.move(1, dragged.x, dragged.y)
  // A second finger, landing while the first is still dragging. It is the
  // one that could not exist before: slot 1 rather than a second helping of
  // slot 0.
  await fingers.down(2, second.x, second.y)
  await fingers.up(1)
  await fingers.up(2)

  const entries = log(await endRun(page))
  expect(entries).toContain("touch=1")
  expect(entries).toContain("boost=1")

  expect(entries.indexOf("boost=1")).toBeLessThan(entries.indexOf("touch=0"))
  expect(entries.indexOf("touch=0")).toBeLessThan(entries.indexOf("boost=0"))
})

/**
 * The drag reaches the simulation in the simulation's own units.
 *
 * `quantisePoint` divides by the container before the log ever sees a
 * coordinate, so what is recorded is a position in the 1000-wide playfield
 * the game hit-tests against rather than a CSS pixel on this phone.
 */
test("a drag arrives as positions in the game's own space", async ({
  page,
}) => {
  await open(page, "paddle")
  await play(page)

  const fingers = await Fingers.on(page)
  const start = await framePoint(page, 0.15, GRAB)
  await fingers.down(1, start.x, start.y)
  for (const across of [0.3, 0.5, 0.7, 0.85]) {
    const at = await framePoint(page, across, GRAB)
    await fingers.move(1, at.x, at.y)
  }
  await fingers.up(1)

  const run = await endRun(page)
  const aimed = run.recording.inputs
    .filter((input) => input.code === "aimX")
    .map((input) => input.value)

  expect(aimed.length).toBeGreaterThan(1)
  // A phone 412 CSS pixels wide, reported as a playfield 1000 units wide.
  for (const value of aimed) {
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(1000)
  }
  const began = aimed[0] ?? 0
  const last = aimed[aimed.length - 1] ?? 0
  expect(last).toBeGreaterThan(began)
  // The drag crossed seven tenths of the frame, and the frame is the
  // playfield's full 1000 units wide, so it has to read as about 700.
  expect(last - began).toBeGreaterThan(500)
})

/**
 * The run the browser played, replayed away from it.
 *
 * This is the claim the arcade is built on, checked here so an author meets
 * it on a laptop: the input log a browser produced, replayed against the same
 * simulation, reaches the same counters at the same tick. The simulation is
 * fetched from the frame origin at its content address rather than imported
 * from the source tree, so it is the module the page loaded and not a second
 * build of the same file.
 */

import { devices, expect, test } from "@playwright/test"
import { Fingers } from "../src/fingers"
import { endRun, framePoint, open, play, replay } from "../src/run"

test.use({ ...devices["Pixel 7"] })

test("a pad run replays to the score the browser showed", async ({ page }) => {
  await open(page, "template")
  await play(page)

  const pad = "#stage .gb-controls"
  await page.locator(`${pad} [data-slot="left"]`).tap()
  await page.locator(`${pad} [data-slot="right"]`).tap()
  await page.locator(`${pad} [data-slot="right"]`).tap()

  const run = await endRun(page)
  expect(run.recording.format).toBe("cw2-recording")
  expect(run.recording.gameId).toBe("lane-runner")
  // A recording with no inputs replays perfectly and proves nothing, so the
  // presses have to be in it before the comparison is worth making.
  expect(run.recording.inputs.filter((i) => i.value === 1).length).toBe(3)
  expect(run.result.tick).toBeGreaterThan(0)

  const replayed = await replay("template", run)
  expect(replayed.comparison.differences).toEqual([])
  expect(replayed.comparison.divergedAt).toBeNull()
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.endTick).toBe(run.result.tick)
  expect(replayed.counters).toEqual(run.result.counters)
})

/**
 * The same, for a game steered by pointers rather than by a pad.
 *
 * Worth its own run: a pad press enters the log as one virtual value, and a
 * drag enters it as a stream of quantised coordinates. If quantisation were
 * done anywhere but before the log, this is where the two would disagree.
 */
test("a two-finger run replays to the score the browser showed", async ({
  page,
}) => {
  await open(page, "paddle")
  await play(page)

  const fingers = await Fingers.on(page)
  const grabbed = await framePoint(page, 0.3, 0.9)
  const dragged = await framePoint(page, 0.6, 0.9)
  const boost = await framePoint(page, 0.85, 0.45)
  const further = await framePoint(page, 0.75, 0.9)
  await fingers.down(1, grabbed.x, grabbed.y)
  await fingers.move(1, dragged.x, dragged.y)
  await fingers.down(2, boost.x, boost.y)
  await fingers.move(1, further.x, further.y)
  await fingers.up(1)
  await fingers.up(2)

  const run = await endRun(page)
  expect(run.recording.gameId).toBe("paddle")
  // Without this the test passes on a run that recorded nothing, and an
  // empty log replays perfectly.
  expect(run.recording.inputs.length).toBeGreaterThan(4)
  expect(run.recording.inputs.some((input) => input.code === "boost")).toBe(
    true,
  )

  const replayed = await replay("paddle", run)
  expect(replayed.comparison.differences).toEqual([])
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.endTick).toBe(run.result.tick)
  expect(replayed.counters).toEqual(run.result.counters)
})

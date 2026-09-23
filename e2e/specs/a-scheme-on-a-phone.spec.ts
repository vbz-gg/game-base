/**
 * The pad the host draws, at the size a thumb meets it.
 *
 * The template binds two of a d-pad's four slots, which is the case worth
 * drawing: a game asks for the slots it uses and the other cells stay empty.
 * Everything here needs a real layout engine - a hit target measured in
 * pixels, a `max()` around an `env()`, a pointer that leaves the button it
 * pressed - and none of it can be asked of happy-dom.
 */

import { devices, expect, test } from "@playwright/test"
import { Fingers } from "../src/fingers"
import { endRun, log, open, play } from "../src/run"

test.use({ ...devices["Pixel 7"] })

const PAD = "#stage .gb-controls"

async function slots(page: import("@playwright/test").Page): Promise<string[]> {
  return await page
    .locator(`${PAD} button`)
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.slot ?? ""),
    )
}

test("the pad draws the slots the game bound, and no others", async ({
  page,
}) => {
  await open(page, "template")
  // Lane Runner moves sideways only. Reading the scheme rather than the
  // binding is what keeps the order stable, so `left` comes before `right`
  // however the manifest happened to list them.
  expect(await slots(page)).toEqual(["left", "right"])
})

/**
 * The two things a skin may not take away.
 *
 * happy-dom cannot represent `max(14px, env(safe-area-inset-bottom))` at all:
 * the longhand reads back empty and `setProperty` mangles it to `14px`, so
 * asserting it there would measure happy-dom's CSS parser. Here a real engine
 * resolves it - on a device reporting no inset, `env()` is 0 and the `max()`
 * is 14px - and what is checked is that the declaration parsed and applied.
 */
test("a control clears the safe area and is thumb-sized", async ({ page }) => {
  await open(page, "template")
  const padding = await page
    .locator(PAD)
    .evaluate((node) => getComputedStyle(node).paddingBottom)
  expect(padding).toBe("14px")

  const box = await page.locator(`${PAD} button`).first().boundingBox()
  expect(box).not.toBeNull()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

  // And inside the viewport it was drawn for, rather than off the bottom.
  const viewport = page.viewportSize()
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    viewport?.height ?? 0,
  )
})

test("a tap on a control reaches the recording, and so does letting go", async ({
  page,
}) => {
  await open(page, "template")
  await play(page)
  await page.locator(`${PAD} [data-slot="left"]`).tap()
  const run = await endRun(page)

  const entries = log(run)
  expect(entries).toContain("left=1")
  expect(entries).toContain("left=0")
  expect(entries.indexOf("left=1")).toBeLessThan(entries.indexOf("left=0"))
})

/**
 * The failure the arcade's first pad shipped with.
 *
 * It bound `pointerdown` and nothing else, so a held control never released
 * and a platformer holding `right` ran into the wall for the rest of the
 * session. This drives the case that breaks without pointer capture: a mouse
 * pointer, which is not implicitly captured the way a touch is, pressed on
 * the button and released somewhere else entirely.
 */
test("a pointer that slides off the button still releases it", async ({
  page,
}) => {
  await open(page, "template")
  await play(page)

  const box = await page.locator(`${PAD} [data-slot="right"]`).boundingBox()
  expect(box).not.toBeNull()
  const at = box ?? { x: 0, y: 0, width: 0, height: 0 }
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
  await page.mouse.down()
  await page.mouse.move(20, 20)
  await page.mouse.up()

  const entries = log(await endRun(page))
  expect(entries).toContain("right=1")
  expect(entries).toContain("right=0")
})

/**
 * The picker is the thing an author cannot do any other way: see their game
 * under a layout its manifest does not name, without editing the manifest.
 */
test("the picker draws whichever layout the author asks for", async ({
  page,
}) => {
  await open(page, "template")

  await page.locator("#picker").selectOption("dpad+2")
  expect(await slots(page)).toEqual(["up", "left", "down", "right", "a", "b"])

  // `tap` is the one layout with no furniture: the whole viewport is the
  // button, which is what a game steered by tapping anywhere wants.
  await page.locator("#picker").selectOption("tap")
  expect(await slots(page)).toEqual(["tap"])
  const box = await page.locator(`${PAD} button`).boundingBox()
  const viewport = page.viewportSize()
  expect(box?.width).toBe(viewport?.width)
  expect(box?.height).toBe(viewport?.height)

  // And `off` is the third answer a manifest can give: this game wants a
  // keyboard, which on a phone looks exactly like a game that draws its own
  // until you try to play it.
  await page.locator("#picker").selectOption("off")
  await expect(page.locator(`${PAD} button`)).toHaveCount(0)
  await expect(page.locator("#status")).toHaveText("no on-screen pad")
})

/** Two fingers on one pad, which is a jump-while-running. */
test("two controls can be held at once", async ({ page }) => {
  await open(page, "template")
  await play(page)

  const left = await page.locator(`${PAD} [data-slot="left"]`).boundingBox()
  const right = await page.locator(`${PAD} [data-slot="right"]`).boundingBox()
  expect(left).not.toBeNull()
  expect(right).not.toBeNull()
  const a = left ?? { x: 0, y: 0, width: 0, height: 0 }
  const b = right ?? { x: 0, y: 0, width: 0, height: 0 }

  const fingers = await Fingers.on(page)
  await fingers.down(1, a.x + a.width / 2, a.y + a.height / 2)
  await fingers.down(2, b.x + b.width / 2, b.y + b.height / 2)
  await fingers.up(1)
  await fingers.up(2)

  const entries = log(await endRun(page))
  // The second press arrives while the first is still down, and each one
  // releases on its own finger rather than on whichever lifted first.
  expect(entries.indexOf("right=1")).toBeLessThan(entries.indexOf("left=0"))
  expect(entries.indexOf("left=0")).toBeLessThan(entries.indexOf("right=0"))
})

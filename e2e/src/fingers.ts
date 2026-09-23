/**
 * More than one finger on the screen.
 *
 * Playwright's `touchscreen` taps once, with one point, which is exactly the
 * case a shared pointer stream already handled. Two fingers at once needs the
 * browser's own input protocol, so this drives `Input.dispatchTouchEvent`
 * over CDP and is Chromium-only - the reason the suite has one project.
 *
 * The protocol's own description of `touchPoints` - "active touch points on
 * the touch device" - holds for `touchStart` and `touchMove` and not for
 * `touchEnd`, which was measured rather than read. With two fingers down,
 * sending `touchEnd` with the point that is still down releases **that** one:
 * the sequence down(1), down(2), end([2]), end([]) produced pointerup for
 * finger 2 and then for finger 1. So an end carries the finger being lifted,
 * and a start or a move carries everything that is down.
 *
 * Getting that backwards lifts the wrong finger, which is exactly the
 * behaviour these tests exist to catch - arriving from the test harness
 * rather than from the code.
 */

import type { CDPSession, Page } from "@playwright/test"

export class Fingers {
  private readonly active = new Map<number, { x: number; y: number }>()

  private constructor(private readonly session: CDPSession) {}

  static async on(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page))
  }

  async down(id: number, x: number, y: number): Promise<void> {
    this.active.set(id, { x, y })
    await this.dispatch("touchStart")
  }

  async move(id: number, x: number, y: number): Promise<void> {
    this.active.set(id, { x, y })
    await this.dispatch("touchMove")
  }

  async up(id: number): Promise<void> {
    const at = this.active.get(id)
    if (at === undefined) return
    this.active.delete(id)
    await this.send("touchEnd", [{ id, x: at.x, y: at.y }])
  }

  private async dispatch(type: "touchStart" | "touchMove"): Promise<void> {
    await this.send(
      type,
      [...this.active].map(([id, at]) => ({ id, x: at.x, y: at.y })),
    )
  }

  private async send(
    type: "touchStart" | "touchMove" | "touchEnd",
    touchPoints: { id: number; x: number; y: number }[],
  ): Promise<void> {
    await this.session.send("Input.dispatchTouchEvent", { type, touchPoints })
  }
}

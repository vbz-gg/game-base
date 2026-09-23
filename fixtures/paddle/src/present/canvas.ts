/**
 * Paddle's renderer, which draws the controls the host does not.
 *
 * The grab bar is the control. It is drawn at `GRAB_TOP`, which is the same
 * constant the simulation hit-tests against, and that is the whole contract
 * of the custom path: a control drawn somewhere the simulation does not
 * believe it is, is a control a player presses and nothing happens.
 *
 * Everything here works in simulation units and scales to the canvas at the
 * end, so the two never disagree about where anything is.
 */

import type { Presentation } from "@clockwork2/engine"
import { DROP_RADIUS, PADDLE_Y, PLAYFIELD, type View } from "../sim"

export function createPaddlePresentation(): Presentation<View, HTMLElement> {
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null

  return {
    mount(container: HTMLElement): void {
      canvas = container.ownerDocument.createElement("canvas")
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvas.style.display = "block"
      canvas.style.touchAction = "none"
      container.append(canvas)
      context = canvas.getContext("2d")
    },

    render(view: View): void {
      if (canvas === null || context === null) return
      const size = Math.min(
        canvas.clientWidth || PLAYFIELD,
        canvas.clientHeight || PLAYFIELD,
      )
      if (canvas.width !== size) canvas.width = size
      if (canvas.height !== size) canvas.height = size
      const unit = size / PLAYFIELD

      context.fillStyle = "#0d0e11"
      context.fillRect(0, 0, size, size)

      // The control, drawn where the simulation hit-tests for it.
      context.fillStyle = "#191b20"
      context.fillRect(
        0,
        view.grabTop * unit,
        size,
        (PLAYFIELD - view.grabTop) * unit,
      )
      context.fillStyle = "#8c919c"
      context.font = `${Math.round(22 * unit)}px system-ui, sans-serif`
      context.textAlign = "center"
      context.fillText("drag here", size / 2, (view.grabTop + 40) * unit)

      context.fillStyle = "#f0a028"
      for (const drop of view.drops) {
        context.beginPath()
        context.arc(
          drop.x * unit,
          drop.y * unit,
          DROP_RADIUS * unit,
          0,
          Math.PI * 2,
        )
        context.fill()
      }

      context.fillStyle = view.boosting ? "#ffbe5c" : "#3bd68a"
      context.fillRect(
        (view.paddleX - view.paddleHalf) * unit,
        PADDLE_Y * unit,
        view.paddleHalf * 2 * unit,
        18 * unit,
      )
    },

    unmount(): void {
      canvas?.remove()
      canvas = null
      context = null
    },
  }
}

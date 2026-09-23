/**
 * Drawing a control scheme, in plain DOM.
 *
 * Plain DOM rather than a component, because the arcade's shell is React and
 * the local harness is not, and a component would make one of them wrap the
 * other. What both get instead is a function that takes an element and hands
 * back two more.
 *
 * It carries no colour of its own. Layout, hit target and safe-area clearance
 * are set here because a host cannot be trusted to keep them and a player
 * cannot play without them; everything a skin might want to change is a CSS
 * custom property with a fallback, so a host restyles it by setting
 * `--gb-control-bg` on any ancestor and needs no stylesheet from us.
 */

import {
  boundSlots,
  type ControlScheme,
  SCHEMES,
  type SchemeSlot,
} from "./schemes"

export interface ControlsOptions {
  readonly scheme: ControlScheme
  /** A slot of that scheme to one of the game's own action names. */
  readonly bind: Readonly<Record<string, string>>
  /**
   * A press, and its release. `value` is 1 when a control goes down and 0
   * when it comes up, exactly as a key does.
   */
  readonly onPress: (action: string, value: number) => void
  /** Overrides a slot's default label, for a game whose "A" means "Jump". */
  readonly labels?: Readonly<Record<string, string>>
}

export interface MountedControls {
  /** Swaps the scheme or the binding without remounting. */
  update(options: ControlsOptions): void
  /** Sends a release for everything still held, then removes the element. */
  destroy(): void
}

/** The smallest a control may be drawn, whatever a skin asks for. */
export const MIN_TOUCH_PX = 44

function styleControl(button: HTMLElement, slot: SchemeSlot): void {
  button.style.gridColumn = String(slot.column)
  button.style.gridRow = String(slot.row)
  button.style.pointerEvents = "auto"
  button.style.touchAction = "none"
  button.style.minWidth = `${MIN_TOUCH_PX}px`
  button.style.minHeight = `${MIN_TOUCH_PX}px`
  button.style.width = `var(--gb-control-size, 64px)`
  button.style.height = `var(--gb-control-size, 64px)`
  button.style.display = "inline-flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.border = "var(--gb-control-border, 1px solid #3a3d46)"
  button.style.borderRadius = "var(--gb-control-radius, 16px)"
  button.style.background = "var(--gb-control-bg, rgba(28, 31, 38, 0.86))"
  button.style.color = "var(--gb-control-fg, #ecedf0)"
  button.style.font = "var(--gb-control-font, 20px system-ui, sans-serif)"
  button.style.opacity = "var(--gb-control-opacity, 1)"
  button.style.userSelect = "none"
  button.style.cursor = "pointer"
}

function styleFull(button: HTMLElement): void {
  button.style.position = "absolute"
  button.style.inset = "0"
  button.style.width = "100%"
  button.style.height = "100%"
  button.style.pointerEvents = "auto"
  button.style.touchAction = "none"
  button.style.border = "0"
  button.style.background = "var(--gb-control-tap-bg, transparent)"
  button.style.cursor = "pointer"
}

function styleCluster(cluster: HTMLElement, side: "left" | "right"): void {
  cluster.style.display = "grid"
  cluster.style.gap = "var(--gb-control-gap, 9px)"
  cluster.style.pointerEvents = "none"
  cluster.style.justifyItems = side === "left" ? "start" : "end"
}

function styleRoot(root: HTMLElement, layout: "pad" | "full"): void {
  root.style.position = "absolute"
  root.style.inset = "0"
  // The container never takes a tap. Only the buttons do, so everything
  // between and around them reaches the game underneath.
  root.style.pointerEvents = "none"
  if (layout === "full") return
  root.style.display = "flex"
  root.style.alignItems = "flex-end"
  root.style.justifyContent = "space-between"
  // Clear of the notch, the home indicator and the rounded corners. A
  // control the player cannot reach is the same as one that is not there.
  root.style.padding = [
    "0",
    "max(14px, env(safe-area-inset-right))",
    "max(14px, env(safe-area-inset-bottom))",
    "max(14px, env(safe-area-inset-left))",
  ].join(" ")
}

/**
 * Draws a scheme into `element` and reports presses.
 *
 * `element` needs its own positioning context; the controls fill it. In the
 * arcade that is the play view, which is the whole viewport with the game
 * behind it, so the pad sits over the game's own letterbox margin where there
 * is one and over its art where there is not.
 */
export function mountControls(
  element: HTMLElement,
  options: ControlsOptions,
): MountedControls {
  const root = element.ownerDocument.createElement("div")
  root.className = "gb-controls"
  element.append(root)

  /**
   * What is currently held, by the action it sends.
   *
   * Held state lives here rather than on the button, because a release has to
   * be sendable without an event: a pointer that leaves the window, a scheme
   * swapped mid-run, or a destroy all have to put the control down. Getting
   * this wrong is not a visual bug. A held direction that never releases runs
   * the player into a wall for the rest of the session.
   */
  const held = new Map<Element, string>()
  let current = options

  function release(target: Element): void {
    const action = held.get(target)
    if (action === undefined) return
    held.delete(target)
    current.onPress(action, 0)
  }

  function releaseAll(): void {
    for (const target of [...held.keys()]) release(target)
  }

  function button(
    slot: SchemeSlot & { action: string },
    label: string,
  ): HTMLElement {
    const node = element.ownerDocument.createElement("button")
    node.type = "button"
    node.dataset.slot = slot.slot
    node.setAttribute("aria-label", label)
    node.textContent = slot.glyph

    node.addEventListener("pointerdown", (event) => {
      // Down rather than click: a tap that waits for the release arrives a
      // tick or two late, and this is the input the run is recorded from.
      event.preventDefault()
      if (held.has(node)) return
      held.set(node, slot.action)
      // Capture, so a finger that slides off the button still sends its
      // release to this button rather than to whatever is under it.
      if (event.isPrimary || event.pointerId !== undefined) {
        try {
          node.setPointerCapture(event.pointerId)
        } catch {
          // A synthetic event in a test has no real capture to take, and a
          // control that cannot be captured still has to work.
        }
      }
      current.onPress(slot.action, 1)
    })

    // Three ways a press ends. `pointerup` is the ordinary one.
    // `pointercancel` is the browser taking the pointer away - a scroll
    // gesture winning, the finger leaving the screen edge. And
    // `lostpointercapture` covers a capture broken by anything else. Listening
    // for only the first leaves the control held for the rest of the run.
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
      node.addEventListener(name, () => release(node))
    }
    return node
  }

  function draw(next: ControlsOptions): void {
    releaseAll()
    current = next
    root.replaceChildren()
    const scheme = SCHEMES[next.scheme]
    styleRoot(root, scheme.layout)

    const slots = boundSlots(next.scheme, next.bind)
    if (scheme.layout === "full") {
      const only = slots[0]
      if (only === undefined) return
      const node = button(only, next.labels?.[only.slot] ?? only.label)
      styleFull(node)
      root.append(node)
      return
    }

    for (const side of ["left", "right"] as const) {
      const mine = slots.filter((slot) => slot.side === side)
      if (mine.length === 0) continue
      const cluster = element.ownerDocument.createElement("div")
      cluster.className = `gb-controls-${side}`
      styleCluster(cluster, side)
      for (const slot of mine) {
        const node = button(slot, next.labels?.[slot.slot] ?? slot.label)
        styleControl(node, slot)
        cluster.append(node)
      }
      root.append(cluster)
    }
  }

  draw(options)

  return {
    update(next: ControlsOptions): void {
      draw(next)
    },
    destroy(): void {
      releaseAll()
      root.remove()
    },
  }
}

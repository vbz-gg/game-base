/**
 * The on-screen control layouts a host draws.
 *
 * A game names one of these in its manifest and binds the layout's slots to
 * its own actions, so a game calling its actions `north` and `south` works
 * without the host knowing those words. The host owns every pixel: a game
 * that wants its controls to look like its own art declares
 * `{ mode: "custom" }` instead and paints them in its renderer.
 *
 * The set is deliberately short. Each entry is a layout a host has to draw
 * correctly at every screen size, in a skin it chose, forever - so a scheme
 * earns its place by covering games that exist rather than by completing a
 * grid. Sticks are absent for a harder reason: a stick sends two axes per
 * control and `virtual-input` carries one value, so adding one is a change to
 * the engine's protocol rather than a row in this table.
 */

export const CONTROL_SCHEMES = ["tap", "dpad", "dpad+1", "dpad+2"] as const

export type ControlScheme = (typeof CONTROL_SCHEMES)[number]

/**
 * Where a slot sits, and what it looks like before a skin touches it.
 *
 * `column` and `row` are cells of that side's own small grid rather than
 * anything page-wide, so the left cluster and the right cluster are laid out
 * independently and a game binding one side draws nothing on the other.
 */
export interface SchemeSlot {
  readonly slot: string
  readonly side: "left" | "right"
  readonly column: number
  readonly row: number
  /** Drawn in the button. An arrow for a direction, a letter otherwise. */
  readonly glyph: string
  /** What a screen reader says when the game supplies no better name. */
  readonly label: string
}

export interface Scheme {
  readonly id: ControlScheme
  /**
   * `pad` puts its slots in two thumb-sized clusters along the bottom.
   * `full` is one button covering the viewport, which is what a game steered
   * by tapping anywhere wants and the only layout that draws no furniture.
   */
  readonly layout: "pad" | "full"
  readonly slots: readonly SchemeSlot[]
}

const DIRECTIONS: readonly SchemeSlot[] = [
  { slot: "up", side: "left", column: 2, row: 1, glyph: "↑", label: "Up" },
  { slot: "left", side: "left", column: 1, row: 2, glyph: "←", label: "Left" },
  { slot: "down", side: "left", column: 2, row: 2, glyph: "↓", label: "Down" },
  {
    slot: "right",
    side: "left",
    column: 3,
    row: 2,
    glyph: "→",
    label: "Right",
  },
]

// The classic diagonal pair, so a thumb reaches both without moving far. With
// one button it sits where the thumb already rests rather than where the
// second one would have gone.
const ACTION_A: SchemeSlot = {
  slot: "a",
  side: "right",
  column: 2,
  row: 1,
  glyph: "A",
  label: "Action",
}
const ACTION_B: SchemeSlot = {
  slot: "b",
  side: "right",
  column: 1,
  row: 2,
  glyph: "B",
  label: "Second action",
}
const ACTION_ALONE: SchemeSlot = { ...ACTION_A, column: 1, row: 2 }

export const SCHEMES: Readonly<Record<ControlScheme, Scheme>> = {
  tap: {
    id: "tap",
    layout: "full",
    slots: [
      {
        slot: "tap",
        side: "left",
        column: 1,
        row: 1,
        glyph: "",
        label: "Tap to play",
      },
    ],
  },
  dpad: { id: "dpad", layout: "pad", slots: DIRECTIONS },
  "dpad+1": {
    id: "dpad+1",
    layout: "pad",
    slots: [...DIRECTIONS, ACTION_ALONE],
  },
  "dpad+2": {
    id: "dpad+2",
    layout: "pad",
    slots: [...DIRECTIONS, ACTION_A, ACTION_B],
  },
}

export function isControlScheme(value: string): value is ControlScheme {
  return Object.hasOwn(SCHEMES, value)
}

/**
 * The slots a game actually asked for, in the order the scheme declares them.
 *
 * A game binds the slots it uses and no more, so a left-and-right game sits in
 * a d-pad's left and right positions with the other two cells empty. Reading
 * the scheme rather than the binding is what keeps that stable: iterating the
 * binding would put the buttons in whatever order the manifest happened to
 * list them, and two games with the same scheme would tab differently.
 */
export function boundSlots(
  scheme: ControlScheme,
  bind: Readonly<Record<string, string>>,
): readonly (SchemeSlot & { readonly action: string })[] {
  const out: (SchemeSlot & { action: string })[] = []
  for (const slot of SCHEMES[scheme].slots) {
    const action = bind[slot.slot]
    if (action !== undefined) out.push({ ...slot, action })
  }
  return out
}

/**
 * Slots named in a binding that the scheme does not have.
 *
 * A host refuses a game rather than drawing what it can and dropping the
 * rest, because a dropped binding is a control the player never sees and the
 * author never hears about.
 */
export function unknownSlots(
  scheme: ControlScheme,
  bind: Readonly<Record<string, string>>,
): readonly string[] {
  const known = new Set(SCHEMES[scheme].slots.map((s) => s.slot))
  return Object.keys(bind).filter((slot) => !known.has(slot))
}

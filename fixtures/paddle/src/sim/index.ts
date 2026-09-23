/**
 * Paddle - a game whose controls are its own.
 *
 * Drops fall, a paddle catches them, and the paddle is steered by dragging
 * anywhere on the playfield. Nothing about that is drawn by the host: the
 * renderer paints the paddle and a grab bar, and this file decides what a
 * touch at a given position means.
 *
 * That division is forced rather than chosen. A game may not construct an
 * input event, so a renderer deciding which control was pressed and handing
 * the answer over is the hole that rule closes. The hit test therefore lives
 * in `tick`, and it works in **simulation units** - `PLAYFIELD` wide, not
 * however many CSS pixels the player's screen happens to be - because the
 * host quantises a pointer against the viewport before the log ever sees it.
 *
 * The consequence to respect: the renderer has to draw each control where
 * this file believes it is. They agree here because both read `GRAB_TOP`.
 */

import {
  type Counters,
  type Effect,
  type GameModule,
  type InputEvent,
  Prng,
  type PrngState,
  type Snapshot,
} from "@clockwork2/engine"
import { MANIFEST } from "./manifest"

/** The simulation's own width and height. Not pixels, and never pixels. */
export const PLAYFIELD = 1000
export const PADDLE_HALF = 90
export const DROP_RADIUS = 22
export const PADDLE_Y = 900
/** Everything below this line is the grab bar the renderer draws. */
export const GRAB_TOP = 780
export const DROP_EVERY = 40
export const FALL_PER_TICK = 6
export const BOOST_WIDTH = 60

export interface Drop {
  readonly id: number
  x: number
  y: number
}

export interface View {
  readonly paddleX: number
  readonly paddleHalf: number
  readonly drops: readonly Drop[]
  readonly grabTop: number
  readonly boosting: boolean
  readonly caught: number
}

export interface Config {
  readonly dropEvery: number
}

export const DEFAULT_CONFIG: Config = { dropEvery: DROP_EVERY }

export class Paddle implements GameModule<View, Config> {
  readonly manifest = MANIFEST
  private config: Config = DEFAULT_CONFIG
  private rng!: Prng
  private paddleX = PLAYFIELD / 2
  private drops: Drop[] = []
  private nextId = 1
  private ticks = 0
  private caught = 0
  private missed = 0
  private over = false
  /** Whether a finger is down inside the grab bar, and which one. */
  private dragging = false
  private boosting = false
  private pending: Effect[] = []

  init(seed: string, config: Config = DEFAULT_CONFIG): void {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rng = new Prng(seed)
    this.paddleX = PLAYFIELD / 2
    this.drops = []
    this.nextId = 1
    this.ticks = 0
    this.caught = 0
    this.missed = 0
    this.over = false
    this.dragging = false
    this.boosting = false
    this.pending = []
  }

  tick(inputs: readonly InputEvent[]): void {
    if (this.over) return

    for (const input of inputs) this.apply(input)

    this.ticks += 1
    if (this.ticks % this.config.dropEvery === 0) {
      this.drops.push({
        id: this.nextId++,
        x: this.rng.randomInt(DROP_RADIUS, PLAYFIELD - DROP_RADIUS),
        y: -DROP_RADIUS,
      })
    }

    const half = this.halfWidth()
    const kept: Drop[] = []
    for (const drop of this.drops) {
      drop.y += FALL_PER_TICK
      if (drop.y < PADDLE_Y) {
        kept.push(drop)
        continue
      }
      if (Math.abs(drop.x - this.paddleX) <= half + DROP_RADIUS) {
        this.caught += 1
        this.pending.push({ type: "catch" })
      } else {
        this.missed += 1
        this.pending.push({ type: "miss" })
      }
    }
    this.drops = kept

    if (this.missed >= 3) this.over = true
  }

  /**
   * What a pointer at a position means.
   *
   * The hit test, and the reason it is here rather than in the renderer. A
   * touch counts as a grab only below `GRAB_TOP`, so a tap on the falling
   * drops does not yank the paddle across the screen - which is exactly the
   * kind of decision that would be invisible to a replay if a renderer made
   * it.
   */
  private apply(input: InputEvent): void {
    switch (input.code) {
      case "touch":
        // Value 1 is a finger landing; the y it landed at arrived in the
        // same tick, because the host pushes the position before the press.
        this.dragging = input.value === 1 && this.lastY >= GRAB_TOP
        if (input.value === 0) this.dragging = false
        break
      case "aimX":
        this.lastX = input.value
        if (this.dragging) this.paddleX = this.clamp(input.value)
        break
      case "aimY":
        this.lastY = input.value
        break
      case "boost":
        this.boosting = input.value === 1
        break
      case "boostX":
        break
      case "left":
        if (input.value === 1) this.paddleX = this.clamp(this.paddleX - 40)
        break
      case "right":
        if (input.value === 1) this.paddleX = this.clamp(this.paddleX + 40)
        break
      default:
        break
    }
  }

  private lastX = PLAYFIELD / 2
  private lastY = 0

  /** A second finger widens the paddle, which is what two fingers are for. */
  private halfWidth(): number {
    return this.boosting ? PADDLE_HALF + BOOST_WIDTH : PADDLE_HALF
  }

  private clamp(x: number): number {
    const half = this.halfWidth()
    return Math.max(half, Math.min(PLAYFIELD - half, x))
  }

  view(): View {
    return {
      paddleX: this.paddleX,
      paddleHalf: this.halfWidth(),
      drops: this.drops,
      grabTop: GRAB_TOP,
      boosting: this.boosting,
      caught: this.caught,
    }
  }

  snapshot(): Snapshot {
    return {
      rng: this.rng.exportState(),
      paddleX: this.paddleX,
      drops: this.drops.map((drop) => ({ ...drop })),
      nextId: this.nextId,
      ticks: this.ticks,
      caught: this.caught,
      missed: this.missed,
      over: this.over,
      dragging: this.dragging,
      boosting: this.boosting,
      lastX: this.lastX,
      lastY: this.lastY,
      config: { ...this.config },
    } as unknown as Snapshot
  }

  restore(snapshot: Snapshot): void {
    const s = snapshot as unknown as {
      rng: PrngState
      paddleX: number
      drops: Drop[]
      nextId: number
      ticks: number
      caught: number
      missed: number
      over: boolean
      dragging: boolean
      boosting: boolean
      lastX: number
      lastY: number
      config: Config
    }
    this.rng = new Prng("restored")
    this.rng.importState(s.rng)
    this.paddleX = s.paddleX
    this.drops = s.drops.map((drop) => ({ ...drop }))
    this.nextId = s.nextId
    this.ticks = s.ticks
    this.caught = s.caught
    this.missed = s.missed
    this.over = s.over
    this.dragging = s.dragging
    this.boosting = s.boosting
    this.lastX = s.lastX
    this.lastY = s.lastY
    this.config = { ...s.config }
    this.pending = []
  }

  score(): Counters {
    return { caught: this.caught, ticksSurvived: this.ticks }
  }

  isOver(): boolean {
    return this.over
  }

  effects(): readonly Effect[] {
    const out = this.pending
    this.pending = []
    return out
  }
}

export { MANIFEST } from "./manifest"

export default function createGame(): Paddle {
  return new Paddle()
}

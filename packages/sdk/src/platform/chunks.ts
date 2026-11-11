/**
 * Where a chunk of a run ends.
 *
 * The engine takes a tick's inputs before it runs that tick and writes the
 * tick's checkpoint after. So while a run plays, the inputs of the last tick
 * the frame reported may not all be in yet, and only the ticks before it are
 * complete. Claiming that last tick would get the next chunk refused for an
 * input at it, with `E_CHUNK_NOT_FORWARD`, and those inputs lost. Once the run
 * has ended, every tick up to the end is complete.
 *
 * An input the frame already sent is at a tick that has run, so a chunk
 * always reaches at least the highest input it carries.
 */

export interface ChunkReach {
  /** The last tick the frame reported, by `progress` or `ended`. */
  readonly tick: number
  readonly inputTicks: readonly number[]
  readonly ended: boolean
  /** The `throughTick` of the last chunk sent, or -1 before the first. */
  readonly postedThrough: number
}

/** The chunk's `throughTick`, or null when nothing new is complete yet. */
export function throughTickFor(reach: ChunkReach): number | null {
  const complete = reach.ended ? reach.tick : reach.tick - 1
  const throughTick = Math.max(complete, ...reach.inputTicks)
  return throughTick > reach.postedThrough ? throughTick : null
}

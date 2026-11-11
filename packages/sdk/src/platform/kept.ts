/**
 * The signed-in player, kept between visits.
 *
 * One entry per page key, because a token is good only beside a page key of
 * its own studio. An entry that will not parse, or has expired, reads as no
 * player and is removed.
 *
 * The page also holds the player in memory, and that copy is the one it
 * reads once it has one. Storage is only what carries the player to the next
 * visit, so a browser that keeps nothing (a private window, a blocked or full
 * store) still plays this visit, and signs in again on the next.
 */

import type { SignedInPlayer } from "../api/index.js"

export interface KeptPlayer {
  readonly token: string
  /** Milliseconds since the epoch. */
  readonly expiresAt: number
  readonly player: SignedInPlayer["player"]
}

export interface PlayerStore {
  read(): KeptPlayer | null
  write(kept: KeptPlayer): void
  clear(): void
}

export function keptPlayerKey(pageKey: string): string {
  return `vbz:player:${pageKey}`
}

/** A store over `localStorage`, or whatever `storage` hands back. */
export function storagePlayerStore(options: {
  readonly key: string
  readonly storage: () => Storage | undefined
  readonly now: () => number
}): PlayerStore {
  let held: KeptPlayer | null = null
  const forget = () => {
    held = null
    try {
      options.storage()?.removeItem(options.key)
    } catch {
      // Nothing kept, nothing to forget.
    }
  }
  const stored = (): KeptPlayer | null => {
    let text: string | null | undefined
    try {
      text = options.storage()?.getItem(options.key)
    } catch {
      return null
    }
    return text === null || text === undefined ? null : parseKept(text)
  }
  return {
    read() {
      const kept = held ?? stored()
      if (kept === null) {
        forget()
        return null
      }
      if (kept.expiresAt <= options.now()) {
        forget()
        return null
      }
      held = kept
      return kept
    },
    write(kept) {
      held = kept
      try {
        options.storage()?.setItem(options.key, JSON.stringify(kept))
      } catch {
        // A full or locked store carries nothing to the next visit.
      }
    },
    clear: forget,
  }
}

function parseKept(text: string): KeptPlayer | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const kept = value as Partial<KeptPlayer> | null
  if (
    typeof kept !== "object" ||
    kept === null ||
    typeof kept.token !== "string" ||
    typeof kept.expiresAt !== "number" ||
    typeof kept.player?.id !== "string" ||
    typeof kept.player.displayName !== "string"
  ) {
    return null
  }
  return {
    token: kept.token,
    expiresAt: kept.expiresAt,
    player: { id: kept.player.id, displayName: kept.player.displayName },
  }
}

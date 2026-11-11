/**
 * The signed-in player, kept between visits.
 *
 * One entry per page key, because a token is good only beside a page key of
 * its own studio. An entry that will not parse, or has expired, reads as no
 * player and is removed; a store that throws reads as no player too, because
 * a page that cannot keep a token still works, it just signs in again.
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
  const forget = () => {
    try {
      options.storage()?.removeItem(options.key)
    } catch {
      // Nothing kept, nothing to forget.
    }
  }
  return {
    read() {
      let text: string | null | undefined
      try {
        text = options.storage()?.getItem(options.key)
      } catch {
        return null
      }
      if (text === null || text === undefined) return null
      const kept = parseKept(text)
      if (kept === null || kept.expiresAt <= options.now()) {
        forget()
        return null
      }
      return kept
    },
    write(kept) {
      try {
        options.storage()?.setItem(options.key, JSON.stringify(kept))
      } catch {
        // A full or locked store keeps nothing, and the page signs in again.
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

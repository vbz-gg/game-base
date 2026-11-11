/**
 * The kept player. A store that cannot keep one, or keeps something it
 * cannot read, is a player who signs in again, never a broken page.
 */

import { describe, expect, test } from "bun:test"
import { keptPlayerKey, storagePlayerStore } from "../../src/platform/kept"
import { FakePage } from "./fake-page"

const KEPT = {
  token: "t-1",
  expiresAt: 2_000_000,
  player: { id: "p-1", displayName: "player-3fa91c0e" },
}

function store(page: FakePage) {
  return storagePlayerStore({
    key: keptPlayerKey("vbz_pk_abc"),
    storage: () => page.storage(),
    now: () => page.now(),
  })
}

describe("the kept player", () => {
  test("is kept per page key, and read back", () => {
    const page = new FakePage()
    store(page).write(KEPT)
    expect([...page.kept.keys()]).toEqual(["vbz:player:vbz_pk_abc"])
    expect(store(page).read()).toEqual(KEPT)
  })

  test("an expired one reads as nobody and is removed", () => {
    const page = new FakePage()
    store(page).write({ ...KEPT, expiresAt: page.now() })
    expect(store(page).read()).toBeNull()
    expect(page.kept.size).toBe(0)
  })

  test("one that will not parse, or has the wrong shape, reads as nobody", () => {
    for (const text of ["{", JSON.stringify({ token: 1 }), "null"]) {
      const page = new FakePage()
      page.kept.set(keptPlayerKey("vbz_pk_abc"), text)
      expect(store(page).read()).toBeNull()
      expect(page.kept.size).toBe(0)
    }
  })

  test("a store that throws keeps nothing and reads as nobody", () => {
    const page = new FakePage()
    page.storageThrows = true
    const kept = store(page)
    kept.write(KEPT)
    kept.clear()
    expect(kept.read()).toBeNull()
  })

  test("no storage at all reads as nobody", () => {
    const kept = storagePlayerStore({
      key: "k",
      storage: () => undefined,
      now: () => 0,
    })
    kept.write(KEPT)
    expect(kept.read()).toBeNull()
  })
})

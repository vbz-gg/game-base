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

  /**
   * A private window, or a page whose storage is blocked. Reading only from
   * storage, a player who signed in could never start a run: the token was
   * gone the moment it was written.
   */
  test("a store that throws still holds the player for this visit", () => {
    const page = new FakePage()
    page.storageThrows = true
    const kept = store(page)
    expect(kept.read()).toBeNull()
    kept.write(KEPT)
    expect(kept.read()).toEqual(KEPT)
    // The next visit is a new store, and nothing carried over.
    expect(store(page).read()).toBeNull()
    kept.clear()
    expect(kept.read()).toBeNull()
  })

  test("with no storage at all, the player is held for this visit only", () => {
    const options = { key: "k", storage: () => undefined, now: () => 0 }
    const kept = storagePlayerStore(options)
    kept.write(KEPT)
    expect(kept.read()).toEqual(KEPT)
    expect(storagePlayerStore(options).read()).toBeNull()
  })

  test("a renewal a full store refuses is still the token used", () => {
    const page = new FakePage()
    const kept = store(page)
    kept.write(KEPT)
    page.storageThrows = true
    kept.write({ ...KEPT, token: "t-2" })
    expect(kept.read()?.token).toBe("t-2")
  })

  test("a held player expires as a stored one does", () => {
    const page = new FakePage()
    const kept = store(page)
    kept.write({ ...KEPT, expiresAt: page.now() + 10 })
    page.advance(10)
    expect(kept.read()).toBeNull()
    expect(page.kept.size).toBe(0)
  })
})

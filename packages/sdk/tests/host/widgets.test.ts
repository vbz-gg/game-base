/**
 * The two widgets, against a document: the sign-in button opens the window
 * in the click and says why when it did not work, and the board table shows
 * the board the platform answered, the reader's own row included.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import type { Board, BoardRow } from "../../src/api/index"
import { mountBoard, mountSignIn } from "../../src/host/widgets"
import type { BoardOptions } from "../../src/platform/client"
import { PlatformClientError, PlatformRefusal } from "../../src/platform/errors"

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let place: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  place = document.createElement("div")
  document.body.append(place)
})

type Player = { readonly id: string; readonly displayName: string }

/** A client whose sign-in answers when the test says. */
function signInClient(start: Player | null = null) {
  let player = start
  let answer: { resolve: (p: Player) => void; reject: (e: unknown) => void } = {
    resolve: () => {},
    reject: () => {},
  }
  const calls: string[] = []
  return {
    calls,
    finish: (next: Player) => {
      player = next
      answer.resolve(next)
    },
    fail: (error: unknown) => answer.reject(error),
    client: {
      player: () => player,
      signIn: () => {
        calls.push("signIn")
        return new Promise<Player>((resolve, reject) => {
          answer = { resolve, reject }
        })
      },
      signOut: () => {
        calls.push("signOut")
        player = null
      },
    },
  }
}

const button = () => place.querySelector("button") as HTMLButtonElement
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("the sign-in button", () => {
  test("opens the window in the click, and shows the player once signed in", async () => {
    const fake = signInClient()
    const changes: Array<Player | null> = []
    mountSignIn(place, {
      client: fake.client,
      onChange: (player) => changes.push(player),
    })
    expect(button().textContent).toBe("Sign in")

    button().click()
    // In the click's own turn, before anything was awaited.
    expect(fake.calls).toEqual(["signIn"])
    expect(button().disabled).toBe(true)

    fake.finish({ id: "p-1", displayName: "Ada" })
    await settle()
    expect(button().textContent).toBe("Sign out")
    expect(button().disabled).toBe(false)
    expect(place.querySelector(".gb-signin-name")?.textContent).toBe("Ada")
    expect(changes).toEqual([{ id: "p-1", displayName: "Ada" }])
  })

  test("says why when the window did not work, in the client's own words", async () => {
    const fake = signInClient()
    mountSignIn(place, { client: fake.client })
    button().click()
    fake.fail(new PlatformClientError("E_POPUP_BLOCKED"))
    await settle()
    expect(place.querySelector('[role="status"]')?.textContent).toContain(
      "the browser blocked the sign-in window",
    )
    expect(button().textContent).toBe("Sign in")
    expect(button().disabled).toBe(false)

    // And the next try starts with the old reason gone.
    button().click()
    expect(place.querySelector('[role="status"]')?.textContent).toBe("")
    fake.fail("a string, not an error")
    await settle()
    expect(place.querySelector('[role="status"]')?.textContent).toBe(
      "a string, not an error",
    )
  })

  test("signs a signed-in player out, and redraws when told", () => {
    const fake = signInClient({ id: "p-1", displayName: "Ada" })
    const changes: Array<Player | null> = []
    const widget = mountSignIn(place, {
      client: fake.client,
      onChange: (player) => changes.push(player),
    })
    button().click()
    expect(fake.calls).toEqual(["signOut"])
    expect(changes).toEqual([null])
    expect(button().textContent).toBe("Sign in")

    fake.finish({ id: "p-2", displayName: "Grace" })
    widget.update()
    expect(place.querySelector(".gb-signin-name")?.textContent).toBe("Grace")
    widget.destroy()
    expect(place.children).toHaveLength(0)
  })
})

const row = (rank: number, name: string, score: number): BoardRow => ({
  rank,
  playerId: `p-${name}`,
  displayName: name,
  counters: { score, ticks: 100 * rank },
  day: "2026-11-12",
  sessionId: `s-${name}`,
})

const BOARD: Board = {
  gameId: "g-1",
  period: "day",
  from: "2026-11-12",
  to: "2026-11-13",
  total: 3,
  rows: [row(1, "Ada", 30), row(2, "Grace", 20)],
  you: row(2, "Grace", 20),
  rankBy: ["score", "ticks"],
  tiePolicy: "first",
}

function boardClient(answer: Board | Error) {
  const asked: BoardOptions[] = []
  return {
    asked,
    client: {
      board: async (options?: BoardOptions) => {
        asked.push(options ?? {})
        if (answer instanceof Error) throw answer
        return answer
      },
    },
  }
}

const cells = () =>
  [...place.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((td) => td.textContent),
  )

describe("the board table", () => {
  test("shows rank, name and each counter the game ranks by, in its order", async () => {
    const fake = boardClient(BOARD)
    const board = mountBoard(place, {
      client: fake.client,
      period: "week",
      limit: 10,
      offset: 20,
      format: (counter, value) =>
        counter === "score" ? `${value} pts` : `${value}`,
    })
    expect(await board.refresh()).toEqual(BOARD)
    expect(fake.asked).toEqual([{ period: "week", limit: 10, offset: 20 }])
    expect(cells()).toEqual([
      ["#", "Player", "score", "ticks"],
      ["1", "Ada", "30 pts", "100"],
      ["2", "Grace", "20 pts", "200"],
    ])
    const mine = place.querySelector('[aria-current="true"]')
    expect(mine?.getAttribute("data-player")).toBe("p-Grace")
  })

  test("shows the reader's own row after the page when it is not on it", async () => {
    const fake = boardClient({ ...BOARD, you: row(40, "Linus", 2) })
    await mountBoard(place, { client: fake.client }).refresh()
    expect(fake.asked).toEqual([{}])
    expect(cells().at(-1)).toEqual(["40", "Linus", "2", "4000"])
    expect(
      place.querySelector('[aria-current="true"]')?.getAttribute("data-player"),
    ).toBe("p-Linus")
  })

  test("leaves a counter a row does not carry empty", async () => {
    const odd = { ...row(1, "Ada", 1), counters: { score: 1 } }
    const fake = boardClient({ ...BOARD, rows: [odd], you: null })
    await mountBoard(place, { client: fake.client }).refresh()
    expect(cells()[1]).toEqual(["1", "Ada", "1", ""])
  })

  test("says so when nobody has a score", async () => {
    const fake = boardClient({ ...BOARD, rows: [], you: null, total: 0 })
    await mountBoard(place, { client: fake.client }).refresh()
    expect(place.querySelector(".gb-board-empty")?.textContent).toBe(
      "Nobody has a score here yet.",
    )
  })

  test("draws only the newest read, and nothing once it is gone", async () => {
    // A read sent when the page loaded that answers after the read sent when
    // a run settled must not put back the board without that run.
    const answers: Array<(board: Board) => void> = []
    const fails: Array<(error: unknown) => void> = []
    const client = {
      board: () =>
        new Promise<Board>((resolve, reject) => {
          answers.push(resolve)
          fails.push(reject)
        }),
    }
    const board = mountBoard(place, { client })
    const older = board.refresh()
    const newer = board.refresh()
    answers[1]?.({ ...BOARD, rows: [row(1, "Newer", 9)], you: null })
    await newer
    answers[0]?.({ ...BOARD, rows: [row(1, "Older", 1)], you: null })
    await older
    expect(cells().at(-1)?.[1]).toBe("Newer")

    // An older read that fails says nothing over the newer table either.
    const stale = board.refresh()
    const fresh = board.refresh()
    answers[3]?.({ ...BOARD, rows: [row(1, "Fresh", 5)], you: null })
    await fresh
    fails[2]?.(new Error("late"))
    await expect(stale).rejects.toThrow("late")
    expect(cells().at(-1)?.[1]).toBe("Fresh")

    const last = board.refresh()
    board.destroy()
    answers[4]?.(BOARD)
    await last
    expect(place.children).toHaveLength(0)
  })

  test("shows the platform's own reason when the board cannot be read", async () => {
    const refusal = new PlatformRefusal(404, {
      error: "E_NO_GAME",
      message: "there is no game for this page key",
    })
    const fake = boardClient(refusal)
    const board = mountBoard(place, { client: fake.client })
    await expect(board.refresh()).rejects.toBe(refusal)
    expect(place.querySelector('[role="status"]')?.textContent).toBe(
      "there is no game for this page key",
    )
    board.destroy()
    expect(place.children).toHaveLength(0)
  })
})

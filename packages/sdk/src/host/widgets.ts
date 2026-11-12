/**
 * Two plain widgets a game's page needs and need not build: a sign-in
 * button, and a board table.
 *
 * Plain DOM, as the controls are, and styled the same way: layout set here,
 * every colour from a CSS custom property with a fallback, so a page restyles
 * them by setting `--gb-widget-*` on any ancestor and needs no stylesheet from
 * this package. Anything a widget shows about a failure is the client's or
 * the platform's own sentence for its code.
 */

import type { Board, BoardRow } from "../api/index.js"
import type { BoardOptions, PlatformClient } from "../platform/client.js"
import { PlatformClientError, PlatformRefusal } from "../platform/errors.js"

export interface MountedWidget {
  /** Takes the widget out of the page. */
  destroy(): void
}

function messageOf(error: unknown): string {
  return error instanceof PlatformRefusal ||
    error instanceof PlatformClientError
    ? error.message
    : String(error)
}

function styleButton(button: HTMLButtonElement): void {
  button.style.font = "inherit"
  button.style.cursor = "pointer"
  button.style.padding = "var(--gb-widget-padding, 6px 12px)"
  button.style.borderRadius = "var(--gb-widget-radius, 8px)"
  button.style.border = "var(--gb-widget-border, 1px solid #3a3d46)"
  button.style.background = "var(--gb-widget-bg, #191b20)"
  button.style.color = "var(--gb-widget-fg, #ecedf0)"
}

export interface SignInOptions {
  readonly client: Pick<PlatformClient, "player" | "signIn" | "signOut">
  /** Told when a player signs in or out through the widget. */
  readonly onChange?: (player: ReturnType<PlatformClient["player"]>) => void
}

export interface MountedSignIn extends MountedWidget {
  /** Redraws from the client: after a sign-out the page made itself. */
  update(): void
}

/**
 * A button that signs a player in or out, and the signed-in player's name.
 *
 * The sign-in window opens in the click itself, before anything is awaited,
 * because a browser opens one only in the turn of the click that asked. A
 * failure, the window blocked or closed early, is shown beside the button.
 */
export function mountSignIn(
  element: HTMLElement,
  options: SignInOptions,
): MountedSignIn {
  const document = element.ownerDocument
  const root = document.createElement("div")
  root.className = "gb-signin"
  root.style.display = "inline-flex"
  root.style.alignItems = "center"
  root.style.gap = "var(--gb-widget-gap, 8px)"
  const name = document.createElement("span")
  name.className = "gb-signin-name"
  const button = document.createElement("button")
  button.type = "button"
  styleButton(button)
  const status = document.createElement("span")
  status.className = "gb-signin-status"
  status.setAttribute("role", "status")
  status.style.color = "var(--gb-widget-error, #f28b82)"
  root.append(name, button, status)
  element.append(root)

  let busy = false

  function update(): void {
    const player = options.client.player()
    name.textContent = player?.displayName ?? ""
    name.hidden = player === null
    button.textContent = player === null ? "Sign in" : "Sign out"
    button.disabled = busy
  }

  button.addEventListener("click", () => {
    status.textContent = ""
    if (options.client.player() !== null) {
      options.client.signOut()
      update()
      options.onChange?.(null)
      return
    }
    // Called in the click's own turn: `signIn` opens the window before it
    // awaits anything.
    const signingIn = options.client.signIn()
    busy = true
    update()
    signingIn.then(
      (player) => {
        busy = false
        update()
        options.onChange?.(player)
      },
      (error: unknown) => {
        busy = false
        status.textContent = messageOf(error)
        update()
      },
    )
  })

  update()
  return {
    update,
    destroy: () => root.remove(),
  }
}

export interface BoardWidgetOptions extends BoardOptions {
  readonly client: Pick<PlatformClient, "board">
  /** How a counter is shown. Its number, as is, by default. */
  readonly format?: (counter: string, value: number) => string
}

export interface MountedBoard extends MountedWidget {
  /** Reads the board again and redraws it, with its answer. */
  refresh(): Promise<Board>
}

/**
 * The board as a table: rank, name, and each counter the game ranks by, in
 * the manifest's order, labelled with the counter's own name.
 *
 * The reader's own row is marked `aria-current`, and shown after the page of
 * rows when it is not among them, so a player always finds themselves. A
 * failure to read the board replaces the table with the reason.
 */
export function mountBoard(
  element: HTMLElement,
  options: BoardWidgetOptions,
): MountedBoard {
  const document = element.ownerDocument
  const root = document.createElement("div")
  root.className = "gb-board"
  root.style.color = "var(--gb-widget-fg, #ecedf0)"
  element.append(root)
  const { client, format: given, ...query } = options
  const format = given ?? ((_counter, value) => String(value))
  // Only the newest read draws, and nothing draws once the widget is gone:
  // an older answer that arrives late would put back a board without the
  // run that just settled.
  let latest = 0
  let destroyed = false

  function cell(tag: "th" | "td", text: string): HTMLElement {
    const node = document.createElement(tag)
    node.textContent = text
    node.style.padding = "var(--gb-widget-cell-padding, 4px 10px)"
    node.style.textAlign = tag === "th" ? "start" : "end"
    return node
  }

  function row(board: Board, entry: BoardRow): HTMLTableRowElement {
    const tr = document.createElement("tr")
    tr.dataset.player = entry.playerId
    const name = cell("td", entry.displayName)
    name.style.textAlign = "start"
    tr.append(cell("td", String(entry.rank)), name)
    for (const counter of board.rankBy) {
      const value = entry.counters[counter]
      tr.append(cell("td", value === undefined ? "" : format(counter, value)))
    }
    if (board.you !== null && board.you.sessionId === entry.sessionId) {
      tr.setAttribute("aria-current", "true")
      tr.style.background = "var(--gb-widget-you-bg, rgba(59, 214, 138, 0.16))"
    }
    return tr
  }

  function draw(board: Board): void {
    const you = board.you
    if (board.rows.length === 0 && you === null) {
      const empty = document.createElement("p")
      empty.className = "gb-board-empty"
      empty.textContent = "Nobody has a score here yet."
      root.replaceChildren(empty)
      return
    }
    const table = document.createElement("table")
    table.style.borderCollapse = "collapse"
    const head = document.createElement("tr")
    head.append(cell("th", "#"), cell("th", "Player"))
    for (const counter of board.rankBy) head.append(cell("th", counter))
    const body = document.createElement("tbody")
    for (const entry of board.rows) body.append(row(board, entry))
    if (
      you !== null &&
      !board.rows.some((r) => r.sessionId === you.sessionId)
    ) {
      body.append(row(board, you))
    }
    const thead = document.createElement("thead")
    thead.append(head)
    table.append(thead, body)
    root.replaceChildren(table)
  }

  const current = (read: number) => !destroyed && read === latest

  async function refresh(): Promise<Board> {
    latest += 1
    const read = latest
    try {
      const board = await client.board(query)
      if (current(read)) draw(board)
      return board
    } catch (error) {
      if (!current(read)) throw error
      const status = document.createElement("p")
      status.className = "gb-board-status"
      status.setAttribute("role", "status")
      status.style.color = "var(--gb-widget-error, #f28b82)"
      status.textContent = messageOf(error)
      root.replaceChildren(status)
      throw error
    }
  }

  return {
    refresh,
    destroy() {
      destroyed = true
      root.remove()
    },
  }
}

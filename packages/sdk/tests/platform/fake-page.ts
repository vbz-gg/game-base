/**
 * A page the client can run in without a browser: timers that move only
 * when a test says so, a popup a test closes, messages a test posts, a
 * `fetch` that answers from a script, and storage in a Map.
 */

import type {
  MessageLike,
  PageEnvironment,
  PopupWindow,
} from "../../src/platform/environment"

export interface Sent {
  readonly url: URL
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly credentials: RequestCredentials | undefined
}

export type Answer =
  | { readonly status: number; readonly body: unknown }
  | { readonly status: number; readonly text: string }
  | { readonly unreachable: true }

export class FakePopup implements PopupWindow {
  closed = false
  location = { href: "" }
  close(): void {
    this.closed = true
  }
}

export class FakePage implements PageEnvironment {
  readonly origin = "https://lantern.example"
  readonly crypto = globalThis.crypto
  readonly sent: Sent[] = []
  readonly opened: Array<{ url: string; target: string; features: string }> = []
  popup: FakePopup | null = new FakePopup()
  private listeners = new Set<(event: MessageLike) => void>()
  private timers = new Map<
    number,
    { at: number; every: number | null; run: () => void }
  >()
  private nextTimer = 1
  private clock = 1_000_000
  readonly kept = new Map<string, string>()
  storageThrows = false
  /** Answers, in order, keyed by "METHOD /path". A function sees the request. */
  answers: Array<Answer | ((sent: Sent) => Answer)> = []

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const sent: Sent = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body:
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      credentials: init?.credentials,
    }
    this.sent.push(sent)
    const next = this.answers.shift()
    if (next === undefined)
      throw new Error(
        `no answer scripted for ${sent.method} ${sent.url.pathname}`,
      )
    const answer = typeof next === "function" ? next(sent) : next
    if ("unreachable" in answer) throw new TypeError("Failed to fetch")
    const text = "text" in answer ? answer.text : JSON.stringify(answer.body)
    return new Response(text, { status: answer.status })
  }) as typeof fetch

  open(url: string, target: string, features: string): PopupWindow | null {
    this.opened.push({ url, target, features })
    return this.popup
  }

  addMessageListener(listener: (event: MessageLike) => void): void {
    this.listeners.add(listener)
  }

  removeMessageListener(listener: (event: MessageLike) => void): void {
    this.listeners.delete(listener)
  }

  /** A message to the page, as the browser would deliver it. */
  post(event: MessageLike): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  get listening(): number {
    return this.listeners.size
  }

  setTimeout(run: () => void, ms: number): unknown {
    const id = this.nextTimer++
    this.timers.set(id, { at: this.clock + ms, every: null, run })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  setInterval(run: () => void, ms: number): unknown {
    const id = this.nextTimer++
    this.timers.set(id, { at: this.clock + ms, every: ms, run })
    return id
  }

  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  get pendingTimers(): number {
    return this.timers.size
  }

  /** Moves the clock, running every timer that comes due on the way. */
  advance(ms: number): void {
    const until = this.clock + ms
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort(([, a], [, b]) => a.at - b.at)[0]
      if (due === undefined) break
      const [id, timer] = due
      this.clock = timer.at
      if (timer.every === null) this.timers.delete(id)
      else timer.at += timer.every
      timer.run()
    }
    this.clock = until
  }

  storage(): Storage | undefined {
    if (this.storageThrows) throw new Error("SecurityError")
    const kept = this.kept
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
      clear: () => kept.clear(),
      key: () => null,
      length: kept.size,
    }
  }

  now(): number {
    return this.clock
  }
}

/**
 * Lets queued work run: promise callbacks, and the real event-loop turns the
 * runtime's own `crypto.subtle` finishes on. The page's timers stay put.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

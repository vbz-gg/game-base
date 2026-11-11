/**
 * What the client needs of the browser, as one seam.
 *
 * Read from `globalThis` when a client is made, never when this module loads:
 * a page's bundle may import the SDK during server-side rendering, where
 * there is no window. A test hands in its own.
 */

/** The sign-in window, as far as the page can see it once it navigates away. */
export interface PopupWindow {
  readonly closed: boolean
  readonly location: { href: string }
  close(): void
}

/** The fields of a `MessageEvent` the sign-in flow reads. */
export interface MessageLike {
  readonly origin: string
  readonly source: unknown
  readonly data: unknown
}

export interface PageEnvironment {
  /** The page's own origin: the `redirect_uri` the sign-in window checks. */
  readonly origin: string
  readonly fetch: typeof fetch
  readonly crypto: Pick<Crypto, "getRandomValues" | "subtle">
  open(url: string, target: string, features: string): PopupWindow | null
  addMessageListener(listener: (event: MessageLike) => void): void
  removeMessageListener(listener: (event: MessageLike) => void): void
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(run: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  /** Where the player's token is kept, or undefined where there is none. */
  storage(): Storage | undefined
  now(): number
}

/** The page's own browser. Throws where there is no window. */
export function browserEnvironment(): PageEnvironment {
  const page = globalThis.window
  if (page === undefined) {
    throw new Error(
      "the platform client runs in a browser page; there is no window here",
    )
  }
  return {
    origin: page.location.origin,
    // Bound, because a browser refuses a `fetch` called on another object.
    fetch: page.fetch.bind(page),
    crypto: page.crypto,
    open: (url, target, features) => page.open(url, target, features),
    addMessageListener: (listener) =>
      page.addEventListener("message", listener),
    removeMessageListener: (listener) =>
      page.removeEventListener("message", listener),
    setTimeout: (run, ms) => page.setTimeout(run, ms),
    clearTimeout: (handle) =>
      page.clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (run, ms) => page.setInterval(run, ms),
    clearInterval: (handle) =>
      page.clearInterval(handle as ReturnType<typeof setInterval>),
    storage: () => {
      // Reading `localStorage` throws in a sandboxed or privacy-locked page,
      // and a player who cannot keep a token is a player who signs in again.
      try {
        return page.localStorage
      } catch {
        return undefined
      }
    },
    now: () => Date.now(),
  }
}

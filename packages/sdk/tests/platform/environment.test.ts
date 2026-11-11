/**
 * The client's view of a real page, under happy-dom: the page's own origin,
 * its storage, its messages and timers, and a `fetch` that still runs as the
 * window's once it is taken off it.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { browserEnvironment } from "../../src/platform/environment"

describe("with no window", () => {
  test("making a client's environment says it needs a browser page", () => {
    expect(() => browserEnvironment()).toThrow("runs in a browser page")
  })
})

describe("in a page", () => {
  beforeAll(() => {
    GlobalRegistrator.register({ url: "https://lantern.example/play" })
  })
  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  test("reads the page's origin and storage", () => {
    const page = browserEnvironment()
    expect(page.origin).toBe("https://lantern.example")
    expect(page.storage()).toBe(window.localStorage)
    expect(page.now()).toBeGreaterThan(0)
    expect(typeof page.crypto.getRandomValues).toBe("function")
  })

  test("a storage the browser refuses reads as none", () => {
    const page = browserEnvironment()
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError")
      },
    })
    try {
      expect(page.storage()).toBeUndefined()
    } finally {
      if (original !== undefined)
        Object.defineProperty(window, "localStorage", original)
    }
  })

  test("hears the page's messages until it stops listening", () => {
    const page = browserEnvironment()
    const heard: unknown[] = []
    const listener = (event: { data: unknown }) => heard.push(event.data)
    page.addMessageListener(listener)
    window.dispatchEvent(new MessageEvent("message", { data: "one" }))
    page.removeMessageListener(listener)
    window.dispatchEvent(new MessageEvent("message", { data: "two" }))
    expect(heard).toEqual(["one"])
  })

  test("runs and cancels the page's timers", async () => {
    const page = browserEnvironment()
    const ran: string[] = []
    page.setTimeout(() => ran.push("timeout"), 0)
    page.clearTimeout(page.setTimeout(() => ran.push("cancelled"), 0))
    const every = page.setInterval(() => {
      ran.push("interval")
      page.clearInterval(every)
    }, 0)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(ran.sort()).toEqual(["interval", "timeout"])
  })

  test("a fetch taken off the window still runs as the window's", async () => {
    // A browser refuses a fetch called on anything but the window.
    const original = window.fetch
    let owner: unknown
    window.fetch = function (this: unknown) {
      owner = this
      return Promise.resolve(new Response("{}"))
    } as unknown as typeof window.fetch
    try {
      const { fetch } = browserEnvironment()
      await fetch("https://api.vbz.example/v1/game")
    } finally {
      window.fetch = original
    }
    expect(owner).toBe(window)
  })

  test("opens a window through the page's own open", () => {
    const page = browserEnvironment()
    const opened: unknown[] = []
    const original = window.open
    window.open = ((...args: unknown[]) => {
      opened.push(args)
      return null
    }) as typeof window.open
    try {
      expect(page.open("about:blank", "vbz-signin", "popup")).toBeNull()
    } finally {
      window.open = original
    }
    expect(opened).toEqual([["about:blank", "vbz-signin", "popup"]])
  })
})

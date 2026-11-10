import { describe, expect, test } from "bun:test"
import { createBlobServer } from "../../src/serve/blobs"

const HASH = "a".repeat(64)
const BODY = new TextEncoder().encode("export const x = 1")

const serve = createBlobServer(async (key) =>
  key === `sim/${HASH}.js` ? BODY : undefined,
)

function get(path: string, method = "GET"): Promise<Response> {
  return serve(new Request(`http://bundle.invalid${path}`, { method }))
}

describe("serving a blob", () => {
  test("a stored artifact comes back with its bytes", async () => {
    const response = await get(`/sim/${HASH}.js`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("export const x = 1")
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    )
  })

  /**
   * The frame runs under `sandbox="allow-scripts"` with no
   * `allow-same-origin`, so its origin is the string `null` and there is no
   * origin to put in a list. Without this header the frame loads nothing,
   * posts no `ready`, and shows a blank game with no error in the parent.
   */
  test("every response allows the opaque origin to read it", async () => {
    for (const path of [`/sim/${HASH}.js`, "/sim/nope.js", "/anything"]) {
      const response = await get(path)
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
    }
  })

  /**
   * A 404 without CORS is reported to the page as a network failure, which
   * sends whoever hit it looking at the wrong layer entirely.
   */
  test("a miss is a 404 that still carries the header", async () => {
    const response = await get(`/sim/${"b".repeat(64)}.js`)
    expect(response.status).toBe(404)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })

  test("content is never sniffed", async () => {
    const response = await get(`/sim/${HASH}.js`)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  /** A blob is named by the digest of its own body, so it never changes. */
  test("a hit is cached forever", async () => {
    const response = await get(`/sim/${HASH}.js`)
    expect(response.headers.get("cache-control")).toContain("immutable")
  })

  test("HEAD answers with the headers and no body", async () => {
    const response = await get(`/sim/${HASH}.js`, "HEAD")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-length")).toBe(String(BODY.byteLength))
    expect(await response.text()).toBe("")
  })

  test("a preflight is answered without touching the store", async () => {
    const response = await get(`/sim/${HASH}.js`, "OPTIONS")
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "GET",
    )
  })

  test("anything but a read is refused", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await get(`/sim/${HASH}.js`, method)).status).toBe(405)
    }
  })

  /**
   * A path that is not one of the two shapes never reaches the store, so a
   * traversal attempt is refused before anything touches a filesystem.
   */
  test("a path outside the two shapes never reaches the store", async () => {
    let asked: string | null = null
    const guarded = createBlobServer(async (key) => {
      asked = key
      return undefined
    })
    for (const path of [
      "/sim/../../etc/passwd",
      "/sim/short.js",
      `/other/${HASH}.js`,
      `/sim/${HASH.toUpperCase()}.js`,
      "/",
    ]) {
      const response = await guarded(
        new Request(`http://bundle.invalid${path}`),
      )
      expect(response.status).toBe(404)
    }
    expect(asked).toBeNull()
  })

  test("the frame shape is served as well as the sim shape", async () => {
    const both = createBlobServer(async () => BODY)
    expect(
      (await both(new Request(`http://x.invalid/frame/${HASH}.js`))).status,
    ).toBe(200)
  })
})

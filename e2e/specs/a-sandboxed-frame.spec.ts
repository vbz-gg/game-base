/**
 * The frame a stranger's game runs in.
 *
 * Everything here is a property of the browser rather than of our code: what
 * a sandbox attribute does to an origin, what a response header does that the
 * attribute cannot, and whether an opaque origin can load its own modules. A
 * unit test can assert the strings we emit; only a browser can say what they
 * buy.
 */

import { expect, test } from "@playwright/test"
import { frameOrigin, hostOrigin } from "../src/env"
import { clearRequests, open, requests, subjects } from "../src/run"

test("the game is framed cross-origin and the page cannot reach inside", async ({
  page,
}) => {
  await open(page, "template")
  const frame = page.locator("#stage iframe")

  // Deliberately without `allow-same-origin`: the pair lets a framed document
  // of the same origin remove its own sandbox. What is left is an opaque
  // origin, which is same-origin with nothing.
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts")
  await expect(frame).toHaveAttribute(
    "src",
    new RegExp(frameOrigin("template")),
  )

  const reachable = await frame.evaluate(
    (node) => (node as HTMLIFrameElement).contentDocument !== null,
  )
  expect(reachable).toBe(false)
})

/**
 * The attribute lives in the parent document, so it is gone the moment
 * somebody opens the game's URL straight out of devtools. The header is a
 * property of the document however it was loaded, which is why the CSP leads
 * with `sandbox`.
 */
test("the sandbox is on the document, not only on the element", async ({
  request,
}) => {
  const response = await request.get(`${frameOrigin("template")}/play`)
  const csp = response.headers()["content-security-policy"] ?? ""
  expect(csp.startsWith("sandbox allow-scripts allow-pointer-lock;")).toBe(true)
  expect(csp).toContain(`frame-ancestors ${hostOrigin("template")}`)
  expect(csp).toContain("connect-src 'none'")
})

/**
 * A sandboxed frame's origin is the string `null`, so a server answering with
 * its own origin never matches and the frame loads nothing - no error in the
 * parent, no `ready`, a blank game. `open()` waiting for `ready` is the other
 * half of this assertion: it is what proves the header is doing the work.
 */
test("the artifacts are served to an origin that is nobody", async ({
  request,
}) => {
  const info = (await subjects()).template
  const response = await request.get(`${frameOrigin("template")}${info.sim}`)
  expect(response.status()).toBe(200)
  expect(response.headers()["access-control-allow-origin"]).toBe("*")
  expect(response.headers()["content-type"]).toContain("text/javascript")
  expect(response.headers()["cache-control"]).toContain("immutable")
})

/**
 * What the network says the frame did.
 *
 * Three requests and no others: the document, the frame bundle, and the
 * simulation at the address the rewrite gave it. A frame that inlined its
 * simulation never asks for the sim path; a rewrite pointing at the wrong
 * hash asks for a path that 404s; a game reaching a fourth address shows up
 * as a fourth entry.
 */
test("the browser fetched the simulation at its own content address", async ({
  page,
}) => {
  await clearRequests("template")
  await open(page, "template")

  const info = (await subjects()).template
  const paths = await requests("template")
  expect(paths).toContain("/play")
  expect(paths).toContain(info.frame)
  expect(paths).toContain(info.sim)
  expect(paths.filter((path) => path.startsWith("/sim/"))).toEqual([info.sim])

  const unexpected = paths.filter(
    (path) => path !== "/play" && path !== info.frame && path !== info.sim,
  )
  expect(unexpected).toEqual([])
})

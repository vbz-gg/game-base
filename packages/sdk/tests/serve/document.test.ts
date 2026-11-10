import { describe, expect, test } from "bun:test"
import { escapeHtml, frameCsp, frameDocument } from "../../src/serve/document"

describe("the frame document", () => {
  /**
   * The title comes from a manifest, which on a platform means it comes from
   * a stranger. A `</title><script>` in it would be markup in a page that has
   * no other script hole.
   */
  test("the title is escaped", () => {
    const html = frameDocument({
      title: `</title><script>alert(1)</script>`,
      frameSrc: "/frame/abc.js",
    })
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;")
  })

  test("the source is escaped too", () => {
    const html = frameDocument({
      title: "Game",
      frameSrc: `/frame/a.js" onload="alert(1)`,
    })
    expect(html).not.toContain('onload="alert(1)"')
  })

  test("escapeHtml covers every character that can leave an attribute", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
  })

  /**
   * One module tag and no inline script, which is what lets the policy below
   * stay at `script-src 'self'` with no `'unsafe-inline'`.
   */
  test("the only script is the module tag", () => {
    const html = frameDocument({ title: "Game", frameSrc: "/frame/a.js" })
    const scripts = html.match(/<script/g) ?? []
    expect(scripts).toHaveLength(1)
    expect(html).toContain('<script type="module" src="/frame/a.js">')
  })
})

describe("the frame's policy", () => {
  /**
   * The leading `sandbox` directive is the reason this header exists. The
   * iframe attribute lives in the parent document and is gone the moment
   * somebody opens the frame URL directly, out of devtools or from a crawler.
   * As a response header it is a property of the document however it loaded.
   */
  test("sandbox comes first and grants only what a game needs", () => {
    const csp = frameCsp(["https://vbz.gg"])
    expect(csp.startsWith("sandbox allow-scripts allow-pointer-lock;")).toBe(
      true,
    )
    expect(csp).not.toContain("allow-same-origin")
    expect(csp).not.toContain("allow-forms")
    expect(csp).not.toContain("allow-popups")
    expect(csp).not.toContain("allow-top-navigation")
  })

  test("the game may reach no network of its own", () => {
    const csp = frameCsp(["https://vbz.gg"])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    // WebRTC has its own directive, which only Chromium honours. It narrows
    // the blast radius rather than closing it, so it is here and the frame
    // still holds nothing worth sending.
    expect(csp).toContain("webrtc 'block'")
  })

  test("only the named origins may frame it", () => {
    const csp = frameCsp(["https://vbz.gg", "http://127.0.0.1:4310"])
    expect(csp).toContain(
      "frame-ancestors https://vbz.gg http://127.0.0.1:4310",
    )
  })

  /**
   * `script-src 'self'` is what the document above earns by having no inline
   * script. Widening it would be the cheapest way to lose that.
   */
  test("scripts come from the bundle origin and nowhere else", () => {
    expect(frameCsp(["https://vbz.gg"])).toContain("script-src 'self'")
  })
})

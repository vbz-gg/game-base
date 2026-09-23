/**
 * The game document, and the headers that make it safe to serve.
 *
 * This is the page a stranger's game runs inside. The arcade serves it in
 * production and the harness serves it locally, from this same code, so a
 * game that works in one works in the other and an author meets the sandbox
 * before an upload rather than after.
 */

export interface FrameDocumentInput {
  readonly title: string
  /** Root-relative, so the document is portable across bundle origins. */
  readonly frameSrc: string
}

/** The game's title comes from its manifest, so it is escaped. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * One module tag and a container, and that is the whole page.
 *
 * No inline script, so the CSP below needs no `'unsafe-inline'` for scripts.
 * The style block is layout; a style is not a script hole.
 */
export function frameDocument(input: FrameDocumentInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; height: 100%; background: #0b0b14; }
      #stage { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="${escapeHtml(input.frameSrc)}"></script>
  </body>
</html>
`
}

/**
 * The frame's Content-Security-Policy.
 *
 * The leading `sandbox` directive is the one that matters and the one an
 * iframe attribute cannot give. `sandbox` on the iframe element lives in the
 * parent document, so it is gone the moment somebody opens this URL directly -
 * out of devtools, from a crawler, or the day somebody adds "open in a new
 * tab". As a response header it is a property of the document however it was
 * loaded.
 *
 * `connect-src 'none'` stops fetch, XHR, WebSocket, EventSource and Beacon. It
 * does not govern WebRTC, which has its own directive that only Chromium
 * honours, so this narrows the blast radius rather than closing it. What
 * actually makes the frame safe to hand a stranger's code is that it holds
 * nothing worth sending: a seed, a config, and the player's own keystrokes.
 */
export function frameCsp(siteOrigins: readonly string[]): string {
  return [
    "sandbox allow-scripts allow-pointer-lock",
    "default-src 'none'",
    "script-src 'self'",
    "worker-src blob:",
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "webrtc 'block'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    `frame-ancestors ${siteOrigins.join(" ")}`,
  ].join("; ")
}

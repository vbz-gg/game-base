/**
 * Serving a game's two artifacts over HTTP.
 *
 * A handler rather than a server, so it is testable without a port and so the
 * frame document can be mounted on the same origin - which it must be, because
 * the frame's rewritten import is root-relative and resolves against the frame
 * document's own URL.
 */

/** The two shapes a blob path may take. Anything else never reaches a store. */
export const BLOB_PATH = /^\/(sim|frame)\/[0-9a-f]{64}\.js$/

export const JS_CONTENT_TYPE = "text/javascript; charset=utf-8"

/** Every blob is named by the digest of its own body, so it never changes. */
export const BLOB_CACHE_CONTROL = "public, max-age=31536000, immutable"

/**
 * The headers every blob response carries, hit or miss.
 *
 * `access-control-allow-origin: *` is not laziness. The frame document runs
 * under `sandbox="allow-scripts"` with no `allow-same-origin`, so its origin
 * is the string `null` and there is no origin to put in a list. Without this
 * the frame loads nothing, posts no `ready`, and shows a blank game with no
 * error in the parent, which is a trap worth meeting locally rather than in
 * production.
 *
 * The miss carries it too. A 404 without CORS is reported to the page as a
 * network failure, which sends whoever hit it looking at the wrong layer.
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "cross-origin-resource-policy": "cross-origin",
}

/** Reads a stored artifact by its path, without the leading slash. */
export type BlobReader = (key: string) => Promise<Uint8Array | undefined>

export function createBlobServer(
  read: BlobReader,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url)

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "method not allowed")
    }
    if (!BLOB_PATH.test(pathname)) return text(404, "not found")

    const body = await read(pathname.slice(1))
    if (body === undefined) return text(404, "not found")

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      "content-type": JS_CONTENT_TYPE,
      "cache-control": BLOB_CACHE_CONTROL,
      // Makes a wrong content-type a deterministic refusal rather than a
      // browser-dependent guess.
      "x-content-type-options": "nosniff",
      "content-length": String(body.byteLength),
    }
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers })
    }
    return new Response(body as BodyInit, { status: 200, headers })
  }
}

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...CORS_HEADERS, "content-type": "text/plain; charset=utf-8" },
  })
}

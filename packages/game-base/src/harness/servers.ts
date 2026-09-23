/**
 * Two servers, because a game needs two origins to be tested honestly.
 *
 * The frame origin serves the game document and its two artifacts. The host
 * origin serves the page that frames it. Two ports on localhost are two
 * origins, which is what puts an author in front of the traps a sandboxed
 * cross-origin frame actually has: the opaque origin, `script-src 'self'`,
 * and the `Access-Control-Allow-Origin: *` a frame cannot load its own
 * modules without.
 *
 * What two ports do not reproduce is the second *registrable* domain. The
 * arcade serves frames from a different site so a game cannot set a cookie for
 * the platform, and two localhost ports are one site. Cookie scope is not
 * something a game author can get wrong from inside a sandbox, so the gap is
 * worth naming and not worth closing with an /etc/hosts entry.
 */

import {
  type BlobReader,
  createBlobServer,
  frameCsp,
  frameDocument,
} from "../serve"
import { type BuiltGame, blobKeys } from "./artifacts"

export interface FrameServerOptions {
  readonly port: number
  readonly title: string
  readonly built: BuiltGame
  /** Who may frame the game, verbatim into `frame-ancestors`. */
  readonly siteOrigins: readonly string[]
  /** Every path the browser asked for, so a test can read the network. */
  readonly log?: (path: string) => void
}

export interface RunningServer {
  readonly origin: string
  stop(): Promise<void>
}

/** Serves the game document and its artifacts on one origin. */
export function startFrameServer(options: FrameServerOptions): RunningServer {
  const keys = blobKeys(options.built)
  const blobs = new Map<string, Uint8Array>([
    [keys.sim, options.built.sim],
    [keys.frame, options.built.frame],
  ])
  const read: BlobReader = async (key) => blobs.get(key)
  const serveBlob = createBlobServer(read)

  const document = frameDocument({
    title: options.title,
    frameSrc: `/${keys.frame}`,
  })
  const csp = frameCsp(options.siteOrigins)

  const server = Bun.serve({
    port: options.port,
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      options.log?.(pathname)

      if (pathname === "/" || pathname === "/play") {
        return new Response(document, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // Never cached: the document names an artifact by hash, and a
            // rebuild changes that hash.
            "cache-control": "no-store",
            "content-security-policy": csp,
            "x-content-type-options": "nosniff",
          },
        })
      }
      return serveBlob(request)
    },
  })

  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      await server.stop(true)
    },
  }
}

export interface HostServerOptions {
  readonly port: number
  readonly page?: string
  /** The bundled parent-page script, served from this same origin. */
  readonly script: string
}

export interface RunningHostServer extends RunningServer {
  /**
   * Replaces the page after the server is listening.
   *
   * The page has to name the frame's origin, and the frame's policy has to
   * name this one, so one of them must be written after both are bound. Asking
   * for port 0 makes that plain: the origin is the port the socket *got*, and
   * a harness that built its own origin from the port it asked for served a
   * `frame-ancestors http://127.0.0.1:0` nothing could ever match.
   */
  setPage(html: string): void
}

/** Serves the page that frames the game. */
export function startHostServer(options: HostServerOptions): RunningHostServer {
  let page = options.page ?? ""
  const server = Bun.serve({
    port: options.port,
    fetch: (request) => {
      const { pathname } = new URL(request.url)
      if (pathname === "/harness.js") {
        return new Response(options.script, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
          },
        })
      }
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      })
    },
  })

  return {
    origin: `http://127.0.0.1:${server.port}`,
    setPage: (html: string) => {
      page = html
    },
    stop: async () => {
      await server.stop(true)
    },
  }
}

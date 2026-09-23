/**
 * Every subject, served by the harness an author runs.
 *
 * One process, because Playwright starts a `webServer` by waiting on a URL
 * and four servers behind one health check is one wait rather than four. It
 * builds each game through the real CLI first, exactly as `game-base dev`
 * does, so the manifest the harness reads is this build's and not a stale one
 * left in a working tree.
 *
 * It imports game-base by relative path rather than by package name. The unit
 * tests do the same, and what a consumer gets from the package's exports map
 * is `bun run check:publishable`'s question, not this suite's.
 */

import { join } from "node:path"
import { main } from "../../packages/game-base/src/cli/index"
import { blobKeys, startHarness } from "../../packages/game-base/src/harness"
import { CONTROL_PORT, SUBJECTS, type SubjectName } from "./env"

const ROOT = join(import.meta.dir, "..", "..")

interface Running {
  readonly hostOrigin: string
  readonly frameOrigin: string
  /** The artifacts' content addresses, so a test can read the network. */
  readonly sim: string
  readonly frame: string
}

const running = new Map<SubjectName, Running>()

/**
 * Every path the frame origin was asked for, per subject.
 *
 * This is what makes "the browser fetched the simulation at its own content
 * address" checkable. Reading the server's log rather than the page's
 * `performance` entries observes the network itself, and needs no evaluation
 * inside an opaque-origin frame, where there is nothing to evaluate from.
 */
const requests = new Map<SubjectName, string[]>()

for (const name of Object.keys(SUBJECTS) as SubjectName[]) {
  const subject = SUBJECTS[name]
  const dir = join(ROOT, ...subject.dir)
  requests.set(name, [])

  const code = await main(["build", dir])
  if (code !== 0) throw new Error(`${name} did not build`)

  const harness = await startHarness({
    source: {
      root: dir,
      simEntry: "src/sim/index.ts",
      frameEntry: "src/frame.ts",
    },
    hostPort: subject.hostPort,
    framePort: subject.framePort,
    onRequest: (path) => {
      requests.get(name)?.push(path)
    },
  })
  const keys = blobKeys(harness.built)
  running.set(name, {
    hostOrigin: harness.hostOrigin,
    frameOrigin: harness.frameOrigin,
    sim: `/${keys.sim}`,
    frame: `/${keys.frame}`,
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })
}

Bun.serve({
  port: CONTROL_PORT,
  fetch: (request) => {
    const url = new URL(request.url)
    if (url.pathname === "/health") return new Response("ok")
    if (url.pathname === "/subjects") {
      return json(Object.fromEntries(running))
    }
    // A spec reads the log for the run it just drove, so it clears the log
    // before navigating rather than reasoning about what an earlier test left.
    const asked = url.pathname.match(/^\/requests\/([a-z]+)$/)
    if (asked !== null) {
      const name = asked[1] as SubjectName
      const log = requests.get(name)
      if (log === undefined)
        return new Response("no such subject", { status: 404 })
      if (request.method === "DELETE") {
        log.length = 0
        return new Response("cleared")
      }
      return json(log)
    }
    return new Response("not found", { status: 404 })
  },
})

process.stdout.write(`control http://127.0.0.1:${CONTROL_PORT}\n`)
for (const [name, subject] of running) {
  process.stdout.write(`  ${name}  ${subject.hostOrigin}\n`)
}

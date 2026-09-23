/**
 * The host origin, and the harness started whole.
 *
 * Two ports are two origins, which is the point of the harness: an author
 * meets a real sandboxed cross-origin frame on a laptop rather than in an
 * upload. These tests drive both servers over real HTTP, because a handler
 * called directly would not prove the ports differ.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_FRAME_ENTRY,
  DEFAULT_SIM_ENTRY,
  parseArgs,
} from "../../src/cli/args"
import {
  DEFAULT_FRAME_PORT,
  DEFAULT_HOST_PORT,
  HARNESS_SEED,
  type Harness,
  startHarness,
} from "../../src/harness"
import { startHostServer } from "../../src/harness/servers"

describe("the host origin", () => {
  let server: { origin: string; stop(): Promise<void> }

  beforeAll(() => {
    server = startHostServer({
      port: 0,
      page: "<!doctype html><title>page</title>",
      script: "export const script = 1",
    })
  })

  afterAll(async () => {
    await server.stop()
  })

  test("the page is served as a document", async () => {
    const response = await fetch(server.origin)
    expect(await response.text()).toContain("<title>page</title>")
    expect(response.headers.get("content-type")).toContain("text/html")
  })

  test("the page script is served as a module from this same origin", async () => {
    const response = await fetch(`${server.origin}/harness.js`)
    expect(await response.text()).toBe("export const script = 1")
    expect(response.headers.get("content-type")).toContain("text/javascript")
  })

  /**
   * A rebuild changes the artifact hashes the page names, so a cached page
   * would frame a game that is no longer served and show a blank iframe with
   * a 404 nobody sees.
   */
  test("nothing from the harness is cached", async () => {
    for (const path of ["/", "/harness.js"]) {
      const response = await fetch(`${server.origin}${path}`)
      expect(response.headers.get("cache-control")).toBe("no-store")
    }
  })

  test("any other path is the page, so a deep link still works", async () => {
    const response = await fetch(`${server.origin}/play/anything`)
    expect(await response.text()).toContain("<title>page</title>")
  })
})

describe("the harness, started whole", () => {
  let root: string
  let harness: Harness

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "game-base-harness-"))
    await mkdir(join(root, "src", "sim"), { recursive: true })
    await writeFile(
      join(root, "src", "sim", "index.ts"),
      `export const MANIFEST = {
         schemaVersion: 1, id: "probe", version: "1.0.0", name: "Probe Game",
         session: { tickHz: 30, maxTicks: 900, maxWallSeconds: 60, hasEnding: true },
         inputs: { map: { left: [] }, controls: { mode: "scheme", scheme: "dpad", bind: { left: "left" } } },
       }\n`,
    )
    await writeFile(
      join(root, "src", "frame.ts"),
      `import { MANIFEST } from "cw2:sim"\ndocument.title = MANIFEST.name\n`,
    )
    // The manifest is read from dist, which is what `game-base build` writes.
    await mkdir(join(root, "dist"), { recursive: true })
    await writeFile(
      join(root, "dist", "manifest.json"),
      JSON.stringify({
        name: "Probe Game",
        session: { tickHz: 30, maxTicks: 900 },
        inputs: {
          controls: { mode: "scheme", scheme: "dpad", bind: { left: "left" } },
        },
      }),
    )
    harness = await startHarness({
      source: {
        root,
        simEntry: "src/sim/index.ts",
        frameEntry: "src/frame.ts",
      },
      hostPort: 0,
      framePort: 0,
    })
  })

  afterAll(async () => {
    await harness.stop()
    await rm(root, { recursive: true, force: true })
  })

  /**
   * The whole reason for two servers. One origin would hide the opaque-origin
   * CORS trap, which is the failure that shows up as a blank game with no
   * error anywhere.
   */
  test("the game and the page that frames it are on different origins", () => {
    expect(harness.frameOrigin).not.toBe(harness.hostOrigin)
  })

  test("the page carries the manifest's own session settings", async () => {
    const html = await (await fetch(harness.hostOrigin)).text()
    expect(html).toContain("Probe Game")
    expect(html).toContain(`"tickHz":30`)
    expect(html).toContain(`"maxTicks":900`)
    // The seed is fixed, so a run an author is debugging is the run they had
    // a moment ago.
    expect(html).toContain(`"seed":"${HARNESS_SEED}"`)
  })

  test("the page is told which controls the game declared", async () => {
    const html = await (await fetch(harness.hostOrigin)).text()
    expect(html).toContain(`"scheme":"dpad"`)
  })

  test("the page's script bundles and is served", async () => {
    const script = await (
      await fetch(`${harness.hostOrigin}/harness.js`)
    ).text()
    expect(script.length).toBeGreaterThan(0)
    // It reaches the renderer, which is the thing the picker drives.
    expect(script).toContain("gb-controls")
  })

  /** Only the harness page may frame the game, as only the shell may in production. */
  test("the frame origin names the host origin as its only embedder", async () => {
    const response = await fetch(`${harness.frameOrigin}/play`)
    expect(response.headers.get("content-security-policy")).toContain(
      `frame-ancestors ${harness.hostOrigin}`,
    )
  })

  test("a game with no manifest on disk still starts, on defaults", async () => {
    const bare = await mkdtemp(join(tmpdir(), "game-base-bare-"))
    try {
      await mkdir(join(bare, "src", "sim"), { recursive: true })
      await writeFile(
        join(bare, "src", "sim", "index.ts"),
        "export const a = 1",
      )
      await writeFile(
        join(bare, "src", "frame.ts"),
        `import { a } from "cw2:sim"\ndocument.title = String(a)\n`,
      )
      const plain = await startHarness({
        source: {
          root: bare,
          simEntry: "src/sim/index.ts",
          frameEntry: "src/frame.ts",
        },
        hostPort: 0,
        framePort: 0,
        seed: "chosen",
      })
      try {
        const html = await (await fetch(plain.hostOrigin)).text()
        expect(html).toContain(`"tickHz":60`)
        expect(html).toContain(`"controls":null`)
        expect(html).toContain(`"seed":"chosen"`)
      } finally {
        await plain.stop()
      }
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })
})

describe("what the command line said", () => {
  test("a bare command builds the directory it was run in", () => {
    const options = parseArgs(["build"])
    expect(options.command).toBe("build")
    expect(options.simEntry).toBe(DEFAULT_SIM_ENTRY)
    expect(options.frameEntry).toBe(DEFAULT_FRAME_ENTRY)
    expect(options.hostPort).toBe(DEFAULT_HOST_PORT)
    expect(options.framePort).toBe(DEFAULT_FRAME_PORT)
  })

  test("a directory is resolved, so a relative path is not held against a server's cwd", () => {
    expect(parseArgs(["dev", "./somewhere"]).dir).toMatch(/somewhere$/)
    expect(parseArgs(["dev", "./somewhere"]).dir.startsWith("/")).toBe(true)
  })

  test("every default can be overridden", () => {
    const options = parseArgs([
      "dev",
      ".",
      "--sim",
      "game/sim.ts",
      "--frame",
      "game/frame.ts",
      "--host",
      "5000",
      "--frame-port",
      "5001",
    ])
    expect(options.simEntry).toBe("game/sim.ts")
    expect(options.frameEntry).toBe("game/frame.ts")
    expect(options.hostPort).toBe(5000)
    expect(options.framePort).toBe(5001)
  })

  test("no command at all is a command of nothing, not a crash", () => {
    expect(parseArgs([]).command).toBe("")
  })

  /** A flag with nothing after it takes an empty value rather than eating the next flag. */
  test("a trailing flag does not swallow what follows it", () => {
    expect(parseArgs(["build", "--sim"]).simEntry).toBe("")
  })
})

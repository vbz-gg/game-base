/**
 * A whole game, built and served, against a real port.
 *
 * The game here is two files with no dependency on the engine, which is
 * deliberate: what is under test is the build, the addressing and the serving,
 * and a real engine in the graph would make a failure ambiguous between this
 * package and that one. A game that does use the engine is the browser suite's
 * subject.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildGameArtifacts } from "../../src/build/build"
import { sha256Hex } from "../../src/build/digest"
import { readManifestFromSim } from "../../src/cli/manifest"
import {
  type BuiltGame,
  blobKeys,
  buildAndAddress,
} from "../../src/harness/artifacts"
import { harnessPage } from "../../src/harness/page/document"
import { startFrameServer } from "../../src/harness/servers"

const MANIFEST = {
  schemaVersion: 1,
  id: "probe",
  version: "1.0.0",
  name: "Probe",
  session: { tickHz: 60, maxTicks: 600, maxWallSeconds: 60, hasEnding: true },
}

let root: string
let built: BuiltGame

async function writeGame(dir: string, frame: string): Promise<void> {
  await mkdir(join(dir, "src", "sim"), { recursive: true })
  await writeFile(
    join(dir, "src", "sim", "index.ts"),
    `export const MANIFEST = ${JSON.stringify(MANIFEST)}\n` +
      `export const TINT = "#3bd68a"\n`,
  )
  await writeFile(join(dir, "src", "frame.ts"), frame)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "game-base-e2e-"))
  await writeGame(
    root,
    `import { MANIFEST, TINT } from "cw2:sim"\n` +
      `document.title = MANIFEST.name + TINT\n`,
  )
  built = await buildAndAddress({
    root,
    simEntry: "src/sim/index.ts",
    frameEntry: "src/frame.ts",
  })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("building a game", () => {
  test("the simulation carries no import and the frame carries one", async () => {
    const { sim, frame } = await buildGameArtifacts({
      root,
      simEntry: "src/sim/index.ts",
      frameEntry: "src/frame.ts",
    })
    const simText = new TextDecoder().decode(sim)
    expect(simText).not.toContain("cw2:sim")
    expect(new TextDecoder().decode(frame)).toContain("cw2:sim")
  })

  /**
   * The frame must not carry a copy of the simulation. Minification renames
   * identifiers and leaves string literals alone, so a colour the simulation
   * declares is a probe that survives the build: finding it in the frame
   * means the module was inlined rather than imported.
   */
  test("the simulation's own literals do not appear in the frame", () => {
    expect(new TextDecoder().decode(built.frame)).not.toContain("#3bd68a")
  })

  test("a build repeated in one process gives the same bytes", async () => {
    const again = await buildGameArtifacts({
      root,
      simEntry: "src/sim/index.ts",
      frameEntry: "src/frame.ts",
    })
    expect(sha256Hex(again.sim)).toBe(built.simSha256)
  })

  test("a frame that inlines its simulation is refused at build time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "game-base-inline-"))
    try {
      // Reaching the simulation by a relative path rather than by the one
      // bare specifier is how a frame ends up carrying its own copy.
      await writeGame(
        dir,
        `import { MANIFEST } from "./sim/index"\ndocument.title = MANIFEST.name\n`,
      )
      await expect(
        buildGameArtifacts({
          root: dir,
          simEntry: "src/sim/index.ts",
          frameEntry: "src/frame.ts",
        }),
      ).rejects.toThrow(/imports nothing/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a build of a file that is not there fails with what bun said", async () => {
    await expect(
      buildGameArtifacts({
        root,
        simEntry: "src/nowhere.ts",
        frameEntry: "src/frame.ts",
      }),
    ).rejects.toThrow(/build failed/)
  })
})

describe("addressing a game", () => {
  /**
   * The frame is hashed after its import is rewritten, not before. That is
   * what makes a stored frame name exactly one simulation forever, and it is
   * the property "the browser and the validator ran the same code" rests on.
   */
  test("the stored frame already names the simulation", () => {
    const text = new TextDecoder().decode(built.frame)
    expect(text).toContain(`/sim/${built.simSha256}.js`)
    expect(text).not.toContain("cw2:sim")
    expect(built.frameSha256).toBe(sha256Hex(built.frame))
    expect(built.frameSha256).not.toBe(built.frameSourceSha256)
  })

  test("each hash is the digest of the bytes served under it", () => {
    expect(built.simSha256).toBe(sha256Hex(built.sim))
    expect(blobKeys(built)).toEqual({
      sim: `sim/${built.simSha256}.js`,
      frame: `frame/${built.frameSha256}.js`,
    })
  })
})

describe("reading the manifest out of the built simulation", () => {
  /**
   * The manifest an upload carries has to be the one the code carries, so it
   * is read from the module's own export rather than from a file beside it.
   */
  test("the exported MANIFEST comes back", async () => {
    expect(await readManifestFromSim(built.sim)).toEqual(MANIFEST)
  })

  test("a simulation exporting none says so", async () => {
    const bytes = new TextEncoder().encode("export const other = 1")
    await expect(readManifestFromSim(bytes)).rejects.toThrow(/no MANIFEST/)
  })

  test("a simulation that throws on import says that instead", async () => {
    const bytes = new TextEncoder().encode(`throw new Error("boom")`)
    await expect(readManifestFromSim(bytes)).rejects.toThrow(/boom/)
  })
})

describe("serving it", () => {
  let server: { origin: string; stop(): Promise<void> }
  const asked: string[] = []

  beforeAll(() => {
    server = startFrameServer({
      port: 0,
      title: "Probe",
      built,
      siteOrigins: ["http://127.0.0.1:4310"],
      log: (path) => asked.push(path),
    })
  })

  afterAll(async () => {
    await server.stop()
  })

  test("the document names the stored frame and carries the sandbox", async () => {
    const response = await fetch(`${server.origin}/play`)
    const html = await response.text()
    expect(html).toContain(`/frame/${built.frameSha256}.js`)
    const csp = response.headers.get("content-security-policy") ?? ""
    expect(csp.startsWith("sandbox allow-scripts")).toBe(true)
    expect(csp).toContain("frame-ancestors http://127.0.0.1:4310")
    // The document names an artifact by hash, and a rebuild changes it.
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  test("both artifacts are fetchable at the addresses the document uses", async () => {
    const frame = await fetch(`${server.origin}/frame/${built.frameSha256}.js`)
    const sim = await fetch(`${server.origin}/sim/${built.simSha256}.js`)
    expect(frame.status).toBe(200)
    expect(sim.status).toBe(200)
    expect(sha256Hex(new Uint8Array(await sim.arrayBuffer()))).toBe(
      built.simSha256,
    )
  })

  test("the request log is what the network did, for a test to read", () => {
    expect(asked).toContain("/play")
    expect(asked).toContain(`/sim/${built.simSha256}.js`)
  })

  test("an artifact that was never built is a 404", async () => {
    const response = await fetch(`${server.origin}/sim/${"c".repeat(64)}.js`)
    expect(response.status).toBe(404)
  })
})

describe("the harness page", () => {
  /**
   * `</script>` inside the config would end the block early and put the rest
   * of it into the document as markup. The escape keeps it valid JSON.
   */
  test("config that looks like a closing tag cannot end the block", () => {
    const html = harnessPage({
      title: "Probe",
      config: { note: "</script><img src=x onerror=alert(1)>" },
    })
    expect(html).not.toContain("</script><img")
    expect(html).toContain("<\\/script>")
  })

  test("the title is escaped and the script is a module from this origin", () => {
    const html = harnessPage({ title: `<b>x</b>`, config: {} })
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).toContain('<script type="module" src="/harness.js">')
  })
})

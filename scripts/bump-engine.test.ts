/**
 * The engine's version is written in more than one place.
 *
 * Six, today. The risk is the seventh: a file grows the literal, nothing
 * rewrites it, and a template ships asking for an engine two releases old
 * while everything still builds against whatever the workspace resolved. So
 * these tests do two things - check the rewriting on a tree built for it, and
 * search the real repository for a place the script does not know about.
 */

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bumpEngine, currentEngine, ENGINE, peerRangeFor } from "./bump-engine"

const REPO = join(import.meta.dir, "..")

describe("the range a game must satisfy", () => {
  /**
   * On 0.x the breaking unit is the minor: clockwork2 maps a breaking change
   * to one, and both `inputs.controls` and pointer identity arrived that way.
   */
  test.each([
    ["0.7.1", ">=0.7.1 <0.8.0"],
    ["0.7.0", ">=0.7.0 <0.8.0"],
    ["0.9.4", ">=0.9.4 <0.10.0"],
    ["0.0.1", ">=0.0.1 <0.1.0"],
  ])("%s on 0.x is capped at the next minor", (version, range) => {
    expect(peerRangeFor(version)).toBe(range)
  })

  /**
   * Past 1.0 the breaking unit is the major. Nothing reaches this today, and
   * it is here so that the day the engine does, the cap does not silently
   * start allowing breaking releases through.
   */
  test.each([
    ["1.0.0", ">=1.0.0 <2.0.0"],
    ["2.4.1", ">=2.4.1 <3.0.0"],
  ])("%s past 1.0 is capped at the next major", (version, range) => {
    expect(peerRangeFor(version)).toBe(range)
  })

  test.each(["", "0.7", "v0.7.1", "0.8.0-rc.1", "latest"])(
    "%s is refused rather than pinned",
    (version) => {
      expect(() => peerRangeFor(version)).toThrow(/not a released version/)
    },
  )
})

describe("bumping a tree", () => {
  async function tree(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "game-base-bump-"))
    await mkdir(join(dir, "packages/game-base/templates/game/src/sim"), {
      recursive: true,
    })
    await mkdir(join(dir, "fixtures/paddle/src/sim"), { recursive: true })
    await mkdir(join(dir, "docs"), { recursive: true })

    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { [ENGINE]: "0.7.1", biome: "1" } }),
    )
    await writeFile(
      join(dir, "packages/game-base/package.json"),
      JSON.stringify({
        name: "@vbz-gg/game-base",
        peerDependencies: { [ENGINE]: ">=0.7.1 <0.8.0" },
      }),
    )
    await writeFile(
      join(dir, "packages/game-base/templates/game/package.json"),
      JSON.stringify({ devDependencies: { [ENGINE]: "0.7.1" } }),
    )
    for (const manifest of [
      "packages/game-base/templates/game/src/sim/manifest.ts",
      "fixtures/paddle/src/sim/manifest.ts",
    ]) {
      await writeFile(
        join(dir, manifest),
        `export const MANIFEST = {\n  kernel: { version: "0.7.1" },\n}\n`,
      )
    }
    await writeFile(
      join(dir, "docs/sdk.md"),
      "The range is `>=0.7.1 <0.8.0` rather than open-ended.\n",
    )
    return dir
  }

  async function withTree(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = await tree()
    try {
      await run(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("every place the version is written moves together", async () => {
    await withTree(async (dir) => {
      const result = await bumpEngine("0.8.0", dir)
      expect(result.from.pinned).toBe("0.7.1")
      expect(result.range).toBe(">=0.8.0 <0.9.0")
      expect(result.files.length).toBe(6)

      // And nothing anywhere still says 0.7.1.
      for (const file of result.files) {
        expect(await readFile(join(dir, file), "utf8")).not.toContain("0.7.1")
      }
    })
  })

  test("the pin is exact and the peer range is a range", async () => {
    await withTree(async (dir) => {
      await bumpEngine("0.8.0", dir)
      const root = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      ) as { devDependencies: Record<string, string> }
      const pkg = JSON.parse(
        await readFile(join(dir, "packages/game-base/package.json"), "utf8"),
      ) as { peerDependencies: Record<string, string> }

      expect(root.devDependencies[ENGINE]).toBe("0.8.0")
      expect(pkg.peerDependencies[ENGINE]).toBe(">=0.8.0 <0.9.0")
      // Everything else in the manifest is left alone.
      expect(root.devDependencies.biome).toBe("1")
    })
  })

  test("the docs quote the new range", async () => {
    await withTree(async (dir) => {
      await bumpEngine("0.8.0", dir)
      expect(await readFile(join(dir, "docs/sdk.md"), "utf8")).toContain(
        "`>=0.8.0 <0.9.0`",
      )
    })
  })

  /**
   * The case this script exists to fail on. A file that does not hold what
   * was expected means the literal moved or a seventh place grew, and both
   * want a person rather than a rewrite that quietly does five of six.
   */
  test("a file that lost the literal stops the bump", async () => {
    await withTree(async (dir) => {
      await writeFile(join(dir, "docs/sdk.md"), "nothing about a range here\n")
      await expect(bumpEngine("0.8.0", dir)).rejects.toThrow(/does not hold/)
    })
  })

  test("a manifest with no engine dependency stops it too", async () => {
    await withTree(async (dir) => {
      await writeFile(join(dir, "package.json"), JSON.stringify({}))
      await expect(bumpEngine("0.8.0", dir)).rejects.toThrow(
        /not depended on where it was expected/,
      )
    })
  })

  test.each(["latest", "0.8", "0.8.0-rc.1"])(
    "%s is refused before anything is written",
    async (version) => {
      await withTree(async (dir) => {
        await expect(bumpEngine(version, dir)).rejects.toThrow(
          /not a released version/,
        )
        expect(await readFile(join(dir, "package.json"), "utf8")).toContain(
          "0.7.1",
        )
      })
    },
  )
})

describe("the real repository", () => {
  test("its two spellings of the engine's version agree", async () => {
    const { pinned, range } = await currentEngine(REPO)
    expect(range).toBe(peerRangeFor(pinned))
  })

  /**
   * The search for the seventh place, by kind rather than by name.
   *
   * Three kinds can grow: a package.json depending on the engine, a game
   * manifest declaring the kernel it was built against, and a doc quoting the
   * peer range. A new file of any of them shows up here as one this script
   * does not rewrite. Prose that mentions a version in passing - AGENTS.md
   * recording what was true before 0.7.1 - is not any of those kinds and is
   * excluded by construction rather than by an allowlist.
   */
  test("nothing else holds the version in a way a bump must follow", async () => {
    const rewritten = new Set([
      "package.json",
      "packages/game-base/package.json",
      "packages/game-base/templates/game/package.json",
      "packages/game-base/templates/game/src/sim/manifest.ts",
      "fixtures/paddle/src/sim/manifest.ts",
      "docs/sdk.md",
    ])
    const { pinned, range } = await currentEngine(REPO)

    const found: string[] = []
    const scan = async (
      pattern: string,
      holds: (text: string) => boolean,
    ): Promise<void> => {
      for (const rel of new Bun.Glob(pattern).scanSync({
        cwd: REPO,
        dot: false,
      })) {
        // A test's own fixtures are not files a bump must follow: they hold
        // the literal on purpose, to be bumped and asserted about.
        if (rel.includes("node_modules") || rel.includes("/dist/")) continue
        if (rel.endsWith(".test.ts")) continue
        if (holds(await readFile(join(REPO, rel), "utf8"))) found.push(rel)
      }
    }

    // A manifest that depends on the engine at all.
    await scan("**/package.json", (text) => {
      const manifest = JSON.parse(text) as Record<
        string,
        Record<string, string> | undefined
      >
      return ["dependencies", "devDependencies", "peerDependencies"].some(
        (section) => manifest[section]?.[ENGINE] !== undefined,
      )
    })
    // A game declaring the kernel it was built against. The concrete version
    // rather than the pattern, so bump-engine.ts - which composes that string
    // from a variable in order to replace it - is not taken for a game.
    await scan("**/*.ts", (text) =>
      text.includes(`kernel: { version: "${pinned}"`),
    )
    // A doc quoting the peer range.
    await scan("docs/**/*.md", (text) => text.includes(range))

    expect(found.length).toBeGreaterThan(0)
    for (const file of found) {
      expect(
        rewritten.has(file),
        `${file} holds the engine's version and bump-engine.ts does not rewrite it`,
      ).toBe(true)
    }
    expect(pinned.length).toBeGreaterThan(0)
  })
})

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  exportTargets,
  PUBLIC_PACKAGES,
  problemsWith,
  RUNTIME_FILES,
  type Shipped,
  unimportableSubpaths,
} from "./check-publishable"

function shipped(over: Partial<Shipped> = {}): Shipped {
  return {
    name: "@vbz-gg/game-base",
    version: "0.1.0",
    dependencies: {},
    files: [
      "package.json",
      "README.md",
      "dist/controls/index.js",
      ...RUNTIME_FILES,
    ],
    imports: { problems: [], skipped: [] },
    ...over,
  }
}

describe("what a tarball would do to a consumer", () => {
  test("a good package has nothing to say about it", () => {
    expect(problemsWith(shipped())).toEqual([])
  })

  test("an unrewritten workspace range is caught", () => {
    // It reaches the registry verbatim, and that version is then
    // uninstallable by anyone, permanently.
    const problems = problemsWith(
      shipped({ dependencies: { "@vbz/thing": "workspace:*" } }),
    )
    expect(problems.join("\n")).toContain("no consumer can install")
  })

  test("a missing readme is caught, because npm drops it quietly", () => {
    const problems = problemsWith(shipped({ files: ["package.json"] }))
    expect(problems.join("\n")).toContain("no README.md")
  })

  test("packing without a build is caught", () => {
    const problems = problemsWith(
      shipped({ files: ["package.json", "README.md", "src/index.ts"] }),
    )
    expect(problems.join("\n")).toContain("no dist")
  })

  /**
   * The harness bundles its page script at start, from a path it builds off
   * `import.meta.dir`. Nothing that imports the package would notice its
   * absence: the failure arrives when somebody runs `game-base dev`.
   */
  test("a runtime file the package reads but never imports is caught", () => {
    const problems = problemsWith(
      shipped({
        files: ["package.json", "README.md", "dist/controls/index.js"],
      }),
    )
    expect(problems.join("\n")).toContain("main.js")
  })

  test("a subpath node cannot import is a problem", () => {
    const problems = problemsWith(
      shipped({
        imports: {
          problems: ['node cannot import "./controls": ...'],
          skipped: [],
        },
      }),
    )
    expect(problems.join("\n")).toContain("./controls")
  })

  test("the checker names the package that is published", () => {
    expect(PUBLIC_PACKAGES).toEqual(["game-base"])
  })
})

describe("what plain node makes of the exports map", () => {
  test("every shape of exports entry resolves to its file", () => {
    expect(
      exportTargets({
        "./controls": { default: "./dist/controls/index.js" },
        "./package.json": "./package.json",
        "./types-only": {},
      }),
    ).toEqual([
      ["./controls", "./dist/controls/index.js"],
      ["./package.json", "./package.json"],
    ])
  })

  test("no exports map is no targets, rather than a throw", () => {
    expect(exportTargets(undefined)).toEqual([])
  })

  /**
   * The defect this exists for. `tsc` emits a relative import exactly as the
   * source wrote it, bun and every bundler resolve an extensionless one, and
   * node does not - so a package builds, typechecks, passes its suite and
   * fails on a consumer's first import.
   */
  test("an extensionless relative import is caught", async () => {
    const dir = await mkdtemp(join(tmpdir(), "game-base-importable-"))
    try {
      await mkdir(join(dir, "dist"), { recursive: true })
      await writeFile(join(dir, "dist", "helper.js"), "export const a = 1\n")
      await writeFile(
        join(dir, "dist", "good.js"),
        'export * from "./helper.js"\n',
      )
      await writeFile(join(dir, "dist", "bad.js"), 'export * from "./helper"\n')
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "probe",
          type: "module",
          exports: {
            "./good": { default: "./dist/good.js" },
            "./bad": { default: "./dist/bad.js" },
            // Data rather than a module: importing JSON needs an import
            // attribute the consumer supplies.
            "./package.json": "./package.json",
          },
        }),
      )

      const report = await unimportableSubpaths(dir)
      expect(report.skipped).toEqual([])
      expect(report.problems.length).toBe(1)
      expect(report.problems[0]).toContain('"./bad"')
      expect(report.problems[0]).toContain("Cannot find module")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  /**
   * A peer nobody installed here is not a finding about the package, and it
   * has to read differently from a relative path node cannot resolve.
   */
  test("a missing peer is reported as unchecked, not as broken", async () => {
    const dir = await mkdtemp(join(tmpdir(), "game-base-importable-peer-"))
    try {
      await mkdir(join(dir, "dist"), { recursive: true })
      await writeFile(
        join(dir, "dist", "uses-peer.js"),
        'import "not-a-real-package-91a3"\nexport const a = 1\n',
      )
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "probe",
          type: "module",
          exports: { "./uses-peer": { default: "./dist/uses-peer.js" } },
        }),
      )

      const report = await unimportableSubpaths(dir)
      expect(report.problems).toEqual([])
      expect(report.skipped.join("\n")).toContain("not-a-real-package-91a3")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

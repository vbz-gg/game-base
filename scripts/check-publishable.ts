#!/usr/bin/env bun
/**
 * Packs the package and reads what a consumer would actually get.
 *
 * Everything this checks is invisible to a build, a lint and the test suite,
 * because all three run inside a workspace where everything already resolves.
 * A `workspace:` range would reach the registry verbatim and make a version
 * uninstallable by anyone, permanently, since nothing can be unpublished after
 * 72 hours. A missing `dist` ships a package whose every exports target is a
 * 404. And an extensionless relative import runs everywhere here and nowhere
 * under plain node.
 *
 *   bun run scripts/check-publishable.ts
 *
 * Exit codes: 0 passed, 1 the package would ship broken, 2 nothing to check.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { $ } from "bun"

export const PUBLIC_PACKAGES = ["game-base"] as const

export type Shipped = {
  readonly name: string
  readonly version: string
  readonly dependencies: Record<string, string>
  readonly files: readonly string[]
  /** What plain node made of every subpath the exports map names. */
  readonly imports: ImportReport
}

type ExportsMap = Record<string, { default?: string } | string>

/** What `unimportableSubpaths` found, and what it could not ask about. */
export type ImportReport = {
  readonly problems: readonly string[]
  /** Subpaths whose peer is not installed here. */
  readonly skipped: readonly string[]
}

/** Every subpath in the exports map, and the file it resolves to. */
export function exportTargets(
  exports: ExportsMap | undefined,
): readonly (readonly [string, string])[] {
  const out: [string, string][] = []
  for (const [subpath, target] of Object.entries(exports ?? {})) {
    const file = typeof target === "string" ? target : target.default
    if (file !== undefined) out.push([subpath, file])
  }
  return out
}

/**
 * An error node raises for a bare specifier it cannot resolve.
 *
 * A peer that is not installed is not a finding about this package, and it
 * reads differently from a relative path node cannot resolve, which is.
 */
const MISSING_PEER = /Cannot find package '([^']+)'/

/**
 * Imports every subpath of an unpacked package with plain node.
 *
 * Bun and every bundler resolve an extensionless relative import; node ESM
 * does not, and `tsc` emits what the source wrote. So a package can build,
 * typecheck, pass its whole suite under bun and still fail on a consumer's
 * first `import` with ERR_MODULE_NOT_FOUND.
 *
 * The repository's node_modules is linked into the unpacked tree, so the peer
 * resolves the way it would for somebody who installed it.
 */
export async function unimportableSubpaths(
  packageDir: string,
): Promise<ImportReport> {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  ) as { exports?: ExportsMap }

  try {
    symlinkSync(resolve("node_modules"), join(packageDir, "node_modules"))
  } catch {
    // Already there, or a filesystem that will not link. Every subpath with no
    // peer of its own is still checked, which is most of them.
  }

  const problems: string[] = []
  const skipped: string[] = []
  for (const [subpath, file] of exportTargets(manifest.exports)) {
    // Anything that is not a module is data, and importing JSON needs an
    // import attribute the consumer supplies.
    if (!file.endsWith(".js")) continue

    const url = pathToFileURL(join(packageDir, file)).href
    const result =
      await $`node --input-type=module -e ${`await import(${JSON.stringify(url)})`}`
        .quiet()
        .nothrow()
    if (result.exitCode === 0) continue

    const stderr = result.stderr.toString()
    const peer = stderr.match(MISSING_PEER)
    if (peer !== null) {
      skipped.push(`${subpath} (${peer[1]} is not installed here)`)
      continue
    }
    const reason =
      stderr
        .split("\n")
        .find((line) => line.includes("Cannot find"))
        ?.trim() ?? stderr.split("\n")[0]?.trim()
    problems.push(`node cannot import "${subpath}": ${reason}`)
  }
  return { problems, skipped }
}

/**
 * Files the package reads at runtime rather than imports.
 *
 * Two kinds. The harness bundles its own page script when it starts, from a
 * path built off `import.meta.dir`: in this repository that resolves to the
 * TypeScript beside the source and in an installed copy it has to resolve to
 * the compiled file, which only ships if `tsc` emitted it. And `game-base
 * new` copies the template out of the package, which only works if the
 * template is in the tarball.
 *
 * Nothing that imports the package would notice either one missing. The
 * failure arrives when somebody runs a command.
 */
export const RUNTIME_FILES: readonly string[] = [
  "dist/harness/page/main.js",
  "templates/game/package.json",
  "templates/game/gitignore",
  "templates/game/src/sim/index.ts",
  "templates/game/src/frame.ts",
]

/** Reads the package.json a tarball would carry, not the one on disk. */
export async function pack(pkg: string, into: string): Promise<Shipped> {
  // What is on disk is what ships: there is one package, with no sibling to
  // depend on, so no publish-time rewrite stands between the two.
  await $`npm pack --pack-destination ${into}`.cwd(`packages/${pkg}`).quiet()
  const tarball = [...new Bun.Glob("*.tgz").scanSync(into)][0]
  if (tarball === undefined) throw new Error(`${pkg} produced no tarball`)
  const out = join(into, "unpacked")
  await $`mkdir -p ${out}`.quiet()
  await $`tar -xzf ${join(into, tarball)} -C ${out}`.quiet()
  const manifest = JSON.parse(
    readFileSync(join(out, "package", "package.json"), "utf8"),
  ) as { name: string; version: string; dependencies?: Record<string, string> }
  const files = [...new Bun.Glob("**/*").scanSync(join(out, "package"))]
  return {
    name: manifest.name,
    version: manifest.version,
    dependencies: manifest.dependencies ?? {},
    files,
    imports: await unimportableSubpaths(join(out, "package")),
  }
}

export function problemsWith(shipped: Shipped): string[] {
  const problems: string[] = []
  for (const [name, range] of Object.entries(shipped.dependencies)) {
    if (range.startsWith("workspace:")) {
      problems.push(
        `${shipped.name} would ship ${name}: "${range}", which no consumer can install`,
      )
    }
  }
  // `files` lists README.md, and npm drops a missing entry without failing.
  if (!shipped.files.includes("README.md")) {
    problems.push(`${shipped.name} would ship no README.md`)
  }
  // Without dist there is nothing to import: every exports target is under it.
  if (!shipped.files.some((file) => file.startsWith("dist/"))) {
    problems.push(`${shipped.name} would ship no dist; run "bun run build"`)
  }
  for (const file of RUNTIME_FILES) {
    if (!shipped.files.includes(file)) {
      problems.push(
        `${shipped.name} would ship no ${file}, which it reads at runtime`,
      )
    }
  }
  problems.push(...shipped.imports.problems)
  return problems
}

async function main(): Promise<number> {
  if (!existsSync("packages/game-base/package.json")) {
    console.error("run this from the repository root")
    return 2
  }
  const found: string[] = []
  for (const pkg of PUBLIC_PACKAGES) {
    const into = mkdtempSync(join(tmpdir(), `game-base-pack-${pkg}-`))
    try {
      const shipped = await pack(pkg, into)
      const problems = problemsWith(shipped)
      found.push(...problems)
      console.log(
        `${problems.length === 0 ? "ok  " : "BAD "} ${shipped.name}@${shipped.version}  ${shipped.files.length} files`,
      )
      for (const note of shipped.imports.skipped) {
        console.log(`     not imported: ${note}`)
      }
    } finally {
      rmSync(into, { recursive: true, force: true })
    }
  }
  if (found.length > 0) {
    console.error("\na package would ship broken:")
    for (const line of found) console.error(`  ${line}`)
    console.error(
      "\nthe manifest on disk is what ships; there is no rewrite step to blame",
    )
    return 1
  }
  console.log("\nthe package would install cleanly")
  return 0
}

if (import.meta.main) process.exit(await main())

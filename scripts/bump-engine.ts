#!/usr/bin/env bun
/**
 * Moves this repository onto a new `@clockwork2/engine`.
 *
 *   bun run scripts/bump-engine.ts 0.8.0
 *
 * The engine's version is written in six places and they have to move
 * together: the root's exact pin, the package's peer range, the template's
 * own dependency, the kernel version each example manifest declares, and the
 * range `docs/sdk.md` quotes. Leaving one behind is not loud - a stale
 * template still builds against whatever the workspace resolved, and a stale
 * sentence in the docs is just wrong - so every substitution here is exact and
 * a file that does not carry what was expected is reported rather than
 * skipped.
 *
 * `.github/workflows/engine-update.yml` runs this when the registry has a
 * newer engine, then opens a pull request. Running it by hand is the same
 * thing without the pull request; it does not install, so `bun install`
 * afterwards is what updates the lockfile.
 */

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const ENGINE = "@clockwork2/engine"

const ROOT = join(import.meta.dir, "..")

/** A plain `major.minor.patch`, which is all a release of the engine is. */
export const VERSION = /^(\d+)\.(\d+)\.(\d+)$/

/**
 * The peer range for an engine version.
 *
 * Bounded above, because an unbounded range is a promise this package cannot
 * keep. On 0.x the breaking unit is the minor - clockwork2 maps a breaking
 * change to one, and `inputs.controls` and pointer identity both arrived that
 * way - so the cap is the next minor. Past 1.0 it would be the next major,
 * which is the ordinary semver reading and is here so that the day the engine
 * gets there this does not quietly start allowing breaking releases.
 */
export function peerRangeFor(version: string): string {
  const parts = VERSION.exec(version)
  if (parts === null) throw new Error(`${version} is not a released version`)
  const [major, minor] = [Number(parts[1]), Number(parts[2])]
  const cap = major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`
  return `>=${version} <${cap}`
}

export interface EngineVersions {
  /** The exact version the workspace installs. */
  readonly pinned: string
  /** The range a game installing this package must satisfy. */
  readonly range: string
}

export async function currentEngine(root = ROOT): Promise<EngineVersions> {
  const rootManifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as { devDependencies?: Record<string, string> }
  const packageManifest = JSON.parse(
    await readFile(join(root, "packages/game-base/package.json"), "utf8"),
  ) as { peerDependencies?: Record<string, string> }

  const pinned = rootManifest.devDependencies?.[ENGINE]
  const range = packageManifest.peerDependencies?.[ENGINE]
  if (pinned === undefined || range === undefined) {
    throw new Error(`${ENGINE} is not depended on where it was expected`)
  }
  return { pinned, range }
}

/** A manifest key to set, or a literal to replace, in one file. */
type Edit =
  | { readonly file: string; readonly path: readonly string[] }
  | { readonly file: string; readonly find: string; readonly replace: string }

function edits(from: EngineVersions, to: string): Edit[] {
  const range = peerRangeFor(to)
  return [
    { file: "package.json", path: ["devDependencies", ENGINE] },
    {
      file: "packages/game-base/templates/game/package.json",
      path: ["devDependencies", ENGINE],
    },
    {
      file: "packages/game-base/package.json",
      path: ["peerDependencies", ENGINE],
    },
    // What each example declares it was built against. The platform reads the
    // major without running the game, so it is data rather than a comment.
    ...[
      "packages/game-base/templates/game/src/sim/manifest.ts",
      "fixtures/paddle/src/sim/manifest.ts",
    ].map((file) => ({
      file,
      find: `kernel: { version: "${from.pinned}" }`,
      replace: `kernel: { version: "${to}" }`,
    })),
    // The docs quote the range, so they go stale the moment it moves.
    { file: "docs/sdk.md", find: from.range, replace: range },
  ]
}

export interface Bumped {
  readonly from: EngineVersions
  readonly to: string
  readonly range: string
  readonly files: readonly string[]
}

/**
 * Rewrites every place the engine's version is written.
 *
 * Throws when a file does not hold what was expected, which is the case worth
 * failing on: the substitutions are exact, so a miss means the literal moved
 * or a seventh place grew, and both want a person rather than a silent pass.
 */
export async function bumpEngine(to: string, root = ROOT): Promise<Bumped> {
  if (!VERSION.test(to)) {
    throw new Error(`${to} is not a released version of ${ENGINE}`)
  }
  const from = await currentEngine(root)
  const range = peerRangeFor(to)
  const written: string[] = []

  for (const edit of edits(from, to)) {
    const path = join(root, edit.file)
    const before = await readFile(path, "utf8")

    if ("path" in edit) {
      const manifest = JSON.parse(before) as Record<string, unknown>
      const [section, key] = edit.path as [string, string]
      const bag = manifest[section] as Record<string, string> | undefined
      if (bag?.[key] === undefined) {
        throw new Error(`${edit.file} has no ${section}.${key}`)
      }
      bag[key] = section === "peerDependencies" ? range : to
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
      written.push(edit.file)
      continue
    }

    if (!before.includes(edit.find)) {
      throw new Error(
        `${edit.file} does not hold "${edit.find}", so the engine's version is written somewhere this script does not know about`,
      )
    }
    await writeFile(path, before.replaceAll(edit.find, edit.replace))
    written.push(edit.file)
  }

  return { from, to, range, files: written }
}

if (import.meta.main) {
  const to = process.argv[2]
  if (to === undefined) {
    console.error("usage: bun run scripts/bump-engine.ts <version>")
    process.exit(2)
  }
  const result = await bumpEngine(to)
  console.log(
    `${ENGINE} ${result.from.pinned} -> ${result.to}, peer range ${result.range}`,
  )
  for (const file of result.files) console.log(`  ${file}`)
  console.log("\nrun `bun install` to update the lockfile")
}

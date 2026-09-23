/**
 * The version policy, held by a test rather than by a sentence.
 *
 * Two rules, and both are here because prose could not enforce either.
 *
 * Majors are off the table for now, by decision. On a 0.x version
 * commit-and-tag-version maps a breaking change to a minor, so the ordinary
 * release path cannot reach 1.0.0 by itself, and there is no `release:major`
 * script. This is the backstop: a 1.0.0 release commit fails CI before
 * anything can be published. Lifting the policy means deleting a test in a
 * diff somebody reads.
 *
 * And every package that ships moves with the root. clockwork2 learned this
 * the expensive way: a file held the version literal, was left out of
 * `.versionrc.json`'s bumpFiles, and every release failed - the gate runs as
 * `prerelease`, before the bump, so it compared an old version against a file
 * holding the same old version and passed, and the tag build then found the
 * difference and exited 1. Nothing here embeds a version literal yet. When
 * something does, it joins `bumpFiles` and this file grows the search that
 * finds the next one.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

function manifest(path: string): { version: string; name?: string } {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as {
    version: string
    name?: string
  }
}

const versionrc = JSON.parse(
  readFileSync(join(ROOT, ".versionrc.json"), "utf8"),
) as { bumpFiles: Array<string | { filename: string }> }

describe("the release version", () => {
  test("stays on 0.x while major releases are off the table", () => {
    expect(Number(manifest("package.json").version.split(".")[0])).toBe(0)
  })

  /**
   * The published package and the repository are released together, so a
   * consumer reading a tag gets the package that tag names. They drift the
   * moment one of them is not a bumpFile.
   */
  test("the published package is bumped with the root", () => {
    const bumped = new Set(
      versionrc.bumpFiles.map((f) => (typeof f === "string" ? f : f.filename)),
    )
    expect(bumped.has("package.json")).toBe(true)
    expect(bumped.has("packages/game-base/package.json")).toBe(true)
  })

  test("and holds the same version today", () => {
    expect(manifest("packages/game-base/package.json").version).toBe(
      manifest("package.json").version,
    )
  })
})

/**
 * The platform's route shapes, as this package publishes them.
 *
 * The subpath is types only: a studio's page imports it for its types, and a
 * value in it would land in that page's bundle. So the module has to load
 * with nothing in it, both as source and as built.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const PACKAGE = join(import.meta.dir, "..")

describe("@vbz-gg/sdk/api", () => {
  test("loads as a module that exports no value", async () => {
    const api = await import("../src/api/index.js")
    expect(Object.keys(api)).toEqual([])
  })

  test("is named in the exports map, beside the other halves", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> }
    expect(manifest.exports["./api"]).toEqual({
      development: "./src/api/index.ts",
      types: "./dist/api/index.d.ts",
      default: "./dist/api/index.js",
    })
  })
})

/**
 * The skill is prose an agent follows literally, so a stale sentence is worse
 * than a missing one.
 *
 * Most of it cannot be measured: whether a paragraph about the sandbox is
 * still true is what the `Docs-Updated:` trailer records. What *can* be
 * measured is where the prose restates something the code owns - the scheme
 * table, the slot lists, the refusal codes, the commands, the template's
 * layout - and those are what this file holds. A scheme added to the table
 * without a line in the reference fails here.
 */

import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  BUILD_REFUSAL,
  MAX_FRAME_BYTES,
  MAX_SIM_BYTES,
  SIM_SPECIFIER,
} from "../../packages/game-base/src/build/index.js"
import { TEMPLATE_DIR } from "../../packages/game-base/src/cli/new.js"
import {
  CONTROL_SCHEMES,
  MIN_TOUCH_PX,
  SCHEMES,
} from "../../packages/game-base/src/controls/index.js"

const SKILL = join(import.meta.dir, "..", "arcade-game")
const REFERENCES = join(SKILL, "references")

async function read(...parts: string[]): Promise<string> {
  return await readFile(join(SKILL, ...parts), "utf8")
}

describe("the skill's front matter", () => {
  test("it names itself and says when to use it", async () => {
    const text = await read("SKILL.md")
    const front = text.split("---")[1] ?? ""
    expect(front).toContain("name: arcade-game")
    expect(front).toContain("description:")
    // The description is what an agent matches against, so it has to name
    // the things this skill is for rather than the repository it lives in.
    expect(front).toContain("controls")
    expect(front).toContain("manifest")
  })
})

describe("what the prose restates from the code", () => {
  test("every scheme is in the reference, with its own slots", async () => {
    const text = await read("references", "controls.md")
    for (const scheme of CONTROL_SCHEMES) {
      expect(text).toContain(scheme)
      for (const slot of SCHEMES[scheme].slots) {
        expect(text).toContain(slot.slot)
      }
    }
  })

  test("the reference names no scheme that does not exist", async () => {
    const text = await read("references", "controls.md")
    // The layouts block is the list a reader copies from, so it is the one
    // that must not grow a name the table has never had.
    const block = text.split("```")[1] ?? ""
    for (const line of block.trim().split("\n")) {
      const name = line.trim().split(/\s+/)[0]
      if (name === undefined || name === "") continue
      expect(CONTROL_SCHEMES).toContain(
        name as (typeof CONTROL_SCHEMES)[number],
      )
    }
  })

  test("the smallest a control may be drawn is the number the code uses", async () => {
    const text = await read("references", "controls.md")
    expect(text).toContain(`${MIN_TOUCH_PX} CSS pixels`)
  })

  test("the bare specifier is spelled the way the scan demands", async () => {
    for (const file of ["SKILL.md", "references/artifacts.md"]) {
      expect(await read(...file.split("/"))).toContain(SIM_SPECIFIER)
    }
  })

  test("the size caps are the caps", async () => {
    const text = await read("references", "artifacts.md")
    expect(text).toContain(`${MAX_SIM_BYTES / 1024 / 1024} MiB`)
    expect(text).toContain(`${MAX_FRAME_BYTES / 1024 / 1024} MiB`)
  })

  /**
   * A code in the prose that the code does not raise sends an author looking
   * for a failure that cannot happen. Only the artifact refusals are checked
   * here: the manifest and rank codes belong to the arcade and cannot be
   * imported from this repository.
   */
  test("every artifact refusal named is one that exists", async () => {
    const owned = new Set<string>(Object.values(BUILD_REFUSAL))
    const text = `${await read("SKILL.md")}\n${await read("references", "ingest.md")}`
    const named = text.match(/E_[A-Z0-9_]+/g) ?? []
    const artifactCodes = named.filter(
      (code) =>
        code.startsWith("E_FRAME") ||
        code.startsWith("E_ARTIFACT") ||
        code.startsWith("E_SIM") ||
        code.startsWith("E_REWRITE"),
    )
    expect(artifactCodes.length).toBeGreaterThan(4)
    for (const code of artifactCodes) expect(owned).toContain(code)
  })

  test("every artifact refusal that exists is explained somewhere", async () => {
    const text = `${await read("SKILL.md")}\n${await read("references", "artifacts.md")}\n${await read("references", "ingest.md")}`
    for (const code of Object.values(BUILD_REFUSAL)) {
      if (code === BUILD_REFUSAL.REWRITE_FAILED) continue // the platform's, never an author's
      expect(text).toContain(code)
    }
  })
})

describe("what the skill tells an author to run", () => {
  test("every command it lists is one the CLI takes", async () => {
    const cli = await readFile(
      join(
        import.meta.dir,
        "..",
        "..",
        "packages",
        "game-base",
        "src",
        "cli",
        "index.ts",
      ),
      "utf8",
    )
    const text = await read("SKILL.md")
    for (const command of ["new", "build", "dev"]) {
      expect(text).toContain(`game-base ${command}`)
      expect(cli).toContain(`case "${command}"`)
    }
  })

  test("the layout it prints is the template's own", async () => {
    const text = await read("SKILL.md")
    for (const file of [
      "src/sim/index.ts",
      "src/sim/manifest.ts",
      "src/frame.ts",
    ]) {
      expect(text).toContain(file)
      expect(
        await readFile(join(TEMPLATE_DIR, file), "utf8").catch(() => null),
      ).not.toBeNull()
    }
  })
})

describe("the references", () => {
  test("every one on disk is linked, and every link is on disk", async () => {
    const onDisk = (await readdir(REFERENCES)).filter((f) => f.endsWith(".md"))
    const text = await read("SKILL.md")
    const linked = new Set(
      (text.match(/references\/[a-z-]+\.md/g) ?? []).map((path) =>
        path.replace("references/", ""),
      ),
    )
    expect([...linked].sort()).toEqual(onDisk.sort())
  })

  test("they point at the other skill rather than repeating it", async () => {
    // Determinism is platform-game's subject. Two copies of that rulebook is
    // how one of them goes quietly out of date.
    const text = await read("SKILL.md")
    expect(text).toContain("platform-game")
    expect(text).not.toContain("dmath.ipow")
  })
})

describe("house style", () => {
  test("no em dashes anywhere in the skill", async () => {
    const files = [
      "SKILL.md",
      ...(await readdir(REFERENCES)).map((f) => `references/${f}`),
    ]
    for (const file of files) {
      const text = await read(...file.split("/"))
      expect(text.includes("—")).toBe(false)
      expect(text.includes("–")).toBe(false)
    }
  })
})

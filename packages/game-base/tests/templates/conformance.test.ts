/**
 * The template and the fixture are games the arcade would accept.
 *
 * This is the guard against drift. clockwork2 has templates of its own and
 * they do not ship to npm - its `files` is `dist`, `src`, `README.md` - so
 * these are a second copy, and a second copy rots. What matters is not
 * whether the files still match, which they were never required to, but
 * whether each still passes everything a platform checks before it will run a
 * game. That is the drift worth catching.
 *
 * It builds through the real `buildGameArtifacts`, so a template that stops
 * building, or starts inlining its simulation into its frame, fails here too.
 */

import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSubject, validate } from "@clockwork2/engine/validate"
import { buildGameArtifacts } from "../../src/build/build"
import { readManifestFromSim } from "../../src/cli/manifest"

const ROOT = join(import.meta.dir, "..", "..", "..", "..")

/** Every subject the repository ships, and what each one is for. */
const SUBJECTS = [
  { name: "the scheme template", dir: join(ROOT, "templates", "game") },
  { name: "the paddle fixture", dir: join(ROOT, "fixtures", "paddle") },
] as const

async function report(dir: string) {
  const { sim, frame } = await buildGameArtifacts({
    root: dir,
    simEntry: "src/sim/index.ts",
    frameEntry: "src/frame.ts",
  })
  const manifest = await readManifestFromSim(sim)

  // The suite wants a directory laid out as `index.js` with `manifest.json`
  // beside it. Pointed at a file it throws from `budgets`, which walks the
  // subject's root.
  const subject = await mkdtemp(join(tmpdir(), "game-base-conformance-"))
  try {
    await writeFile(join(subject, "index.js"), sim)
    await writeFile(
      join(subject, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    )
    return {
      built: { sim, frame },
      manifest: manifest as { inputs?: { controls?: { mode?: string } } },
      result: await validate(await loadSubject(subject), {}),
    }
  } finally {
    await rm(subject, { recursive: true, force: true })
  }
}

describe("what this repository ships as an example", () => {
  for (const subject of SUBJECTS) {
    test(`${subject.name} passes every conformance check`, async () => {
      const { result } = await report(subject.dir)
      const failed = result.outcomes
        .filter((outcome) => !outcome.ok)
        .map(
          (outcome) => `${outcome.check}: ${JSON.stringify(outcome.findings)}`,
        )
      expect(failed).toEqual([])
      expect(result.ok).toBe(true)
      // A suite that ran nothing would pass vacuously.
      expect(result.outcomes.length).toBeGreaterThan(8)
    }, 120_000)
  }

  /**
   * The two exist to show different answers to the same question, and a
   * change that made them agree would leave one path with no example at all.
   */
  test("between them they cover both ways to have controls", async () => {
    const modes = []
    for (const subject of SUBJECTS) {
      const { manifest } = await report(subject.dir)
      modes.push(manifest.inputs?.controls?.mode)
    }
    expect(modes.sort()).toEqual(["custom", "scheme"])
  }, 120_000)
})

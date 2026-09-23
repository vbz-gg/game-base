/**
 * Reading a game's manifest out of its built simulation.
 *
 * The simulation exports `MANIFEST`, so the manifest an upload carries is the
 * one the code carries, and the two cannot disagree. Getting at it means
 * evaluating the module, which happens in a subprocess rather than in this
 * one: a game is somebody else's code and the CLI has no business running it
 * in its own process, where it would share a filesystem handle and an
 * environment with whatever else the author is doing.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Evaluates the built simulation and returns what it exports as `MANIFEST`.
 *
 * Throws with the subprocess's own output when the module does not load or
 * exports nothing, because "the manifest is missing" and "your simulation
 * throws on import" are different problems and the author needs to know which.
 */
export async function readManifestFromSim(sim: Uint8Array): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "game-base-manifest-"))
  const path = join(dir, "sim.js")
  try {
    await writeFile(path, sim)
    const child = Bun.spawn(
      [
        "bun",
        "-e",
        `const m = await import(${JSON.stringify(path)});
         if (m.MANIFEST === undefined) {
           process.stderr.write("the simulation exports no MANIFEST");
           process.exit(1);
         }
         process.stdout.write(JSON.stringify(m.MANIFEST));`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code !== 0) {
      throw new Error(`could not read the manifest:\n${err.trim()}`)
    }
    return JSON.parse(out) as unknown
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

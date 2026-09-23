/**
 * `game-base new`, which is how an author starts.
 *
 * What matters is that the copy is a game rather than a template with
 * somebody else's name on it: the id a board will be kept under is settled at
 * copy time, because it is immutable once published, and the copy builds
 * before a line of it is changed.
 */

import { describe, expect, test } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildGameArtifacts } from "../../src/build/index.js"
import {
  createGame,
  gameIdFrom,
  IGNORE_IN_GAME,
  IGNORE_IN_TEMPLATE,
  renamed,
  TEMPLATE_DIR,
  TEMPLATE_ID,
  TEMPLATE_TITLE,
  titleFrom,
  versionsFor,
} from "../../src/cli/new.js"

const VERSIONS = { gameBase: "^9.9.9", engine: ">=9.0.0 <10.0.0" }

async function into(
  name: string,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "game-base-new-"))
  try {
    await run(join(parent, name))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
}

describe("the id a game is published under", () => {
  test.each([
    ["my-game", "my-game"],
    ["My Game", "my-game"],
    ["  Tiki  Kong  ", "tiki-kong"],
    ["snakes_on_a_chain", "snakes-on-a-chain"],
    ["---", "game"],
    ["", "game"],
  ])("%s becomes %s", (name, id) => {
    expect(gameIdFrom(name)).toBe(id)
  })

  test("a title reads as one, from an id nobody wrote by hand", () => {
    expect(titleFrom("tiki-kong")).toBe("Tiki Kong")
    expect(titleFrom("game")).toBe("Game")
  })
})

describe("renaming the template", () => {
  test("every occurrence goes, not the first", () => {
    const before = `${TEMPLATE_ID} and ${TEMPLATE_ID}, called ${TEMPLATE_TITLE}`
    expect(renamed(before, "tiki-kong", "Tiki Kong")).toBe(
      "tiki-kong and tiki-kong, called Tiki Kong",
    )
  })

  /**
   * The class in `src/sim/game.ts` is `LaneRunner` with no space, so the
   * title substitution cannot reach it. If it could, a copy would be a game
   * whose simulation no longer compiles.
   */
  test("an identifier is not a title", () => {
    expect(renamed("class LaneRunner {}", "tiki-kong", "Tiki Kong")).toBe(
      "class LaneRunner {}",
    )
  })
})

describe("what a copy is", () => {
  test("it takes its id and title from the directory", async () => {
    await into("tiki-kong", async (dir) => {
      const made = await createGame({ dir, versions: VERSIONS })
      expect(made.id).toBe("tiki-kong")
      expect(made.title).toBe("Tiki Kong")

      const manifest = await readFile(join(dir, "src/sim/manifest.ts"), "utf8")
      expect(manifest).toContain('id: "tiki-kong"')
      expect(manifest).toContain('name: "Tiki Kong"')
      expect(manifest).not.toContain(TEMPLATE_ID)
    })
  }, 30_000)

  test("it asks for the versions of the copy that made it", async () => {
    await into("probe", async (dir) => {
      await createGame({ dir, versions: VERSIONS })
      const pkg = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      ) as { name: string; devDependencies: Record<string, string> }
      expect(pkg.name).toBe("probe")
      expect(pkg.devDependencies["@vbz-gg/game-base"]).toBe(VERSIONS.gameBase)
      expect(pkg.devDependencies["@clockwork2/engine"]).toBe(VERSIONS.engine)
    })
  }, 30_000)

  /**
   * A build in the template would copy one game's artifacts into another and
   * call them its own, and the hashes would name a simulation nobody here
   * built.
   */
  test("a build left in the template is not copied", async () => {
    const source = await mkdtemp(join(tmpdir(), "game-base-template-"))
    try {
      await mkdir(join(source, "dist"), { recursive: true })
      await writeFile(join(source, "dist", "sim.js"), "// somebody else's\n")
      await writeFile(join(source, "package.json"), '{"name":"lane-runner"}\n')
      await into("copied", async (dir) => {
        await createGame({ dir, template: source, versions: VERSIONS })
        expect(
          await readFile(join(dir, "dist", "sim.js"), "utf8").catch(() => null),
        ).toBeNull()
      })
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  }, 30_000)

  /**
   * npm renames a `.gitignore` to `.npmignore` inside a tarball, so the
   * template carries one under a name npm leaves alone. Without the rename
   * every game made from an installed copy starts out committing its build.
   */
  test("the ignore file arrives under the name git reads", async () => {
    await into("ignored", async (dir) => {
      await createGame({ dir, versions: VERSIONS })
      expect(
        await readFile(join(dir, IGNORE_IN_GAME), "utf8").catch(() => null),
      ).toContain("dist")
      expect(
        await readFile(join(dir, IGNORE_IN_TEMPLATE), "utf8").catch(() => null),
      ).toBeNull()
    })
  }, 30_000)

  /** Merging into somebody's directory is worse than refusing to start. */
  test("a directory with anything in it is refused", async () => {
    await into("occupied", async (dir) => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "notes.md"), "mine\n")
      await expect(createGame({ dir, versions: VERSIONS })).rejects.toThrow(
        /not empty/,
      )
      // And nothing of the template reached it.
      expect(
        await readFile(join(dir, "package.json"), "utf8").catch(() => null),
      ).toBeNull()
    })
  })

  test("an empty directory that already exists is fine", async () => {
    await into("made-first", async (dir) => {
      await mkdir(dir, { recursive: true })
      const made = await createGame({ dir, versions: VERSIONS })
      expect(made.id).toBe("made-first")
    })
  }, 30_000)

  /**
   * The point of starting from a template: it builds before anything is
   * changed, so the first failure an author sees is one they caused.
   */
  test("the copy builds into the two artifacts", async () => {
    await into("fresh-game", async (dir) => {
      await createGame({ dir, versions: VERSIONS })
      // An author runs `bun install` first; a temp directory has no node
      // modules above it, so the engine is linked in rather than installed.
      await symlink(resolve("node_modules"), join(dir, "node_modules"))
      const { sim, frame } = await buildGameArtifacts({
        root: dir,
        simEntry: "src/sim/index.ts",
        frameEntry: "src/frame.ts",
      })
      expect(sim.byteLength).toBeGreaterThan(1000)
      expect(frame.byteLength).toBeGreaterThan(sim.byteLength)
      // The renamed id travelled into the built simulation rather than
      // staying a string in a file nobody reads.
      expect(new TextDecoder().decode(sim)).toContain("fresh-game")
    })
  }, 120_000)
})

describe("the versions a new game asks for", () => {
  test("they are this package's own", async () => {
    const versions = await versionsFor()
    expect(versions.gameBase).toMatch(/^\^\d+\.\d+\.\d+/)
    expect(versions.engine).toContain("0.")
  })

  test("a manifest with neither still produces something installable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "game-base-versions-"))
    try {
      const path = join(dir, "package.json")
      await writeFile(path, "{}")
      expect(await versionsFor(path)).toEqual({
        gameBase: "^0.1.0",
        engine: "*",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("where the template lives", () => {
  /**
   * The path is built off `import.meta.dir`, and it has to land in the same
   * place from `src/cli` and from `dist/cli`, or `game-base new` works here
   * and nowhere else.
   */
  test("it is inside the package, at one relative path", async () => {
    const manifest = await readFile(join(TEMPLATE_DIR, "package.json"), "utf8")
    expect(manifest).toContain(TEMPLATE_ID)
    expect(TEMPLATE_DIR).toContain(join("templates", "game"))
  })
})

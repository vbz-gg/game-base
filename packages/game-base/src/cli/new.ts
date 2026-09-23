/**
 * A game that already conforms, copied into a directory of your own.
 *
 * Starting from a template rather than an empty directory is what makes the
 * first failure yours: the copy builds, passes the whole conformance suite and
 * plays in the harness before a line of it is changed, so anything that breaks
 * afterwards is something you just did.
 *
 * The template ships inside the package, at the same place relative to this
 * module in the source tree and in `dist`, so an installed copy has it too.
 */

import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"

/** The template this package ships, wherever it is installed. */
export const TEMPLATE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "templates",
  "game",
)

/** This package's own manifest, for the versions a new game should ask for. */
const OWN_MANIFEST = join(import.meta.dir, "..", "..", "package.json")

/**
 * The template's ignore file, which cannot be called `.gitignore` on disk.
 *
 * npm renames a `.gitignore` to `.npmignore` inside a tarball, so a template
 * carrying one ships without it and every game made from an installed copy
 * starts out committing its own build output. It is stored under a name npm
 * leaves alone and renamed on the way into a new game.
 */
export const IGNORE_IN_TEMPLATE = "gitignore"
export const IGNORE_IN_GAME = ".gitignore"

/**
 * Directories a copy leaves behind, by name rather than by path.
 *
 * The first spelling of this tested the absolute source path for `/dist` and
 * `/node_modules`, which is a filter that works from a source tree and
 * rejects every file from an installed one: a package installed under
 * `node_modules` has that in the path of everything it owns. `game-base new`
 * then made an empty directory and failed reading the package.json it had not
 * copied. It shipped in 0.1.0 because the tarball was unpacked by hand rather
 * than installed, and a hand-unpacked tarball is the one layout where the bug
 * is invisible.
 */
export const NOT_COPIED = new Set(["dist", "node_modules"])

/** Whether a file under the template is one a new game should get. */
export function isCopied(template: string, source: string): boolean {
  return !relative(template, source)
    .split(sep)
    .some((segment) => NOT_COPIED.has(segment))
}

/** What the template calls itself, and what a copy renames. */
export const TEMPLATE_ID = "lane-runner"
export const TEMPLATE_TITLE = "Lane Runner"

/**
 * A game's id, derived from the directory it was made in.
 *
 * An id is immutable once published - changing it is a different game with a
 * different board - so it is settled here rather than left as a placeholder
 * somebody forgets.
 */
export function gameIdFrom(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return id === "" ? "game" : id
}

/** A title for a human, from an id nobody wrote by hand. */
export function titleFrom(id: string): string {
  return id
    .split("-")
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** The template's own name, everywhere it appears in one file. */
export function renamed(text: string, id: string, title: string): string {
  return text.replaceAll(TEMPLATE_ID, id).replaceAll(TEMPLATE_TITLE, title)
}

/**
 * The versions a new game asks for.
 *
 * `@vbz-gg/game-base` is pinned to the copy that made it, and the engine to
 * the range that copy declares as its peer - so a new game installs one engine
 * and it is one this SDK was built against.
 */
export async function versionsFor(
  manifestPath = OWN_MANIFEST,
): Promise<{ gameBase: string; engine: string }> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version?: string
    peerDependencies?: Record<string, string>
  }
  return {
    gameBase: `^${manifest.version ?? "0.1.0"}`,
    engine: manifest.peerDependencies?.["@clockwork2/engine"] ?? "*",
  }
}

export interface NewGameOptions {
  readonly dir: string
  readonly template?: string
  readonly versions?: { readonly gameBase: string; readonly engine: string }
}

export interface NewGame {
  readonly id: string
  readonly title: string
  readonly dir: string
}

/**
 * Copies the template into `dir` and renames it.
 *
 * An existing directory with anything in it is refused rather than merged
 * into: a half-overwritten game is worse than no game, and the author is the
 * only one who knows what was in there.
 */
export async function createGame(options: NewGameOptions): Promise<NewGame> {
  const { dir } = options
  const existing = await readdir(dir).catch(() => null)
  if (existing !== null && existing.length > 0) {
    throw new Error(`${dir} is not empty`)
  }

  const id = gameIdFrom(basename(dir))
  const title = titleFrom(id)
  const versions = options.versions ?? (await versionsFor())

  await mkdir(dir, { recursive: true })
  // A template with a build in it would copy somebody else's artifacts into a
  // new game and call them its own.
  const template = options.template ?? TEMPLATE_DIR
  await cp(template, dir, {
    recursive: true,
    filter: (source) => isCopied(template, source),
  })

  await rename(join(dir, IGNORE_IN_TEMPLATE), join(dir, IGNORE_IN_GAME)).catch(
    () => {
      // A template without one is still a game; it just tracks its build.
    },
  )

  for (const file of ["package.json", "README.md", "src/sim/manifest.ts"]) {
    const path = join(dir, file)
    const before = await readFile(path, "utf8").catch(() => null)
    if (before === null) continue
    await writeFile(path, renamed(before, id, title))
  }

  // The dependency lines are versions rather than names, so they are set from
  // this package rather than renamed.
  const manifestPath = join(dir, "package.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    devDependencies?: Record<string, string>
  }
  manifest.devDependencies = {
    ...manifest.devDependencies,
    "@clockwork2/engine": versions.engine,
    "@vbz-gg/game-base": versions.gameBase,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return { id, title, dir }
}

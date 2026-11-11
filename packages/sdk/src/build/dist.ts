/**
 * Where `vbz build` puts a game's three files, and what it calls them.
 *
 * One home, because three places read them: the build writes them, the
 * harness reads the manifest beside the artifacts, and `vbz publish` uploads
 * all three. A name that moved in one and not the others would build cleanly
 * and then upload a stale file, or report a build as missing right after it
 * was made.
 */

/** The directory, inside a game's root, that the build writes. */
export const DIST_DIR = "dist"

/** The three files in it. */
export const DIST_FILES = {
  manifest: "manifest.json",
  sim: "sim.js",
  frame: "frame.js",
} as const

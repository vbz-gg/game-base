/**
 * Rejects a commit that changes what the documentation describes unless its
 * message carries a `Docs-Updated:` trailer.
 *
 * `docs/sdk.md`, the two READMEs and `skill/arcade-game/` are read by people
 * and by agents that follow them literally, so a stale sentence is worse than
 * a missing one. This repository sits between two others, and most of what it
 * documents is a contract rather than a behaviour: which slots a scheme has,
 * what a frame may import, which headers make a sandboxed frame load. Nothing
 * can measure whether a paragraph about one of those is still true. The
 * trailer is the record that somebody looked.
 *
 *   bun run scripts/check-docs-updated.ts <commit-msg-file>
 *
 * Exit codes: 0 passed, 1 rejected, 2 called wrongly.
 */

import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

export const TRAILER = "Docs-Updated"

/** Values that name the rule without recording anything. */
const BARE_VALUES = new Set([
  "yes",
  "y",
  "no",
  "n",
  "true",
  "ok",
  "done",
  "checked",
  "updated",
  "n/a",
  "na",
  "none",
  "-",
])

/** Shortest value that can say what was checked. */
export const MIN_VALUE_LENGTH = 10

/**
 * commitlint's config-conventional caps a body or footer line at 100 columns,
 * so a trailer longer than this is rejected before this script ever sees it.
 * The examples below are written to fit, and a test holds them there.
 */
export const MAX_TRAILER_LINE = 100

/** Paths whose change can leave a doc, a skill file or a template behind. */
export const BEARING_PATTERNS: readonly RegExp[] = [
  /^packages\//,
  /^e2e\//,
  /^scripts\//,
  /^skill\//,
  /^docs\//,
  // A template is copied into somebody's project and a fixture is the worked
  // example a doc points at, so both are documentation that happens to run.
  /^templates\//,
  /^fixtures\//,
  /^README\.md$/,
  /^package\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^biome\.json$/,
  /^bunfig\.toml$/,
  /^\.github\//,
]

export const EXAMPLES: readonly string[] = [
  `${TRAILER}: added the dpad+2 slots to sdk.md and to the skill's controls page`,
  `${TRAILER}: re-read sdk.md on the two artifacts; the rewrite is unchanged`,
  `${TRAILER}: new browser test only, no documented contract moved`,
]

/** Git's scissors line, below which the editor buffer is not the message. */
const SCISSORS = "------------------------ >8 ------------------------"

/** The message git will actually record: no comments, nothing below scissors. */
export function effectiveMessage(raw: string): string {
  const cut = raw.indexOf(SCISSORS)
  const body = cut === -1 ? raw : raw.slice(0, cut)
  return body
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim()
}

/**
 * Messages nobody writes by hand. `git commit --fixup` and `--squash` supply
 * theirs with no editor at all, so demanding a trailer there leaves
 * `--no-verify` as the only way through, and the release commit is generated
 * the same way.
 */
export function isExemptCommit(message: string): boolean {
  return (
    /^(Merge |Revert |fixup!|squash!|amend!)/.test(message) ||
    /^chore\(release\)/.test(message)
  )
}

export function bearingFiles(staged: readonly string[]): string[] {
  return staged.filter((file) => BEARING_PATTERNS.some((p) => p.test(file)))
}

export function findTrailerValue(message: string): string | null {
  const match = message.match(new RegExp(`^${TRAILER}:[ \\t]*(.*)$`, "im"))
  return match?.[1] === undefined ? null : match[1].trim()
}

export function isBareValue(value: string): boolean {
  return value.length < MIN_VALUE_LENGTH || BARE_VALUES.has(value.toLowerCase())
}

/** `packages/game-base/src/controls/render.ts and 3 more`, for a rejection. */
export function summarize(bearing: readonly string[]): string {
  const rest = bearing.length - 1
  return `${bearing[0]}${rest > 0 ? ` and ${rest} more` : ""}`
}

export function checkCommitMessage(
  raw: string,
  staged: readonly string[],
): { ok: boolean; error?: string } {
  const message = effectiveMessage(raw)
  if (message.length === 0 || isExemptCommit(message)) return { ok: true }

  const bearing = bearingFiles(staged)
  if (bearing.length === 0) return { ok: true }

  const value = findTrailerValue(message)
  if (value === null) {
    return {
      ok: false,
      error: `this commit changes what the docs describe (${summarize(
        bearing,
      )}) but carries no ${TRAILER}: trailer`,
    }
  }
  if (isBareValue(value)) {
    return {
      ok: false,
      error: `${TRAILER} value "${value}" records nothing; name the docs you read or updated, or say why none apply`,
    }
  }
  return { ok: true }
}

export function stagedFiles(): string[] {
  return execSync("git diff --cached --name-only", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
}

function main(): void {
  const messageFile = process.argv[2]
  if (messageFile === undefined) {
    console.error("usage: bun run scripts/check-docs-updated.ts <msg-file>")
    process.exit(2)
  }

  const result = checkCommitMessage(
    readFileSync(messageFile, "utf8"),
    stagedFiles(),
  )
  if (result.ok) return

  console.error(`\ncommit rejected: ${result.error}\n`)
  console.error(
    "docs/sdk.md, the two READMEs and skill/arcade-game/ describe this SDK.",
  )
  console.error(
    "The trailer records that you re-read the ones covering what you changed and",
  )
  console.error("brought them back in line. Say what you did:\n")
  for (const example of EXAMPLES) console.error(`  ${example}`)
  console.error(
    `\nA trailer line has to fit ${MAX_TRAILER_LINE} columns. Never pass --no-verify.\n`,
  )
  process.exit(1)
}

if (import.meta.main) main()

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
 *
 * The rest of this file holds the two workflows' shape. Each assertion is a
 * mistake clockwork2 made and paid for, and a workflow cannot be unit tested,
 * so reading it is the only check there is.
 */

import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
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

describe("the release workflow", () => {
  const workflow = readFileSync(
    join(ROOT, ".github/workflows/release.yml"),
    "utf8",
  )

  /**
   * The name is the configuration. npm's trusted publisher is set up against
   * this repository and this filename, so renaming the file revokes the
   * credential and the next release fails at the OIDC exchange rather than
   * here.
   */
  test("it is the file the trusted publisher names", () => {
    expect(existsSync(join(ROOT, ".github/workflows/release.yml"))).toBe(true)
    expect(workflow).toContain("id-token: write")
    // It reads no long-lived credential from this repository's secrets,
    // which is the whole point of trusted publishing. The comment at the top
    // of the file names NPM_TOKEN to say so, hence the precise spelling.
    expect(workflow).not.toContain("secrets.NPM_TOKEN")
  })

  /**
   * A dispatch has to cut a new version. clockwork2's workflow published
   * whatever version the tree held, expecting a bump to have been run on a
   * laptop first, so a dispatch after a merge found that version on the
   * registry, skipped, and reported success having released nothing.
   */
  test("a dispatch bumps, rebuilds and tags the commit it bumped", () => {
    expect(workflow).toContain("name: Bump the version")
    expect(workflow).toContain("commit-and-tag-version")
    // dist is what the tarball carries, and the bump rewrote the manifests it
    // was built from.
    expect(workflow).toContain("name: Rebuild at the bumped version")
    // The tag names the bump commit rather than the one checked out. The
    // fallback spelling is what says the target is not plain GITHUB_SHA.
    expect(workflow).toContain("RELEASE_SHA:-")
    // Without full history commit-and-tag-version reads the wrong previous
    // tag and re-lists commits that already shipped.
    expect(workflow).toContain("fetch-depth: 0")
  })

  /**
   * A dispatch on a tree with nothing new refuses, and the notes throw on an
   * empty section. Between them that is clockwork2's 0.6.0, a version whose
   * release body said nothing about itself.
   */
  test("it refuses a release nobody can describe", () => {
    expect(workflow).toContain("git describe --tags --abbrev=0")
    expect(workflow).toContain("git rev-list")
    expect(workflow).toContain("release-notes.ts")
  })

  /**
   * A release tells the arcade, and never fails because it could not. By the
   * time that step runs the version is published, tagged and announced, so a
   * missing or expired token must not turn a release that worked into a red
   * run - and the arcade polls the registry daily, which is what makes that a
   * delay rather than a miss.
   */
  test("it tells the arcade, best-effort", () => {
    const step = workflow.slice(workflow.indexOf("- name: Tell the arcade"))
    expect(step).toContain("event_type=game-base-released")
    // GITHUB_TOKEN cannot dispatch to another repository.
    expect(step).toContain("secrets.ENGINE_RELEASED_TOKEN")
    expect(step).toContain("continue-on-error: true")
    // It reads the version after the bump, so it names what was published.
    expect(step).toContain("packages/game-base/package.json")
    // And it says so when the token is not there, rather than failing.
    expect(step).toContain("the arcade's daily check will pick this up")
  })

  /**
   * No majors, in the one place somebody would reach for one. The test above
   * holding the version at 0 is the backstop; this is the door.
   */
  test("it offers no major bump", () => {
    const options = /options: \[([^\]]*)\]/.exec(workflow)?.[1] ?? ""
    expect(options).toContain("patch")
    expect(options).toContain("minor")
    expect(options).not.toContain("major")
  })

  /**
   * The release gate is the one job whose mistakes cannot be undone, so it
   * runs what CI runs rather than less. clockwork2 shipped a release workflow
   * that ran a subset while its own docs said it ran the same thing.
   */
  test("its gate is the one CI runs", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")
    for (const step of [
      "bun run lint",
      "bun run build",
      "bun run typecheck",
      "bun run test:coverage",
      "check:publishable",
    ]) {
      expect(ci, `ci.yml runs ${step}`).toContain(step)
      expect(workflow, `release.yml runs ${step}`).toContain(step)
    }
  })
})

describe("the engine update", () => {
  const workflow = readFileSync(
    join(ROOT, ".github/workflows/engine-update.yml"),
    "utf8",
  )

  test("it bumps through the script rather than by hand", () => {
    expect(workflow).toContain("scripts/bump-engine.ts")
  })

  /**
   * Two triggers, and neither is redundant. The dispatch makes a release
   * arrive in seconds; the daily check is what makes a missing or expired
   * token a delay rather than a miss, and it is the only one that catches a
   * version published from a laptop.
   */
  test("a dispatch is the fast path and the daily check is the backstop", () => {
    expect(workflow).toContain("repository_dispatch")
    expect(workflow).toContain("engine-released")
    expect(workflow).toContain("cron:")
    // The registry decides either way, so a dispatch cannot name a version
    // npm does not have.
    expect(workflow).toContain("npm view @clockwork2/engine version")
    expect(workflow).toContain("client_payload.version")
  })

  /** One release must not become one pull request per trigger. */
  test("it opens one pull request per engine release", () => {
    expect(workflow).toContain("gh pr list --head")
    expect(workflow).toContain('branch="engine/')
  })

  /**
   * A token that can push but cannot open a pull request leaves
   * engine/<version> on the remote with no pull request. The next run finds
   * no pull request, bumps again from main, and a plain push is refused
   * because the branch holds the earlier run's commit, so every run after
   * that is red until somebody deletes the branch by hand.
   */
  test("a branch left without its pull request does not wedge the next run", () => {
    expect(workflow).toContain('git push --force origin "$BRANCH"')
  })

  /**
   * A pull request opened with GITHUB_TOKEN starts no workflow run, so the
   * checks a reviewer would look for never appear on it. The gate therefore
   * runs in the job that opens the pull request, and the result goes in the
   * body.
   */
  test("it runs the gate itself, because its pull request gets no CI", () => {
    expect(workflow).toContain("bun run test:coverage")
    expect(workflow).toContain("gh pr create")
    expect(workflow).toContain("carries no checks of its own")
  })
})

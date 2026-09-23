/**
 * The browser suite.
 *
 * `retries: 0`. This suite is about what a browser does with a sandboxed
 * frame, a held control and two fingers, and every one of those is either
 * right or a bug. A retry that turns red into green throws away the finding.
 *
 * One worker. The harness serves one build of each subject and keeps one
 * request log per subject, and a parallel run would interleave two pages'
 * requests into one log.
 *
 * Chromium alone. The two-finger test drives `Input.dispatchTouchEvent`,
 * which is Chromium's own protocol, and there is no second way to put two
 * fingers on a page from a test. Whether a game computes the same numbers on
 * another engine is a question clockwork2 answers with its three-engine
 * sweep; it is not this suite's.
 */

import { defineConfig, devices } from "@playwright/test"
import { CONTROL_ORIGIN, hostOrigin } from "./src/env"

export default defineConfig({
  testDir: "./specs",
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI === "true",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter:
    process.env.CI === "true"
      ? "list"
      : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: hostOrigin("template"),
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Every subject, built and served by one process. It builds each game
    // through the real CLI first, so a stale `dist` cannot be what is served.
    command: "bun run src/harness-servers.ts",
    url: `${CONTROL_ORIGIN}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})

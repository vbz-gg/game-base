/**
 * What the command line said.
 *
 * Split out of the entry point because an entry point is excluded from the
 * coverage floor, and a default that quietly moved - which entry a game is
 * built from, which port it is served on - is the kind of thing a test has to
 * hold rather than a reader.
 */

import { resolve } from "node:path"
import { DEFAULT_FRAME_PORT, DEFAULT_HOST_PORT } from "../harness/index.js"

export const DEFAULT_SIM_ENTRY = "src/sim/index.ts"
export const DEFAULT_FRAME_ENTRY = "src/frame.ts"

export interface Options {
  readonly command: string
  readonly dir: string
  readonly simEntry: string
  readonly frameEntry: string
  readonly hostPort: number
  readonly framePort: number
}

export function parseArgs(argv: readonly string[]): Options {
  const positional: string[] = []
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    if (arg.startsWith("--")) {
      flags.set(arg.slice(2), argv[i + 1] ?? "")
      i += 1
    } else {
      positional.push(arg)
    }
  }
  return {
    command: positional[0] ?? "",
    dir: resolve(positional[1] ?? "."),
    simEntry: flags.get("sim") ?? DEFAULT_SIM_ENTRY,
    frameEntry: flags.get("frame") ?? DEFAULT_FRAME_ENTRY,
    hostPort: Number(flags.get("host") ?? DEFAULT_HOST_PORT),
    framePort: Number(flags.get("frame-port") ?? DEFAULT_FRAME_PORT),
  }
}

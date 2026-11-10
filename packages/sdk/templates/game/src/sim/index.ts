/**
 * The simulation bundle's entry. Two exports and nothing else:
 *
 *   - a default export the platform calls for a fresh module per session
 *   - `MANIFEST`, which the platform reads without running anything
 *
 * The conformance checker is pointed at this file, and it scans the import
 * graph transitively. It must not reach the renderer: a simulation that can
 * touch a canvas is a simulation that can decide a score from one.
 */

export { type Config, DEFAULT_CONFIG, LaneRunner, type View } from "./game"
export { MANIFEST } from "./manifest"

import { LaneRunner } from "./game"

export default function createGame(): LaneRunner {
  return new LaneRunner()
}

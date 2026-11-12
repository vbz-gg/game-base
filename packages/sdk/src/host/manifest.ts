/**
 * What a host reads from a game's manifest before it frames the game: which
 * controls to draw, and whether it can host the game at all.
 *
 * The platform has checked the manifest at upload, with the engine's
 * validator and the scheme table, so a published game passes all of this.
 * The host checks again because the harness frames games nobody has
 * uploaded, and because a page may be handed a manifest from anywhere.
 */

import type { Controls, Manifest } from "@clockwork2/engine/manifest"
import {
  type ControlScheme,
  isControlScheme,
  unknownSlots,
} from "../controls/index.js"
import { PlatformClientError } from "../platform/errors.js"

/**
 * The controls a host draws for a game: one of the manifest's three answers.
 *
 * `keyboard` is the field left out, which says the game needs a keyboard or
 * a mouse. A page can read it to tell a phone player before a run starts,
 * rather than framing a canvas they cannot steer.
 */
export type HostedControls =
  | {
      readonly mode: "scheme"
      readonly scheme: ControlScheme
      readonly bind: Readonly<Record<string, string>>
    }
  | { readonly mode: "custom" }
  | { readonly mode: "keyboard" }

/**
 * The controls `manifest` asks for, or a `PlatformClientError` when a host
 * cannot draw them: `E_SCHEME_UNDRAWABLE` for a scheme this SDK does not have
 * or a slot the scheme lacks, `E_SIM_PACKS` for a data pack the simulation
 * reads, and `E_MANIFEST_UNREADABLE` for anything that is not a manifest.
 *
 * A pack is refused for the reason the platform refuses one at upload: the
 * platform stores the simulation and the frame and nothing else, so a game
 * that reads a pack works nowhere it would be ranked. Refused here too, so
 * the harness shows an author before an upload does.
 */
export function hostedControls(manifest: unknown): HostedControls {
  if (typeof manifest !== "object" || manifest === null) {
    throw new PlatformClientError("E_MANIFEST_UNREADABLE")
  }
  const { inputs, assets } = manifest as Partial<Manifest>
  if (
    Array.isArray(assets) &&
    assets.some((asset) => asset?.requiredForSim === true)
  ) {
    throw new PlatformClientError("E_SIM_PACKS")
  }
  if (inputs !== undefined && (typeof inputs !== "object" || inputs === null)) {
    throw new PlatformClientError("E_MANIFEST_UNREADABLE")
  }
  const controls = inputs?.controls as Controls | null | undefined
  if (controls === undefined) return { mode: "keyboard" }
  if (typeof controls !== "object" || controls === null) {
    throw new PlatformClientError("E_MANIFEST_UNREADABLE")
  }
  if (controls.mode === "custom") return { mode: "custom" }
  if (
    controls.mode !== "scheme" ||
    typeof controls.scheme !== "string" ||
    !isControlScheme(controls.scheme) ||
    typeof controls.bind !== "object" ||
    controls.bind === null ||
    unknownSlots(controls.scheme, controls.bind).length > 0 ||
    // An action is a name the frame looks up; anything else is a press the
    // frame refuses or misreads.
    !Object.values(controls.bind).every((action) => typeof action === "string")
  ) {
    throw new PlatformClientError("E_SCHEME_UNDRAWABLE")
  }
  return { mode: "scheme", scheme: controls.scheme, bind: controls.bind }
}

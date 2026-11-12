/**
 * What a host reads from a manifest, and what it refuses before it frames
 * anything. A refusal here is one every host gives, so the harness shows an
 * author what the platform would refuse at upload.
 */

import { describe, expect, test } from "bun:test"
import { hostedControls } from "../../src/host/manifest"
import { PlatformClientError } from "../../src/platform/errors"

const codeOf = (manifest: unknown): string | undefined => {
  try {
    hostedControls(manifest)
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(PlatformClientError)
    return (error as PlatformClientError).code
  }
}

describe("the three answers a manifest can give", () => {
  test("a scheme, with the game's own binding", () => {
    expect(
      hostedControls({
        inputs: {
          controls: { mode: "scheme", scheme: "dpad", bind: { left: "west" } },
        },
      }),
    ).toEqual({ mode: "scheme", scheme: "dpad", bind: { left: "west" } })
  })

  test("custom, which the game draws itself", () => {
    expect(
      hostedControls({ inputs: { controls: { mode: "custom" } } }),
    ).toEqual({ mode: "custom" })
  })

  test("nothing, which says the game needs a keyboard", () => {
    expect(hostedControls({ inputs: {} })).toEqual({ mode: "keyboard" })
    expect(hostedControls({})).toEqual({ mode: "keyboard" })
  })
})

describe("what a host refuses", () => {
  test("a scheme this SDK does not draw, or a slot the scheme does not have", () => {
    // A dropped binding is a control the player never sees.
    for (const controls of [
      { mode: "scheme", scheme: "stick", bind: {} },
      { mode: "scheme", scheme: "dpad", bind: { jump: "jump" } },
      { mode: "scheme", scheme: "dpad", bind: null },
      { mode: "scheme", scheme: 7, bind: {} },
      // An action is a name the frame looks up.
      { mode: "scheme", scheme: "dpad", bind: { left: 7 } },
      { mode: "scheme", scheme: "dpad", bind: { left: null } },
      { mode: "wheel" },
    ]) {
      expect(codeOf({ inputs: { controls } })).toBe("E_SCHEME_UNDRAWABLE")
    }
  })

  test("a data pack the simulation reads, which the platform cannot replay", () => {
    expect(
      codeOf({
        assets: [{ path: "levels.bin", requiredForSim: true }],
        inputs: { controls: { mode: "custom" } },
      }),
    ).toBe("E_SIM_PACKS")
    // One only the frame reads, a texture, is not the replay's business.
    expect(
      hostedControls({
        assets: [{ path: "atlas.png", requiredForSim: false }],
        inputs: { controls: { mode: "custom" } },
      }),
    ).toEqual({ mode: "custom" })
  })

  test("anything that is not a manifest", () => {
    for (const manifest of [
      null,
      "lane-runner",
      7,
      { inputs: "keys" },
      { inputs: { controls: null } },
      { inputs: { controls: "dpad" } },
    ]) {
      expect(codeOf(manifest)).toBe("E_MANIFEST_UNREADABLE")
    }
  })
})

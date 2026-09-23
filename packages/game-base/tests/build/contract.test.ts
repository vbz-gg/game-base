import { describe, expect, test } from "bun:test"
import {
  assertFrameImportsOnlySim,
  assertRewritten,
  assertSimSelfContained,
  assertSize,
  countQuoted,
  decodeArtifact,
  rewriteSimImport,
  simPathFor,
} from "../../src/build/contract"
import { BuildRefusal } from "../../src/build/errors"

const HASH = "a".repeat(64)
const SIM_PATH = simPathFor(HASH)

function code(refusal: () => unknown): string {
  try {
    refusal()
  } catch (error) {
    if (error instanceof BuildRefusal) return error.code
    throw error
  }
  throw new Error("nothing was refused")
}

describe("decoding an artifact", () => {
  /**
   * A module the browser reads as UTF-8 and the hasher hashes as bytes has to
   * be the same document. Without `fatal` a bad byte becomes a replacement
   * character nobody notices until the game misbehaves.
   */
  test("bytes that are not UTF-8 are refused rather than repaired", () => {
    const bad = new Uint8Array([0xff, 0xfe, 0xfd])
    expect(code(() => decodeArtifact(bad, "simulation"))).toBe(
      "E_ARTIFACT_NOT_UTF8",
    )
  })

  test("ordinary source decodes", () => {
    const bytes = new TextEncoder().encode("export const a = 1")
    expect(decodeArtifact(bytes, "simulation")).toBe("export const a = 1")
  })
})

describe("size", () => {
  test("over the cap is refused, at the cap is not", () => {
    expect(code(() => assertSize(new Uint8Array(11), 10, "frame"))).toBe(
      "E_ARTIFACT_TOO_LARGE",
    )
    expect(() => assertSize(new Uint8Array(10), 10, "frame")).not.toThrow()
  })
})

describe("the simulation is self-contained", () => {
  /**
   * It replays in an isolate with no outbound network, so an import there is
   * a guaranteed fault on every session the version ever serves rather than a
   * slow path.
   */
  test("any import at all is refused", () => {
    expect(
      code(() => assertSimSelfContained(`import x from "./other"\nexport {}`)),
    ).toBe("E_SIM_NOT_SELF_CONTAINED")
  })

  test("a simulation that imports nothing passes", () => {
    expect(() =>
      assertSimSelfContained("export const MANIFEST = {}"),
    ).not.toThrow()
  })
})

describe("the frame imports the simulation and nothing else", () => {
  /**
   * The frame carrying its own copy of the simulation is the whole thing this
   * contract exists to prevent, and it is the one case every other check
   * passes.
   */
  test("a frame with no import is refused", () => {
    expect(code(() => assertFrameImportsOnlySim("console.log(1)"))).toBe(
      "E_FRAME_IMPORT_MISSING",
    )
  })

  test("a frame importing anything else is refused", () => {
    expect(
      code(() =>
        assertFrameImportsOnlySim(
          `import a from "cw2:sim"\nimport b from "pixi.js"`,
        ),
      ),
    ).toBe("E_FRAME_IMPORT_UNEXPECTED")
  })

  /** A dynamic import chooses its module at runtime, past a static scan. */
  test("a dynamic import is refused", () => {
    expect(
      code(() =>
        assertFrameImportsOnlySim(`const m = await import("cw2:sim")`),
      ),
    ).toBe("E_FRAME_DYNAMIC_IMPORT")
  })

  /**
   * The check that earns the text rewrite. If the quoted specifier appears
   * more often than the scanner found imports, the string is also data, and
   * replacing it would change a value the game reads.
   */
  test("the specifier appearing as data is refused, not rewritten", () => {
    expect(
      code(() =>
        assertFrameImportsOnlySim(
          `import a from "cw2:sim"\nconst label = "cw2:sim"`,
        ),
      ),
    ).toBe("E_FRAME_SPECIFIER_AMBIGUOUS")
  })

  test("a conforming frame reports how many imports it has", () => {
    expect(assertFrameImportsOnlySim(`import a from "cw2:sim"`)).toBe(1)
  })

  test("counting a quoted literal sees both quote styles", () => {
    expect(countQuoted(`"cw2:sim" and 'cw2:sim'`, "cw2:sim")).toBe(2)
    expect(countQuoted("cw2:sim unquoted", "cw2:sim")).toBe(0)
  })
})

describe("rewriting the simulation import", () => {
  test("the specifier becomes the content address", () => {
    const out = rewriteSimImport(`import a from "cw2:sim"`, SIM_PATH)
    expect(out).toBe(`import a from "${SIM_PATH}"`)
  })

  /**
   * Two imports of the one specifier both have to move. A `replace` instead
   * of `replaceAll` leaves a second unresolvable specifier that throws in the
   * browser and nowhere else.
   */
  test("every occurrence moves, not just the first", () => {
    const out = rewriteSimImport(
      `import a from "cw2:sim"\nimport {b} from "cw2:sim"`,
      SIM_PATH,
    )
    expect(out).not.toContain("cw2:sim")
    expect(countQuoted(out, SIM_PATH)).toBe(2)
  })

  test("a single-quoted import moves too", () => {
    const out = rewriteSimImport(`import a from 'cw2:sim'`, SIM_PATH)
    expect(out).toContain(SIM_PATH)
  })

  /**
   * The path is built from a hash the caller computed. Taking one from a
   * submission would let a bundle name some other module entirely.
   */
  test("a path that is not a content address is refused", () => {
    for (const path of [
      "https://elsewhere.invalid/sim.js",
      "/sim/short.js",
      `/frame/${HASH}.js`,
      `/sim/${HASH.toUpperCase()}.js`,
    ]) {
      expect(
        code(() => rewriteSimImport(`import a from "cw2:sim"`, path)),
      ).toBe("E_REWRITE_FAILED")
    }
  })

  test("a content address is root-relative, so the bytes carry no domain", () => {
    expect(simPathFor(HASH)).toBe(`/sim/${HASH}.js`)
    expect(simPathFor(HASH).startsWith("/")).toBe(true)
  })

  /** The rewrite is re-scanned, so the transform is verified not trusted. */
  test("a frame that could not be rewritten is refused", () => {
    expect(
      code(() => rewriteSimImport("export const nothing = 1", SIM_PATH)),
    ).toBe("E_FRAME_IMPORT_MISSING")
  })
})

describe("verifying the rewrite", () => {
  /**
   * Unreachable through `rewriteSimImport`: by the time it runs the input has
   * passed the scan, the path has matched `SIM_PATH`, and swapping one quoted
   * literal for another cannot change how many imports a module has. Called
   * directly it is testable, which is the only way this guard is ever seen to
   * work - and the next person to change the replacement is who it is for.
   */
  test("a result with the wrong import count is refused", () => {
    expect(
      code(() => assertRewritten(`import a from "${SIM_PATH}"`, SIM_PATH, 2)),
    ).toBe("E_REWRITE_FAILED")
  })

  test("a result naming some other module is refused", () => {
    expect(
      code(() => assertRewritten(`import a from "/sim/other.js"`, SIM_PATH, 1)),
    ).toBe("E_REWRITE_FAILED")
  })

  test("a result whose import became dynamic is refused", () => {
    expect(
      code(() =>
        assertRewritten(`const m = await import("${SIM_PATH}")`, SIM_PATH, 1),
      ),
    ).toBe("E_REWRITE_FAILED")
  })

  test("a result importing nothing at all is refused", () => {
    expect(code(() => assertRewritten("export const a = 1", SIM_PATH, 1))).toBe(
      "E_REWRITE_FAILED",
    )
  })

  test("what the rewrite actually produces passes", () => {
    expect(() =>
      assertRewritten(`import a from "${SIM_PATH}"`, SIM_PATH, 1),
    ).not.toThrow()
  })
})

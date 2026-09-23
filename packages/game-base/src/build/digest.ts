/**
 * The content address of an artifact.
 *
 * Lowercase hex of the SHA-256 of the bytes. The key a blob is stored under is
 * the digest of its own body, so a store is idempotent by construction and a
 * retry reuses what is already there.
 */

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
}

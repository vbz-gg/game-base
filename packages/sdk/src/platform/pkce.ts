/**
 * The values a sign-in sends: a verifier the page keeps, the S256 challenge
 * the window sees, and a state that ties the answer to this request (RFC 7636).
 */

export function base64url(bytes: Uint8Array): string {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export interface Pkce {
  /** 43 characters: 32 random bytes. */
  readonly verifier: string
  /** 22 characters: 16 random bytes. */
  readonly state: string
  /** The base64url SHA-256 of the verifier, with no padding: 43 characters. */
  readonly challenge: string
}

export async function makePkce(
  crypto: Pick<Crypto, "getRandomValues" | "subtle">,
): Promise<Pkce> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  )
  return { verifier, state, challenge: base64url(new Uint8Array(digest)) }
}

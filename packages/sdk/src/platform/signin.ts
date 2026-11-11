/**
 * Asking the sign-in window for a one-time code.
 *
 * OAuth's authorization code with PKCE, handed back by `postMessage` rather
 * than a redirect. The window is opened before anything is awaited, because a
 * browser opens one only in the same turn as the click that asked for it.
 */

import type { PageKey } from "../api/index.js"
import type { MessageLike, PageEnvironment } from "./environment.js"
import { PlatformClientError } from "./errors.js"
import { makePkce } from "./pkce.js"

/** How often a closed window is noticed. A browser fires no event for it. */
export const CLOSED_POLL_MS = 250
/**
 * How long to keep listening after the window reports closed. It closes
 * itself right after posting the code, and a browser can report the close
 * before it delivers the message.
 */
export const CLOSED_GRACE_MS = 500

export const SIGN_IN_FEATURES = "popup,width=480,height=680"

/** What the window hands back: a code to trade, and the verifier that answers it. */
export interface SignInGrant {
  readonly code: string
  readonly verifier: string
}

export async function requestSignInCode(options: {
  readonly environment: PageEnvironment
  readonly signInOrigin: string
  readonly pageKey: PageKey
}): Promise<SignInGrant> {
  const { environment, signInOrigin } = options
  // First, before any await: only the click's own turn may open a window.
  const popup = environment.open("about:blank", "vbz-signin", SIGN_IN_FEATURES)
  if (popup === null) throw new PlatformClientError("E_POPUP_BLOCKED")

  let pkce: Awaited<ReturnType<typeof makePkce>>
  try {
    pkce = await makePkce(environment.crypto)
  } catch (error) {
    popup.close()
    throw error
  }
  const query = new URLSearchParams({
    client_id: options.pageKey,
    redirect_uri: environment.origin,
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  })
  popup.location.href = `${signInOrigin}/authorize?${query}`

  const code = await new Promise<string>((resolve, reject) => {
    let grace: unknown
    const finish = () => {
      environment.removeMessageListener(listen)
      environment.clearInterval(watch)
      if (grace !== undefined) environment.clearTimeout(grace)
    }
    const listen = (event: MessageLike) => {
      // Pages get messages from extensions and other frames too.
      if (event.origin !== signInOrigin || event.source !== popup) return
      const data = event.data as {
        readonly type?: unknown
        readonly state?: unknown
        readonly code?: unknown
      } | null
      if (data?.type !== "vbz.signin" || data.state !== pkce.state) return
      if (typeof data.code !== "string") return
      finish()
      resolve(data.code)
    }
    const watch = environment.setInterval(() => {
      if (!popup.closed || grace !== undefined) return
      grace = environment.setTimeout(() => {
        finish()
        reject(new PlatformClientError("E_SIGNIN_CLOSED"))
      }, CLOSED_GRACE_MS)
    }, CLOSED_POLL_MS)
    environment.addMessageListener(listen)
  })

  return { code, verifier: pkce.verifier }
}

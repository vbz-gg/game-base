/**
 * One function for every request a page makes, keyed by the route table.
 *
 * The route is named the way `PlatformRoutes` names it, so a route the
 * platform does not declare does not compile, its path parameters and its
 * body are the ones the table gives, and the answer is typed by the table.
 * Only the page's routes are offered: a secret key's routes are for a build
 * system and never belong in a page.
 */

import type {
  ApiErrorBody,
  PageKey,
  PageKeyHeader,
  PlatformRoute,
  PlatformRoutes,
  PublicRefusalCode,
} from "../api/index.js"
import { PlatformClientError, PlatformRefusal } from "./errors.js"

/** The routes a page calls: every route but a secret key's. */
export type PageRoute = {
  [Route in PlatformRoute]: PlatformRoutes[Route]["auth"] extends "secret-key"
    ? never
    : Route
}[PlatformRoute]

type PathOf<Route extends string> = Route extends `${string} ${infer Path}`
  ? Path
  : never

type ParamNames<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}`
    ? Name | ParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Name}`
      ? Name
      : never

type ParamsOf<Route extends PageRoute> = [ParamNames<PathOf<Route>>] extends [
  never,
]
  ? { readonly params?: never }
  : { readonly params: Readonly<Record<ParamNames<PathOf<Route>>, string>> }

type BodyOf<Route extends PageRoute> = [PlatformRoutes[Route]["body"]] extends [
  never,
]
  ? { readonly body?: never }
  : { readonly body: PlatformRoutes[Route]["body"] }

export type RequestOptions<Route extends PageRoute> = ParamsOf<Route> &
  BodyOf<Route> & {
    /** The player's token, sent as `Authorization: Bearer`. */
    readonly token?: string | undefined
    readonly query?: Readonly<Record<string, string | number | undefined>>
  }

export type Requester = <Route extends PageRoute>(
  route: Route,
  options: RequestOptions<Route>,
) => Promise<PlatformRoutes[Route]["response"]>

export interface RequesterOptions {
  readonly apiOrigin: string
  readonly pageKey: PageKey
  readonly fetch: typeof fetch
}

const PAGE_KEY_HEADER: PageKeyHeader = "x-vbz-key"

export function createRequester(options: RequesterOptions): Requester {
  return async (route, request) => {
    const space = route.indexOf(" ")
    const method = route.slice(0, space)
    const template = route.slice(space + 1)
    const params = (request.params ?? {}) as Readonly<Record<string, string>>
    const path = template.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
      const value = params[name]
      if (value === undefined) {
        throw new Error(`${route} needs the path parameter ${name}`)
      }
      return encodeURIComponent(value)
    })

    const url = new URL(`${options.apiOrigin}${path}`)
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value))
    }

    const headers: Record<string, string> = {}
    // The code trade reads the page key from its body, as `clientId`.
    if (route !== "POST /v1/oauth/token") {
      headers[PAGE_KEY_HEADER] = options.pageKey
    }
    if (request.token !== undefined) {
      headers.authorization = `Bearer ${request.token}`
    }
    if (request.body !== undefined) headers["content-type"] = "application/json"

    let response: Response
    try {
      // No `credentials`: the platform reads no cookie and sets none.
      response = await options.fetch(url.toString(), {
        method,
        headers,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
      })
    } catch (error) {
      throw new PlatformClientError("E_UNREACHABLE", { cause: error })
    }

    let answer: unknown
    try {
      answer = await response.json()
    } catch (error) {
      throw new PlatformClientError("E_ANSWER_UNREADABLE", {
        status: response.status,
        cause: error,
      })
    }
    if (response.ok) return answer as never
    if (!isErrorBody(answer)) {
      throw new PlatformClientError("E_ANSWER_UNREADABLE", {
        status: response.status,
      })
    }
    throw new PlatformRefusal(response.status, {
      error: answer.error as PublicRefusalCode,
      message: answer.message,
      ...(answer.detail === undefined ? {} : { detail: answer.detail }),
    })
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false
  const body = value as Partial<ApiErrorBody>
  return typeof body.error === "string" && typeof body.message === "string"
}

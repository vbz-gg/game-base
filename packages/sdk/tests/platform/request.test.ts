/**
 * Every request a page makes, as the platform's page guide describes it.
 */

import { describe, expect, test } from "bun:test"
import {
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "../../src/platform/errors"
import { createRequester } from "../../src/platform/request"
import { FakePage } from "./fake-page"

const API = "https://api.vbz.example"
const KEY = "vbz_pk_abc" as const

function requester(page = new FakePage()) {
  return {
    page,
    request: createRequester({
      apiOrigin: API,
      pageKey: KEY,
      fetch: page.fetch,
    }),
  }
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("expected a failure")
}

describe("what a request carries", () => {
  test("the page key, and no cookie, on a page route", async () => {
    const { page, request } = requester()
    page.answers.push({ status: 200, body: { day: "2026-11-11" } })
    await request("GET /v1/game", {})
    const [sent] = page.sent
    expect(sent?.url.toString()).toBe(`${API}/v1/game`)
    expect(sent?.method).toBe("GET")
    expect(sent?.headers).toEqual({ "x-vbz-key": KEY })
    expect(sent?.credentials).toBeUndefined()
  })

  test("the player's token, a JSON body and its id in the path", async () => {
    const { page, request } = requester()
    page.answers.push({ status: 202, body: { seq: 0, throughTick: 5 } })
    const chunk = { seq: 0, throughTick: 5, checkpoints: [], inputs: [] }
    await request("POST /v1/runs/:id/chunks", {
      params: { id: "a/b" },
      body: chunk,
      token: "t-1",
    })
    const [sent] = page.sent
    // Encoded, so an id cannot reach another route.
    expect(sent?.url.pathname).toBe("/v1/runs/a%2Fb/chunks")
    expect(sent?.headers).toEqual({
      "x-vbz-key": KEY,
      authorization: "Bearer t-1",
      "content-type": "application/json",
    })
    expect(sent?.body).toEqual(chunk)
  })

  test("the code trade carries the key in its body, not in a header", async () => {
    const { page, request } = requester()
    page.answers.push({ status: 200, body: {} })
    await request("POST /v1/oauth/token", {
      body: { code: "c", codeVerifier: "v", clientId: KEY },
    })
    expect(page.sent[0]?.headers).toEqual({
      "content-type": "application/json",
    })
  })

  test("a query leaves out what is not set", async () => {
    const { page, request } = requester()
    page.answers.push({ status: 200, body: {} })
    await request("GET /v1/board", {
      query: { period: "week", limit: undefined },
    })
    expect(page.sent[0]?.url.search).toBe("?period=week")
  })

  test("a secret key's routes are not offered to a page", () => {
    const { request } = requester()
    // @ts-expect-error: the upload is a build system's, never a page's.
    void (() => request("POST /v1/games/:gameId/versions", {}))
  })
})

describe("what comes back", () => {
  test("a refusal arrives as the platform's code, status, message and detail", async () => {
    const { page, request } = requester()
    page.answers.push({
      status: 429,
      body: {
        error: "E_RANKED_RUNS_USED",
        message: "you have started every ranked run this game allows today",
        detail: { day: "2026-11-11" },
      },
    })
    const error = await caught(() =>
      request("POST /v1/runs", { body: {}, token: "t" }),
    )
    expect(error).toBeInstanceOf(PlatformRefusal)
    const refusal = error as PlatformRefusal
    expect(refusal.code).toBe("E_RANKED_RUNS_USED")
    expect(refusal.status).toBe(429)
    expect(refusal.message).toBe(
      "you have started every ranked run this game allows today",
    )
    expect(refusal.detail).toEqual({ day: "2026-11-11" })
  })

  test("no answer at all is E_UNREACHABLE, which is not a refusal", async () => {
    const { page, request } = requester()
    page.answers.push({ unreachable: true })
    const error = await caught(() => request("GET /v1/game", {}))
    expect((error as PlatformClientError).code).toBe("E_UNREACHABLE")
  })

  test("an answer that is not JSON, or a failure with no code, is E_ANSWER_UNREADABLE", async () => {
    const { page, request } = requester()
    page.answers.push({ status: 502, text: "<html>bad gateway</html>" })
    page.answers.push({ status: 500, body: { oops: true } })
    for (const status of [502, 500]) {
      const error = (await caught(() =>
        request("GET /v1/game", {}),
      )) as PlatformClientError
      expect(error.code).toBe("E_ANSWER_UNREADABLE")
      expect(error.status).toBe(status)
    }
  })

  test("a route missing a path parameter is a bug in the caller", async () => {
    const { request } = requester()
    const error = await caught(() =>
      request("GET /v1/runs/:id", { params: {} as { id: string } }),
    )
    expect(String(error)).toContain("needs the path parameter id")
  })
})

describe("what is worth sending again", () => {
  test("no answer, the platform's own failure, and a proxy's failure page", () => {
    expect(worthRetrying(new PlatformClientError("E_UNREACHABLE"))).toBe(true)
    expect(
      worthRetrying(
        new PlatformRefusal(500, { error: "E_INTERNAL", message: "x" }),
      ),
    ).toBe(true)
    // A load balancer's 503 page during a deploy is not JSON.
    expect(
      worthRetrying(
        new PlatformClientError("E_ANSWER_UNREADABLE", { status: 503 }),
      ),
    ).toBe(true)
  })

  test("not a refusal, an unreadable success, or anything else", () => {
    expect(
      worthRetrying(
        new PlatformRefusal(409, { error: "E_CHUNK_CONFLICT", message: "x" }),
      ),
    ).toBe(false)
    expect(
      worthRetrying(
        new PlatformClientError("E_ANSWER_UNREADABLE", { status: 200 }),
      ),
    ).toBe(false)
    expect(worthRetrying(new PlatformClientError("E_ANSWER_UNREADABLE"))).toBe(
      false,
    )
    expect(worthRetrying(new PlatformClientError("E_WRONG_GAME"))).toBe(false)
    expect(worthRetrying(new TypeError("a bug"))).toBe(false)
  })
})

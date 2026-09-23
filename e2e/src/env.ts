/**
 * The ports the suite runs on, in one place.
 *
 * Two per subject, because the harness is two servers and the whole point of
 * it is that they are two origins. Fixed rather than port 0: Playwright's
 * `webServer` waits on a URL it was given before any test runs, so the ports
 * have to be knowable before the process that binds them exists.
 */

export const CONTROL_PORT = 4319

/**
 * The games this suite drives, and why each one is here.
 *
 * `template` declares a scheme, so the host draws its pad. `paddle` declares
 * `{ mode: "custom" }`, so the host draws nothing and the game hit-tests
 * pointers itself. Between them they are the two answers a game can give, and
 * a browser is the only place the difference is visible.
 */
export const SUBJECTS = {
  template: { dir: ["templates", "game"], hostPort: 4320, framePort: 4321 },
  paddle: { dir: ["fixtures", "paddle"], hostPort: 4322, framePort: 4323 },
} as const

export type SubjectName = keyof typeof SUBJECTS

export const CONTROL_ORIGIN = `http://127.0.0.1:${CONTROL_PORT}`

export function hostOrigin(name: SubjectName): string {
  return `http://127.0.0.1:${SUBJECTS[name].hostPort}`
}

export function frameOrigin(name: SubjectName): string {
  return `http://127.0.0.1:${SUBJECTS[name].framePort}`
}

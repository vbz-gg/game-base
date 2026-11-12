/**
 * Hosting a game on a page: the frame, its controls, a platform run through
 * them, and the two widgets a game's page needs.
 *
 * Plain modules with no DOM at load time, like `/platform`, so a page may
 * import this while rendering on a server. It imports the engine's parent
 * bridge, which the frame needs, and nothing the CLI or the harness uses.
 */

export {
  type Host,
  type HostHandlers,
  type HostOptions,
  mountHost,
} from "./host.js"
export { type HostedControls, hostedControls } from "./manifest.js"
export { type PlayedRun, type PlayOptions, playRun } from "./play.js"
export {
  type BoardWidgetOptions,
  type MountedBoard,
  type MountedSignIn,
  type MountedWidget,
  mountBoard,
  mountSignIn,
  type SignInOptions,
} from "./widgets.js"

/**
 * On-screen controls the host draws.
 *
 * Importing this subpath pulls the scheme table and a DOM renderer and
 * nothing else: the package is `sideEffects: false` and this half reaches no
 * node built-in, because the arcade's shell imports it into a browser bundle.
 */

export {
  type ControlsOptions,
  MIN_TOUCH_PX,
  type MountedControls,
  mountControls,
} from "./render.js"
export {
  boundSlots,
  CONTROL_SCHEMES,
  type ControlScheme,
  isControlScheme,
  SCHEMES,
  type Scheme,
  type SchemeSlot,
  unknownSlots,
} from "./schemes.js"

/**
 * Serving a game the way a platform serves it.
 *
 * The frame document, its Content-Security-Policy and the routes its two
 * artifacts are fetched from. The harness serves a laptop from this code and
 * the platform serves production from it, so a game meets the same sandbox
 * and the same CSP in both.
 */

export {
  BLOB_CACHE_CONTROL,
  BLOB_PATH,
  type BlobReader,
  createBlobServer,
  JS_CONTENT_TYPE,
} from "./blobs.js"
export {
  escapeHtml,
  type FrameDocumentInput,
  frameCsp,
  frameDocument,
} from "./document.js"

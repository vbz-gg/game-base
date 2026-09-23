/**
 * Serving a game the way a platform serves it.
 *
 * The frame document, its Content-Security-Policy and the routes its two
 * artifacts are fetched from. The arcade serves production from this code and
 * the harness serves a laptop from it, so a game meets the same sandbox, the
 * same CSP and the same CORS behaviour in both.
 */

export {
  BLOB_CACHE_CONTROL,
  BLOB_PATH,
  type BlobReader,
  createBlobServer,
  JS_CONTENT_TYPE,
} from "./blobs"
export {
  escapeHtml,
  type FrameDocumentInput,
  frameCsp,
  frameDocument,
} from "./document"

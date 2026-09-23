/**
 * The harness page, shaped like the arcade's play view.
 *
 * The game gets the whole viewport, one floating mark sits over it, and the
 * controls are drawn on top. The picker and the status line are the two
 * things the arcade does not have: an author needs to switch schemes without
 * editing a manifest, and needs to see what the bridge is saying.
 *
 * The config travels in a JSON script block rather than in the URL, so a seed
 * does not end up in a referrer or a server log, and the page's own script is
 * an ordinary module with no inline code.
 */

import { escapeHtml } from "../../serve"

export interface HarnessPageInput {
  readonly title: string
  readonly config: unknown
}

export function harnessPage(input: HarnessPageInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --gb-control-bg: rgba(28, 31, 38, 0.86);
        --gb-control-fg: #ecedf0;
        --gb-control-border: 1px solid #3a3d46;
      }
      html, body { margin: 0; height: 100%; background: #0d0e11; color: #ecedf0;
        font: 14px system-ui, sans-serif; }
      /* The stage is the positioning context the controls fill, and it is the
         whole viewport, as the play view is. */
      #stage { position: fixed; inset: 0; }
      #stage iframe { display: block; border: 0; width: 100%; height: 100%; }
      #mark { position: fixed; top: max(16px, env(safe-area-inset-top));
        left: max(16px, env(safe-area-inset-left)); z-index: 3;
        font-weight: 600; letter-spacing: 0.08em; opacity: 0.7; }
      #bar { position: fixed; top: max(12px, env(safe-area-inset-top));
        right: max(12px, env(safe-area-inset-right)); z-index: 3;
        display: flex; gap: 8px; align-items: center; }
      #bar select, #bar button { background: #191b20; color: #ecedf0;
        border: 1px solid #3a3d46; border-radius: 8px; padding: 6px 10px;
        font: inherit; }
      #status { opacity: 0.6; }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <div id="mark">vbz</div>
    <div id="bar">
      <span id="status">starting</span>
      <select id="picker" aria-label="Control scheme"></select>
      <button id="start" type="button">Start</button>
    </div>
    <script type="application/json" id="harness-config">${escapeJson(
      input.config,
    )}</script>
    <script type="module" src="/harness.js"></script>
  </body>
</html>
`
}

/**
 * JSON safe to sit inside a script element.
 *
 * `</script>` anywhere in the data would end the block early and put the rest
 * of the config into the document as markup. Escaping the slash keeps it
 * valid JSON and stops the parser seeing a closing tag.
 */
function escapeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("</", "<\\/")
}

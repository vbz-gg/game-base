# The harness

`game-base dev ./my-game` is the arcade's play view on a laptop. It builds the
two real artifacts, serves them behind the real frame document with the real
sandbox and CSP on one port, and serves the page that frames them on another.

```
http://127.0.0.1:4310   the page that frames the game
http://127.0.0.1:4311   the game, its document and its two artifacts
```

Two ports are two origins, which is the point: a sandboxed cross-origin frame
has traps, and meeting them on a laptop is cheaper than meeting them in an
upload.

## What the frame is

The document carries a `Content-Security-Policy` that leads with
`sandbox allow-scripts allow-pointer-lock`. As a header rather than an iframe
attribute it is a property of the document however it was loaded, so opening
the game's URL straight out of devtools is still sandboxed. The rest is
`default-src 'none'` with the few sources a game needs, `connect-src 'none'`,
and a `frame-ancestors` naming the one page allowed to frame it.

Without `allow-same-origin` the frame sits in an **opaque origin**, which is
same-origin with nothing: no cookies, no storage, no reach into the page. It
also means every script the frame fetches, including its own from the host
that served its document, is a cross-origin request - which is why the
artifacts are served with `Access-Control-Allow-Origin: *`. A server answering
with its own origin never matches `null`, and the frame then loads nothing,
posts no `ready`, and shows a blank game with no error anywhere.

## What the page gives you

- **The pad your manifest asked for**, drawn by the same code the arcade
  draws it with.
- **A picker** that switches between every scheme, `custom` and `off` without
  editing the manifest. Under a scheme your game did not declare, the slots you
  did not bind are bound to their own names, so the layout is visible and
  plainly inert.
- **Start and End.** End stops the run where it stands, which is how to get a
  recording out of a game you do not intend to lose at.
- **The recording**, published once every chunk of it has arrived, with a link
  to save it. It is the same envelope the arcade would replay.
- **A status line** carrying what the bridge is saying: `ready`, the tick
  count, how the run ended and what it scored.

The seed is a constant, so the run you are debugging is the run you had a
moment ago. The arcade's is a keyed HMAC of the day, which does the same job
for everybody at once.

## What it does not reproduce

- **The second registrable domain.** Production serves frames from a different
  site so a game cannot set a cookie for the platform. Two ports on localhost
  are one site. Cookie scope is not something a game can get wrong from inside
  a sandbox, so this gap is named rather than closed.
- **Replay, settlement and ranking.** That half is the arcade's, and a harness
  that pretended to do it would be teaching you about a server that does not
  exist.
- **The conformance suite and the cross-engine sweep.** Use the platform-game
  skill's `validate` for the first; the second needs three browsers installed
  and runs at ingest.

## A phone

Use a device emulation at phone width, or a phone on the same network. The pad
is drawn **over** the game, in the letterbox margin where a declared aspect
leaves one and over the art where it does not, so check that nothing the player
needs to read lives in the bottom corners.

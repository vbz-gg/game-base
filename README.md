# vbz.gg SDK

The SDK for building games that run on [vbz.gg](https://vbz.gg), the backend
that checks and ranks the scores of a game studio's games.

A game on vbz.gg is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation, so its score is something a server can check rather than trust: the
browser records what the player pressed, the server replays that log, and the
server's answer is the one that counts. This repository is what sits between
that engine, the vbz.gg platform and the page a studio serves its game from.

It publishes one package, `@vbz-gg/sdk`, which carries:

- **the on-screen control schemes**, and the renderer that draws them, so the
  pad you test against is the pad a player gets
- **a page's client and host**, which sign a player in, frame the game, play a
  run against the platform and show the board
- **the build**, which turns a game into the two artifacts an upload carries
- **a harness**, which frames your game locally the way it runs in production:
  two origins, the sandbox, the CSP and a full-viewport page

Versions up to 0.2.0 were published as `@vbz-gg/game-base`, from a
repository of that name, and the command was `game-base`. Later versions are
`@vbz-gg/sdk`, and the command is `vbz`.

What a game author does with it is in
[`packages/sdk/README.md`](packages/sdk/README.md), and
[`docs/sdk.md`](docs/sdk.md) explains how the whole thing works.

## Layout

```
packages/sdk/            the published package
packages/sdk/templates/  a game to copy and start from, shipped with it
skill/vbz-game/          the agent skill for building one
docs/sdk.md              how it works, from first principles
fixtures/paddle/         a small game that draws its own controls
e2e/                     the browser suite, driving the harness for real
scripts/                 this repository's own tooling
```

## Commands

```bash
bun install
bun run build          # tsc -b over project references
bun run typecheck
bun run lint           # biome check .
bun run lint:fix
bun test               # the unit suite
bun run test:coverage  # the same tests, then the 99% floor over packages/*/src
bun run test:e2e       # the browser suite: a real sandboxed frame, a real pad
bun run check:publishable   # pack the package and read what a consumer gets
```

A release is one dispatch of `release.yml`, which bumps, publishes and tags.
`engine-update.yml` opens a pull request when clockwork2 publishes a new
engine. Both are in [`AGENTS.md`](AGENTS.md).

## License

MIT

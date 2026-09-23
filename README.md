# game-base

The SDK for building games the [vbz](https://vbz.gg) arcade can run.

A game on the arcade is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation, so its score is something a server can check rather than trust: the
browser records what the player pressed, the server replays that log, and the
server's answer is the one that counts. This repository is what sits between
that engine and the arcade.

It publishes one package, `@vbz-gg/game-base`, which carries:

- **the on-screen control schemes**, and the renderer that draws them, so the
  pad you test against is the pad a player gets
- **the build**, which turns a game into the two artifacts an upload carries
- **a harness**, which frames your game locally the way the arcade does: two
  origins, the sandbox, the CSP and the full-viewport play view

What a game author does with it is in
[`packages/game-base/README.md`](packages/game-base/README.md).

## Layout

```
packages/game-base/   the published package
scripts/              this repository's own tooling
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
bun run check:publishable   # pack the package and read what a consumer gets
```

## License

MIT

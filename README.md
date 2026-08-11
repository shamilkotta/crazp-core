# @crazp/core

Private implementation package for Crazp.

`@crazp/core` contains the framework build pipeline and CLI used by Crazp projects. Application code should usually depend on the public `crazp` package for authoring agents, tools, subagents, and config.

## Install

This package is intended to be published as a private npm package:

```bash
pnpm add @crazp/core
```

## Usage

Build a Crazp project from an `agent/` directory:

```bash
crazp build
```

Programmatic build API:

```ts
import { buildCrazpProject } from "@crazp/core/build";

await buildCrazpProject({
  projectRoot: process.cwd(),
  agentDir: "agent",
  outDir: "dist"
});
```

## Package Contents

- `@crazp/core/build` exposes the build API.
- `crazp` is the CLI entrypoint.
- `dist/` contains the compiled package output.

## Development

```bash
pnpm --filter @crazp/core build
pnpm --filter @crazp/core typecheck
pnpm --filter @crazp/core lint
pnpm --filter @crazp/core format:check
```

## Publishing

This package is configured for restricted npm publishing:

```bash
pnpm --filter @crazp/core publish --access restricted
```

The `prepublishOnly` script builds the package before publishing.

## License

MIT

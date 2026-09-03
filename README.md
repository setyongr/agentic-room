# AgenticRoom

A 3D room planner for people and browser agents. Arrange furniture, compare
options, and work within a budget. WebMCP tools let a compatible agent edit
the same room you see on screen.

Built with Next.js, React, TypeScript, React Three Fiber, and Zustand.

## Getting started

Requires [Bun](https://bun.sh) 1.3.14 and Node.js 20.9 or later.
No API keys, database, or environment variables are required.

```bash
bun install --frozen-lockfile
bun run dev
```

Open [localhost:3000](http://localhost:3000). The initial room includes existing
furniture and a $700 budget for new pieces.

## Features

- Furnish and resize a 3D room, with checks for overlap and opening clearance.
- Browse furniture, change finishes, and compare lower-cost alternatives.
- Track new purchases separately from furniture you already own.
- Save designs within a session and collect items in a simulated cart.
- Let a browser agent inspect and edit the room through 22 WebMCP tools.

The planner works without an agent. WebMCP requires a supporting browser;
see the [integration guide](docs/WEBMCP.md) for setup and tool details.

## Development

```bash
bun run check       # TypeScript
bun run test        # Domain tests
bun run build       # Production build
bun run start       # Serve the production build
```

For static hosting, use `bun run build:sites`. See [deployment](docs/DEPLOYMENT.md)
for build settings and access requirements.

## Limitations

Designs and uploads are session-only; reloading resets the room. Catalog prices
and the cart are demonstrations, with no checkout or payment processing.
The 3D scene is approximate, not a guarantee of physical fit.

Imported GLBs are visual references, excluded from pricing, layout validation,
and saved designs. They are visible in scene snapshots shared with a connected
agent. No AI service is built into the app.

## Documentation

- [WebMCP](docs/WEBMCP.md): browser setup, tools, and response formats
- [Demo workflows](docs/DEMOS.md): room furnishing and budget reduction
- [Architecture](docs/ARCHITECTURE.md): state, domain rules, and rendering
- [Testing](docs/TESTING.md): automated coverage and manual checks
- [Deployment](docs/DEPLOYMENT.md): hosting and public-release checks
- [Contributing](AGENTS.md): repository conventions

## License

[MIT](LICENSE). The bundled sofa model and its preview have separate
[CC BY 4.0 attribution](THIRD_PARTY_NOTICES.md).

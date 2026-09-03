# Deployment

AgenticRoom runs entirely in the browser. It needs no application backend,
database, API keys, or environment variables. Room data resets on reload.

Current deployment: [AgenticRoom](https://agenticroom.setyongr.chatgpt.site).
Access was owner-only when checked on September 3, 2026; verify access before
sharing it with other users.

## Build options

Use Bun 1.3.14 and Node.js 20.9 or later. Install with
`bun install --frozen-lockfile`.

| Target | Build | Output | Serve |
| --- | --- | --- | --- |
| Next.js / Node.js | `bun run build:next` | `.next/` | `bun run start` |
| Sites / static hosting | `bun run build:sites` | `out/` | Static host |

The static build sets `SITES_STATIC_EXPORT=1` to enable Next.js export.
`next start` cannot serve an export; run the standard build again before
using `bun run start`.

Deploy at the origin root: bundled assets use root-relative URLs. Include
all generated files and public assets, including models and previews.
Use HTTPS; WebMCP also requires a compatible browser.

## Sites

`.openai/hosting.json` identifies the existing Site and selects `out/`.
It contains deployment configuration, not credentials.

1. Run `bun run check`, `bun run test`, and `bun run build`.
2. Push the validated source to the Sites-managed repository.
3. Package the static output with the Sites packaging helper, save a version,
   and deploy it with the approved access settings.

Keep source-write credentials out of files, Git remotes, and logs. Do not
change sharing settings without approval. Hosting, GitHub visibility, and
site deployment are separate actions.

The deployment origin is defined in `src/data/appIdentity.ts` as `APP_URL`.
Update it if the URL changes so link-preview metadata remains accurate.

## Release checks

Follow [Testing](TESTING.md), including the [demo workflows](DEMOS.md), on
the deployed origin rather than only localhost.

- Verify access in a clean browser session without owner credentials.
- Check WebMCP discovery and agent calls in a supporting client.
- Check desktop and mobile layouts, keyboard navigation, and drawer focus.
- Confirm the bundled model, preview, and attribution are available.
- Confirm the human interface works without WebMCP.

Before making the repository public, review tracked files and history for
credentials, personal data, and local artifacts. Keep the lockfile, source
assets, [license](../LICENSE), and [third-party notices](../THIRD_PARTY_NOTICES.md).
Do not commit environment secrets, dependencies, or generated builds.
Ignore rules do not remove files from earlier commits.

# Deployment and public-release checklist

AgenticRoom has no application backend, database, account system, or API-key
requirement. Room data lives in the browser and resets on reload. Sites is
configured for a private static deployment. Public sharing requires separate
approval; a private deployment is not a judge-accessible submission URL.

## Current build contract

| Setting | Value |
| --- | --- |
| Project root | Repository root |
| Package manager | Bun 1.3.14, pinned in `package.json` |
| Node.js | 20.9+ as declared in `package.json`; choose a supported LTS at deployment time |
| Install | `bun install --frozen-lockfile` |
| Build | `bun run build` |
| Sites build | `bun run build:sites` (sets `SITES_STATIC_EXPORT=1`) |
| Start | `bun run start` (`next start`) |
| Output | `.next/` for standard builds; `out/` for Sites builds |
| Required app environment variables | None |
| Public assets | `public/models/` and `public/previews/` |

The default configuration still supports a Next.js-aware host or Node.js
server. The Sites build opts into `output: "export"` and emits `out/`;
`.openai/hosting.json` identifies the Site and selects that public directory.
Package `out/`, never `.next/`, for Sites. No Worker, runtime bindings,
database, or new dependencies are required. `next start` does not serve an
export: run `bun run build` again before using `bun run start`.

## Sites publishing

Run `bun run check`, `bun run test`, and `bun run build:sites`. Use the Sites
packaging helper, push the exact validated source to its managed repository,
save that version, and deploy with owner-only access. Source write credentials
must remain ephemeral and must not appear in files, Git remotes, or logs.
Do not change access to public without approval. A public repository and
Devpost submission remain separate from Sites hosting.

## Local production verification

```bash
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run start
```

For a different local port, run `bun run start --port 3100`. Do not use the
development server as a production service. Stop any existing server on the
chosen port first, or choose an unused port without interrupting another task.

Before publishing, use [Testing](TESTING.md) for the full acceptance pass:

- Open the production app at 1440×900 and 375×812. Check the name, exactly
  one page heading, named controls, drawer focus behavior, and no page overflow.
- Verify both README demo workflows and all 22 registered WebMCP tools using
  a supporting browser/client. Record which browser/client was actually used;
  passing unit tests alone does not verify browser integration.
- Confirm the bundled sofa and preview load without missing assets, and that
  Model credits and this repository's third-party notices remain available.
- Confirm unsupported browsers can still use the human interface.
- Check the session-only behavior and import limits are accurately described;
  there is no real payment, persistent design storage, or hosted AI agent.

## Before sharing the deployed site publicly

- Serve the app at an HTTPS origin. Browser WebMCP availability also depends
  on the client and its experimental settings; HTTPS alone does not enable it.
- Serve the complete build and public assets, including `.glb` and `.png`
  files. Deploy at the origin root unless a subpath is explicitly configured
  and tested; the bundled assets currently use root-relative URLs.
- Test the deployed URL in a clean browser session, without cached credentials
  or preview-deployment protection. No login should be needed for this app.
- Verify tool discovery and actual agent calls on the **deployed** origin,
  not just localhost. Run the hero workflow and check the live room updates.
- Once the public URL is known, add it to README and configure canonical/share
  URLs as appropriate. Do not commit a placeholder deployment URL.
- Decide how to freeze the judged version and prevent automatic redeployments
  after the hackathon deadline. Keep the submitted site available for judging.

## Before making the repository public

- Review tracked files and Git history for credentials, private URLs, personal
  data, local tool artifacts, and files that do not belong in the release.
  Ignore rules prevent future additions; they do not remove past commits.
- Keep `bun.lock`, all source assets, `LICENSE`, and `THIRD_PARTY_NOTICES.md`.
  Application code is MIT; the bundled model and its preview retain CC BY 4.0
  attribution. Preserve the existing copyright notice.
- Exclude `.env` secrets, `node_modules`, `.next`, build/test artifacts, and
  machine-local tool/deployment state. `private: true` in `package.json`
  prevents accidental package publication; it does not prevent a public Git repo.
- Review `git diff --check` and the final diff; commit only the intended changes.
  Repo creation, visibility changes, pushing, deployment, and Devpost submission
  are separate actions requiring the user's direction.
- Follow the challenge checklist and dated deadline/freeze notes in
  [README](../README.md#the-webmcp-challenge) and [AGENTS.md](../AGENTS.md).
  Neither a successful build nor this checklist means an entry was submitted.

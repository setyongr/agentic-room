# Deployment and public-release checklist

AgenticRoom has no application backend, database, account system, or API-key
requirement. Room data lives in the browser and resets on reload. Hosting is
not selected yet; this document prepares the existing Next.js build without
adding a provider dependency or publishing anything.

## Current build contract

| Setting | Value |
| --- | --- |
| Project root | Repository root |
| Package manager | Bun 1.3.14, pinned in `package.json` |
| Node.js | 20.9+ as declared in `package.json`; choose a supported LTS at deployment time |
| Install | `bun install --frozen-lockfile` |
| Build | `bun run build` |
| Start | `bun run start` (`next start`) |
| Output | `.next/` — Next.js build, not a static-host upload directory |
| Required app environment variables | None |
| Public assets | `public/models/` and `public/previews/` |

The current configuration supports a Next.js-aware host or Node.js server.
Although the main route is prerendered, that does **not** make `.next/` a
standalone static export. If a static-only host is selected later, explicitly
configure and verify an export then. Do not assume an `out/` directory exists.
No provider CLI, adapter, Docker image, or deployment credential is needed now.

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

## When a hosting platform is chosen

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

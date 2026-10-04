# Clif Code

Personal portfolio, research, notes and diary site.

## Stack

- Astro
- MDX for long-form writing
- Static output for GitHub Pages and IPFS/ENS (clifcode.eth)

## Publishing

Long-form posts live in `src/pages/posts/` as MDX. The homepage discovers them automatically from frontmatter.

A post frontmatter block looks like:

```yaml
title: Example title
description: Short description
date: 2026-09-23
type: Diary
topics:
  - Philosophy
listenMinutes: 5
```

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Deploying

Every push to `main` deploys two copies of the site:

- **GitHub Pages** (`.github/workflows/pages.yml`), fully automatic.
- **IPFS/ENS** (`.github/workflows/ipfs.yml`): builds with `DEPLOY_TARGET=ipfs`, pins the output to Pinata, then points the site's IPNS name at the new build using w3name.

`clifcode.eth`'s ENS content hash is set once to `ipns://<name>`, so new deploys don't need an ENS transaction. `.github/workflows/ipns-refresh.yml` re-signs the IPNS record daily so it doesn't expire from the IPFS network.

One-time IPNS setup:

1. `npm install && npm run ipns:keygen` prints the public IPNS name and a secret key.
2. Add the key as the `W3NAME_KEY` Actions secret in the GitHub repo settings. Never commit it.
3. Run "Build and pin IPFS site" from the Actions tab to publish the name for the first time.
4. In the ENS app, set `clifcode.eth`'s content hash to the `ENS_CONTENT=ipns://…` value from that run's log.

Without `W3NAME_KEY` the IPNS steps are skipped and the log prints an `ipfs://` content hash for a manual ENS update instead.

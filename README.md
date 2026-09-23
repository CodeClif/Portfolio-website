# Clif Code

Personal portfolio, research, notes and diary site.

## Stack

- Astro
- MDX for long-form writing
- Static output for GitHub Pages now and IPFS/ENS later

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

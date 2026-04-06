# Digitoon — LLM Cartoon Generator

Digitoon specializes in internet graphics, cartoon design, military aerospace and medical grade digital productions.

This repository contains the **Digitoon Cartoon Prompt Engine** — a deterministic blueprint generator for 2D cel-shaded animation tiles at 24 fps.  Forked and extended from [www-infinity4/C13b0](https://github.com/www-infinity4/C13b0).

> **Live app:** [www-infinity4.github.io/Digitoon](https://www-infinity4.github.io/Digitoon)

---

## Two things in this repo

| Directory | What it is |
|-----------|-----------|
| `src/app/` | Next.js 16 web app (hydrogen host, P2P signal, 3D visualizer, game) |
| `cartoon-engine/` | Node.js CLI that generates animation blueprints — no video rendered |
| `src/token-engine/` | Browser keystroke + MIDI listener that triggers scenes from physical input |

---

## Quick start

```bash
npm install

# Generate a tile (mouse character — default) → writes to public/output/
npm run generate

# Generate an Investor Gadget tile
npm run generate:gadget

# Rebuild the static film-cell gallery (public/output/gallery.html)
npm run gallery

# Watch public/output/ and auto-rebuild gallery on every new tile
npm run gallery:watch

# Run all unit tests
npm test

# Start the web app in development
npm run dev
```

---

## Cartoon Prompt Engine

The engine never renders video. It outputs **deterministic YAML/JSON blueprint files** that downstream tools (ComfyUI, lip-sync pipelines, 3D renderers) can consume. The same premise always produces the same files.

One **tile** = one 30-second animation segment = **720 frames at 24 fps** — structured as 4 stitchable shots:

| Shot | Duration | Frames | Role |
|------|----------|--------|------|
| shot_01 | 3 s | 72 | Establishing / context |
| shot_02 | 9 s | 216 | Dialogue A + lip-sync |
| shot_03 | 9 s | 216 | Dialogue B + lip-sync |
| shot_04 | 9 s | 216 | Action beat + hook pose |

Every `shot_04` ends on a **hook pose** that matches the opening of the next tile, so tiles chain into full episodes without manual editing.

---

## Stack

- **Next.js 16** (App Router, static export for GitHub Pages)
- **TypeScript** (strict)
- **Tailwind CSS v4**
- **Lucide React** icons
- **Jest + ts-jest** for cartoon-engine tests
- **js-yaml** for YAML blueprint output
- **Node.js `crypto`** (built-in) for SHA-256 hashes

## Routes

| Route | Description |
|-------|-------------|
| `/` | Home — emoji ID demo, feature cards, token game |
| `/research` | Research articles |
| `/hydrogen-host` | Generate emoji ID, manage contacts |
| `/visualizer` | Interactive 3D cube, signal wave, P2P network |
| `/game` | Token game — stages, stars, bugs |

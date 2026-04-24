# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running locally

**Backend + frontend together** (recommended):
```bash
uvicorn api:app --reload --port 10000
# then open http://localhost:10000
```

**Frontend only** (no Spotify import):
```bash
python -m http.server 10000
```

Spotify credentials must be set as env vars for the import to work:
```bash
SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=xxx uvicorn api:app --reload
```

## Architecture

Single-process FastAPI app that serves both the API and the static frontend.

```
api.py          ← FastAPI backend; mounts static files at "/"
index.html      ← Shell; no templating, all logic in app.js
app.js          ← Vanilla JS module; owns all UI state
style.css       ← Design system via CSS custom properties (data-theme="dark")
```

**Request flow for playlist import:**
1. Frontend POSTs `{ url }` to `/api/scrape`
2. Backend calls Spotipy → Spotify API and streams results back as **NDJSON** (`StreamingResponse`)
3. Frontend reads the stream with `ReadableStream`, parses each newline-delimited JSON chunk, and appends `.song` cards to the `#pool` div
4. Status objects `{ "status": "connected" | "searching" }` come first, then track objects `{ id, title, artist, cover }`, then optionally `{ "error": "..." }`

**Static serving:** `app.mount("/", StaticFiles(directory=".", html=True))` at the end of `api.py` — this means any new static file placed in the root directory is automatically served. The API routes must be defined **before** this mount or they will be shadowed.

## CSS / JS conventions

The design system uses CSS custom properties defined under `[data-theme='dark']` in `style.css`. Key variable groups: `--color-*`, `--space-*`, `--text-*`, `--radius-*`.

Critical class names that are coupled between `app.js` and `style.css`:
- `.song` — draggable card (76×76px); contains `<img>` + `.tooltip > .title + .artist`
- `.tier-drop` — drop zone inside each tier row; id matches `tier-s`, `tier-a`, etc.
- `.sortable-ghost`, `.sortable-chosen` — applied by SortableJS, styled in CSS

SortableJS `group: 'shared'` is what allows cards to move between the pool and all tier rows.

## Deployment (Render)

Deploy target is **Render native Python** (not Docker). The `render.yaml` configures:
- `buildCommand: pip install -r requirements.txt`
- `startCommand: python -m uvicorn api:app --host 0.0.0.0 --port 10000`
- Env vars `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` with `sync: false` — set these manually in the Render dashboard

The `Dockerfile` exists as an alternative path but is **not** what Render uses (render.yaml uses `env: python`).

**Do not add Playwright back** to the build or dependencies. The project went through a scraping phase that used Playwright/Chromium, but the current implementation uses the official Spotify API via `spotipy`. Playwright caused OOM crashes on Render's free tier and is completely unused.

# SimHammer

SimulationCraft made simple. Run sims from your browser or download the desktop app.

**[simhammer.com](https://simhammer.com)** · **[Download Desktop App](https://github.com/sortbek/simcraft/releases/latest)**

## Features

- **Quick Sim** — Paste your SimC addon string, get DPS and ability breakdown
- **Top Gear** — Find the best gear combination from your bags, bank, and vault
- **Drop Finder** — Find the best dungeon/raid drops for your character
- **Stat Weights** — See which stats matter most for your character
- **Sim History** — Browse recent simulation results (desktop: all sims, web: per character)
- **Expert Mode** — Inject custom SimC at specific points in the generated profile
- **Desktop App** — Run everything locally with all your CPU cores, no server needed

## Quick Start

### Option 1: Pre-built Docker image (recommended)

```bash
docker run -p 8000:8000 \
  -v simhammer-data:/app/resources/data \
  -v simhammer-data-full:/app/resources/data_full \
  -v simhammer-simc:/app/resources/simc \
  -v simhammer-db:/app/db \
  ghcr.io/sortbek/simcraft:latest
```

Visit **http://localhost:8000** — everything runs from a single container.

### Option 2: Build from source

```bash
git clone https://github.com/sortbek/simcraft.git
cd simcraft
docker compose -f docker-compose.dev.yml up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000

### Option 3: Desktop app

Grab the latest installer from [GitHub Releases](https://github.com/sortbek/simcraft/releases/latest).

## Project Structure

```
frontend/              Next.js 14 app (shared by web + desktop)
backend/               Cargo workspace (Rust)
  core/                simhammer-core library (API routes, simc runner, game data)
  server/              simhammer-server binary (--desktop flag for desktop mode)
  resources/           Runtime resources (data/, simc/, frontend/) — gitignored
desktop/               Electron app (main process, preload, build scripts)
docker-compose.dev.yml Web development (three-container: frontend + backend + postgres)
Dockerfile.standalone  Single-image build (frontend + backend in one container)
Makefile               Build shortcuts
```

## Standalone Docker Image

A single self-contained Docker image published to **GitHub Container Registry** on every push to master. Serves both the frontend and backend from one container on one port.

### Pull and run

```bash
docker run -p 8000:8000 \
  -v simhammer-data:/app/resources/data \
  -v simhammer-data-full:/app/resources/data_full \
  -v simhammer-simc:/app/resources/simc \
  -v simhammer-db:/app/db \
  ghcr.io/sortbek/simcraft:latest
```

Or use the Makefile shortcuts:

```bash
make build-standalone   # Build locally
make run-standalone     # Run with persistent volumes
```

### Using PostgreSQL instead of SQLite

```bash
docker run -p 8000:8000 \
  -e DATABASE_URL=postgres://user:pass@host/simhammer \
  ghcr.io/sortbek/simcraft:latest
```

The server auto-detects the database type from the URL prefix.

### How it works

**At build time** — Docker produces a single **Alpine-based** image containing:
- The Next.js frontend compiled as a **static export** (`out/` folder of HTML/JS/CSS)
- The compiled `simhammer-server` Rust binary (musl-native)
- The `compact-data.js` compaction script
- Minimal runtime dependencies (`libcurl`, `libstdc++`, `bash`) — no C++ build tools needed!

**At startup** — the entrypoint script (`standalone-entrypoint.sh`) runs before the server:
1. Fetches the latest game data from Raidbots and compacts it (~67% size reduction)
2. Fetches the latest `simc` binary from **`SimulationCraft/simc:latest`** on Docker Hub directly via the Registry HTTP API (requires only `curl`/`jq`/`tar` — no Docker daemon needed)
3. Caches the layer digest locally; only re-downloads if the upstream image is updated
4. Hands off to `simhammer-server`

**At request time** — the Rust server handles everything on port 8000:
- `GET /api/*` — served by Rust API handlers
- `GET /_next/*` — served as static files from the baked-in `out/` folder
- Everything else — falls back to the appropriate static HTML page (SPA routing)

### Persistent volumes

| Volume | Contents | Without it |
|--------|----------|------------|
| `simhammer-data` | Compacted game data JSONs | Re-downloaded & re-compacted on every start |
| `simhammer-data-full` | Raw Raidbots downloads | Re-downloaded on every start |
| `simhammer-simc` | Persistent cache for the `simc` binary + digest | Re-downloaded from Docker Hub on every start |
| `simhammer-db` | SQLite job history | Lost on every restart |

## Web (two-container)

### Development

```bash
docker compose -f docker-compose.dev.yml up --build
```

Docker handles everything — compiles the Rust backend, builds SimC from source, fetches game data from Raidbots, and builds the Next.js frontend.

- Frontend: http://localhost:3000
- API: http://localhost:8000

### Deploy to a VPS

1. Clone the repo on your server
2. Run `docker compose up -d --build`
3. Set up nginx as reverse proxy (port 80 → 3000 for frontend, /api/ → 8000 for backend)

## Desktop

### Download

Grab the latest installer from [GitHub Releases](https://github.com/sortbek/simcraft/releases/latest).

### Development

#### 1. Install dependencies

```bash
cd frontend && npm install && cd ..
cd desktop && npm install && cd ..
```

#### 2. Run

```bash
npm run desktop:dev
```

On first run, this automatically uses Docker to fetch game data from Raidbots and compile SimulationCraft from source (stored in `backend/resources/`). On subsequent runs, this step is skipped since the resources already exist.

After resources are ready, it:
1. Builds the Rust backend in debug mode
2. Starts the Next.js dev server on port 3000
3. Launches the Electron app

To re-fetch resources (e.g. after a game patch), delete `backend/resources/data/` and/or `backend/resources/simc/` and run `npm run desktop:dev` again.

### Build installer

```bash
npm run desktop:build
```

Builds the frontend (static export), compiles the Rust backend in release mode, copies all resources, and packages everything into an installer with electron-builder.

Output goes to `desktop/dist/`.

| Platform | Target |
|----------|--------|
| Windows  | NSIS installer |
| macOS    | DMG |
| Linux    | AppImage, deb |

## Getting a SimC Addon String

1. Install the [SimulationCraft addon](https://www.curseforge.com/wow/addons/simulationcraft) in WoW
2. In-game, type `/simc`
3. Copy the full text from the popup window
4. Paste it into SimHammer

## Architecture

### Standalone (single container)
```
Browser → Rust/Actix-web (8000) ─── static files (frontend/out/)
                                └── API handlers → SQLite → simc subprocess
```

### Web (two-container)
```
Browser → Next.js (3000) → Rust/Actix-web (8000) → SQLite/PostgreSQL → simc subprocess
```

### Desktop
```
Electron → Next.js → Rust/Actix-web (17384) → MemoryStorage → simc subprocess
```

All three modes use the same Next.js frontend and the same Rust core library (`simhammer-core`). The core provides API routes, addon parsing, profileset generation, and simc process management. Storage is abstracted via a `JobStorage` trait — web uses `SqliteStorage` or `PostgresStorage`, desktop uses `MemoryStorage`.

### Job retention

Jobs are automatically garbage collected on insert. Defaults:
- **Desktop**: last 50 sims
- **Web**: last 200 sims

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SIMC_PATH` | `/usr/local/bin/simc` | Path to SimulationCraft binary |
| `DATA_DIR` | `./resources/data` | Path to game data JSON files |
| `DATABASE_URL` | `simhammer.db` | SQLite path or `postgres://` URL (web only) |
| `PORT` | `8000` | Server port |
| `BIND_HOST` | `0.0.0.0` | Server bind address |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API URL (frontend build-time) |
| `FRONTEND_DIR` | _(unset)_ | Path to static frontend files (standalone mode only) |
| `MAX_JOBS` | `50` / `200` | Max jobs to retain (desktop / web). Oldest are deleted on insert |

## CI/CD

- **Desktop builds** — GitHub Actions builds Windows (NSIS), macOS (DMG with code signing + notarization), and Linux (AppImage/deb) on tagged releases
- **Docker image** — Automatically published to `ghcr.io/sortbek/simcraft` on push to master (multi-arch: amd64 + arm64)

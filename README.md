# SimHammer

SimulationCraft made simple. Run sims from your browser or download the desktop app.

**[Demo](https://simhammer.com)** · **[Download Desktop App](https://github.com/sortbek/simcraft/releases/latest)**

---

## What is SimHammer?

SimHammer is a modern web and desktop interface for [SimulationCraft](https://www.simulationcraft.org/). Paste your SimC addon string and get instant results — no command line needed.

### Sim Types

| Sim Type | Description |
|----------|-------------|
| **Quick Sim** | Get your DPS and ability breakdown |
| **Top Gear** | Find the best gear combination from your bags, bank, and vault |
| **Drop Finder** | Discover the best dungeon and raid drops for your character |

### Additional Features

- **Sim History** — Browse recent simulation results (desktop: all sims, web: per character)
- **Expert Mode** — Inject custom SimC at specific points in the generated profile

---

## Getting Started

### Getting Your SimC Addon String

1. Install the [SimulationCraft addon](https://www.curseforge.com/wow/addons/simulationcraft) in WoW
2. Type `/simc` in-game
3. Copy the full text from the popup window
4. Paste it into SimHammer

### Desktop App

Download the latest installer from [GitHub Releases](https://github.com/sortbek/simcraft/releases/latest). Runs everything locally using all your CPU cores, no server needed.

| Platform | Format |
|----------|--------|
| Windows | NSIS installer |
| macOS | DMG |
| Linux | AppImage, deb |

---

## Self-Hosting

### Docker (recommended)

```bash
docker run -p 8000:8000 \
  -v simhammer-data:/app/resources/data \
  -v simhammer-data-full:/app/resources/data_full \
  -v simhammer-simc:/app/resources/simc \
  -v simhammer-db:/app/db \
  ghcr.io/sortbek/simcraft:latest
```

Visit **http://localhost:8000** — everything runs from a single container.

On startup, the container automatically fetches the latest game data from Raidbots and the latest SimC binary. Both are cached in the volumes below so subsequent starts are fast.

#### Persistent Volumes

| Volume | Contents | Without it |
|--------|----------|------------|
| `simhammer-data` | Compacted game data JSONs | Re-downloaded & re-compacted on every start |
| `simhammer-data-full` | Raw Raidbots downloads | Re-downloaded on every start |
| `simhammer-simc` | SimC binary + digest cache | Re-downloaded on every start |
| `simhammer-db` | SQLite job history | Lost on every restart |

#### Using PostgreSQL Instead of SQLite

```bash
docker run -p 8000:8000 \
  -e DATABASE_URL=postgres://user:pass@host/simhammer \
  ghcr.io/sortbek/simcraft:latest
```

The server auto-detects the database type from the URL prefix.

### Build from Source

```bash
git clone https://github.com/sortbek/simcraft.git
cd simcraft
docker compose -f docker-compose.dev.yml up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000

### Deploy to a VPS

1. Clone the repo on your server
2. Run `docker compose up -d --build`
3. Set up nginx as reverse proxy (port 80 → 3000 for frontend, `/api/` → 8000 for backend)

---

## Development

### Project Structure

```
frontend/                Next.js 14 app (shared by web + desktop)
backend/                 Cargo workspace (Rust)
  core/                  simhammer-core library (API, simc runner, game data)
  server/                simhammer-server binary (--desktop flag for desktop mode)
  resources/             Runtime resources (data/, simc/, frontend/) — gitignored
desktop/                 Electron app (main process, preload, build scripts)
docker-compose.dev.yml   Web dev setup (frontend + backend + postgres)
Dockerfile.standalone    Single-image build (frontend + backend)
Makefile                 Build shortcuts
```

### Web Development

#### Without Docker

Requires Rust toolchain, Node.js 20+, and game data/simc binary in `backend/resources/`.

```bash
# Terminal 1 — Backend
cd backend && cargo run -p simhammer-server

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- Frontend: http://localhost:3000
- API: http://localhost:8000

#### With Docker

```bash
docker compose -f docker-compose.dev.yml up --build
```

Docker handles everything — compiles the Rust backend, builds SimC from source, fetches game data, and builds the frontend.

### Desktop Development

#### 1. Install dependencies

```bash
cd frontend && npm install && cd ..
cd desktop && npm install && cd ..
```

#### 2. Run

```bash
npm run desktop:dev
```

On first run, this uses Docker to fetch game data and compile SimC (stored in `backend/resources/`). Subsequent runs skip this step. To re-fetch after a game patch, delete `backend/resources/data/` and/or `backend/resources/simc/`.

This starts:
1. Rust backend (debug mode)
2. Next.js dev server (port 3000)
3. Electron app

#### Build Installer

```bash
npm run desktop:build
```

Output goes to `desktop/dist/`.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Next.js Frontend                  │
│              (shared by all three modes)             │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Standalone        Web          Desktop
   (port 8000)    (port 8000)   (port 17384)
        │              │              │
   Rust/Actix     Rust/Actix     Rust/Actix
        │              │              │
     SQLite      SQLite/Postgres  MemoryStorage
        │              │              │
       simc           simc          simc
```

All three modes share the same Rust core library (`simhammer-core`) which provides API routes, addon parsing, profileset generation, and simc process management. Storage is abstracted via a `JobStorage` trait.

### Job Retention

Jobs are automatically garbage collected on insert:
- **Desktop**: last 50 sims
- **Web**: last 200 sims

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SIMC_PATH` | `/usr/local/bin/simc` | Path to SimulationCraft binary |
| `DATA_DIR` | `./resources/data` | Path to game data JSON files |
| `DATABASE_URL` | `simhammer.db` | SQLite path or `postgres://` URL (web only) |
| `PORT` | `8000` | Server port |
| `BIND_HOST` | `0.0.0.0` | Server bind address |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API URL (frontend build-time) |
| `FRONTEND_DIR` | _(unset)_ | Path to static frontend files (standalone mode) |
| `MAX_JOBS` | `50` / `200` | Max retained jobs (desktop / web) |
| `MAX_COMBINATIONS` | `500` | Max gear combinations for Top Gear sims |
| `MAX_SCENARIOS` | `10` | Max scenarios per batch (`0` to disable) |

---

## CI/CD

- **Desktop** — GitHub Actions builds Windows, macOS (with code signing + notarization), and Linux installers on tagged releases
- **Docker** — Automatically published to `ghcr.io/sortbek/simcraft` on push to master (amd64)

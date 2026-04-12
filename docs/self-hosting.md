# Self-Hosting

## Docker (recommended)

```bash
docker run -p 8000:8000 \
  -e SIMC_ENABLED_BRANCHES=weekly,nightly \
  -v simhammer-data:/app/resources/data \
  -v simhammer-data-full:/app/resources/data_full \
  -v simhammer-simc:/app/resources/simc \
  -v simhammer-db:/app/db \
  ghcr.io/sortbek/simcraft:latest
```

Visit **http://localhost:8000** — everything runs from a single container.

Use `SIMC_ENABLED_BRANCHES=weekly` or `SIMC_ENABLED_BRANCHES=nightly` to install only one branch. If omitted, it defaults to `weekly`.

On startup, the container automatically:
1. Fetches the latest SimC binaries from GitHub Releases
2. Downloads game data from Raidbots
3. Fetches instance images and season data from simhammer.com
4. Compacts game data for production use

All fetched data is cached in volumes so subsequent starts are fast.

### Persistent Volumes

| Volume | Contents | Without it |
|--------|----------|------------|
| `simhammer-data` | Compacted game data + instance images | Re-downloaded on every start |
| `simhammer-data-full` | Raw Raidbots downloads | Re-downloaded on every start |
| `simhammer-simc` | Cached SimC branch binaries | Re-downloaded on every start |
| `simhammer-db` | SQLite job history | Lost on every restart |

### PostgreSQL

```bash
docker run -p 8000:8000 \
  -e DATABASE_URL=postgres://user:pass@host/simhammer \
  ghcr.io/sortbek/simcraft:latest
```

The server auto-detects the database type from the URL prefix.

## Build from Source

```bash
git clone https://github.com/sortbek/simcraft.git
cd simcraft
docker compose -f docker-compose.dev.yml up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000

## VPS Deploy

1. Clone the repo on your server
2. Run `docker compose up -d --build`
3. Set up nginx as reverse proxy (port 80 → 8000)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SIMC_ENABLED_BRANCHES` | `weekly` | Comma-separated SimC branches to install and expose, e.g. `weekly,nightly` |
| `SIMC_PATH` | `/usr/local/bin/simc` | Path to SimulationCraft binary |
| `DATA_DIR` | `./resources/data` | Path to game data JSON files |
| `DATABASE_URL` | `simhammer.db` | SQLite path or `postgres://` URL |
| `PORT` | `8000` | Server port |
| `BIND_HOST` | `0.0.0.0` | Server bind address |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API URL (frontend build-time) |
| `FRONTEND_DIR` | _(unset)_ | Path to static frontend files (standalone mode) |
| `MAX_JOBS` | `50` / `200` | Max retained jobs (desktop / web) |
| `MAX_COMBINATIONS` | `500` | Max gear combinations for Top Gear sims |
| `MAX_SCENARIOS` | `10` | Max scenarios per batch (`0` to disable) |

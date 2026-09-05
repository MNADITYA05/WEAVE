# Docker Setup

Docker is the recommended way to run Weave's Tab 3 simulation backend. It bundles Python, ngspice, and all dependencies into a reproducible container.

---

## Services

`docker-compose.yml` defines two services:

```yaml
services:
  backend:
    build: .
    ports:
      - "8000:8000"
    environment:
      - NGSPICE_BIN=ngspice
      - NGSPICE_TIMEOUT=30
      - NGSPICE_SPICELIB=/spicelib
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  frontend:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - .:/app
    ports:
      - "5173:5173"
    command: sh -c "npm install && npm run dev -- --host"
    environment:
      - VITE_SIM_BACKEND=http://localhost:8000
```

| Service | Port | Description |
|---|---|---|
| `backend` | 8000 | FastAPI + ngspice simulation engine |
| `frontend` | 5173 | Vite dev server with HMR |

---

## `Dockerfile`

```dockerfile
FROM python:3.12-slim

# Install ngspice and Node.js
RUN apt-get update && apt-get install -y \
    ngspice \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

WORKDIR /app

# Python backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY backend/spicelib/ /spicelib/

# Frontend build (optional — for production)
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Start backend
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Key layers explained

| Layer | Purpose |
|---|---|
| `python:3.12-slim` | Minimal Python base image (no dev tools) |
| `apt-get install ngspice` | System ngspice from Debian package (~10 MB) |
| `pip install -r requirements.txt` | FastAPI + uvicorn + numpy |
| `COPY backend/spicelib/ /spicelib/` | Bundled SPICE model files (accessible at runtime) |
| `npm ci && npm run build` | Production frontend build into `dist/` |

---

## Quick Start

```bash
# Start both services
docker compose up --build

# Start in background
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

After `docker compose up`:
- **Frontend:** `http://localhost:5173`
- **Backend:** `http://localhost:8000`
- **Health check:** `curl http://localhost:8000/ping` → `{"status":"ok"}`

---

## Environment Variables

Set in `docker-compose.yml` under `environment:`, or in a `.env` file at the repo root.

### Backend variables

| Variable | Default | Description |
|---|---|---|
| `NGSPICE_BIN` | `ngspice` | Path or name of the ngspice executable. Override if ngspice is installed at a non-standard path. |
| `NGSPICE_TIMEOUT` | `30` | Maximum wall-clock seconds per simulation. Longer simulations are killed and return a timeout error. |
| `NGSPICE_SPICELIB` | `/spicelib` | Directory containing bundled `.lib` and `.mod` files. The backend prepends `.lib /spicelib/standard.lib` to every netlist at runtime. Set to an empty string to disable. |

### Frontend variables

| Variable | Default | Description |
|---|---|---|
| `VITE_SIM_BACKEND` | `http://localhost:8000` | URL of the simulation backend. Change this if the backend runs on a different host or port (e.g., in a cloud deployment). |

---

## `/spicelib` — Bundled SPICE Models

The `backend/spicelib/` directory contains SPICE model files that are copied into the Docker image at `/spicelib/`. These are injected into every simulation run so that ngspice can resolve standard part references without needing the full LTspice installation.

```
backend/spicelib/
└── standard.lib    ← bundled .model definitions
```

To add more models, drop additional `.lib` or `.mod` files into `backend/spicelib/` and rebuild the Docker image.

At runtime, `backend/netlist.py` resolves the spicelib path:

```python
def _resolve_spicelib(netlist: str) -> str:
    spicelib = os.getenv('NGSPICE_SPICELIB', '/spicelib')
    if spicelib and os.path.isdir(spicelib):
        lib_line = f'.lib {spicelib}/standard.lib\n'
        return lib_line + netlist
    return netlist
```

---

## Health Check

The backend exposes a `/ping` endpoint that Docker uses for its health check:

```python
# backend/main.py
@app.get("/ping")
def ping():
    return {"status": "ok"}
```

Docker Compose polls this endpoint every 10 seconds. If it fails 3 times, the backend is marked `unhealthy`. The frontend's Tab 3 status dot reflects this state on the next page load.

---

## Production Deployment

For production, you typically want:

1. **Serve the frontend as static files** — run `npm run build`, then serve `dist/` from nginx or a CDN
2. **Run only the backend container** — remove the `frontend` service from `docker-compose.yml`
3. **Set `VITE_SIM_BACKEND`** at build time to your production backend URL:
   ```bash
   VITE_SIM_BACKEND=https://api.yoursite.com npm run build
   ```
4. **Add HTTPS** — put nginx or a load balancer in front of uvicorn
5. **Set `NGSPICE_TIMEOUT`** appropriately for your server capacity

### Minimal production `docker-compose.yml`

```yaml
services:
  backend:
    build: .
    ports:
      - "8000:8000"
    environment:
      - NGSPICE_BIN=ngspice
      - NGSPICE_TIMEOUT=60
      - NGSPICE_SPICELIB=/spicelib
    restart: unless-stopped
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `ngspice: command not found` inside container | ngspice not installed in image | Rebuild with `docker compose build --no-cache` |
| Port 8000 already in use | Another service on 8000 | Change the host port: `"8001:8000"` in `docker-compose.yml` |
| Port 5173 already in use | Another Vite instance | Change `"5174:5173"` and update `VITE_SIM_BACKEND` |
| `EADDRINUSE` on `npm run dev` | Frontend port conflict | Stop the other instance or change the port |
| Backend health check failing | uvicorn not started yet | Wait 10–15 seconds after `docker compose up` |
| Simulation returns empty vectors | ngspice ran but no `.raw` output | Check the netlist has a valid simulation directive; look at `docker compose logs backend` |
| `permission denied` on `/spicelib` | Volume mount override | Don't mount a volume over `/spicelib`; it shadows the bundled models |

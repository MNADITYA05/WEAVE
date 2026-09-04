FROM python:3.12-slim

# ── System deps: ngspice + Node.js ──────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ngspice \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python backend ───────────────────────────────────────────────────────────
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# ── Frontend build ───────────────────────────────────────────────────────────
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime ─────────────────────────────────────────────────────────────────
COPY backend/ ./backend/

# ── Bundled SPICE model library ──────────────────────────────────────────────
RUN mkdir -p /spicelib
COPY backend/spicelib/ /spicelib/
ENV NGSPICE_SPICELIB=/spicelib

EXPOSE 8000

ENV PYTHONPATH=/app/backend
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

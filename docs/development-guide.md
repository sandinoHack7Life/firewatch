# Development guide

## Local setup

1. Copy `.env.example` to the project-root `.env`.
2. Add a `FIRMS_MAP_KEY` for MODIS/VIIRS satellite CSV feeds and optional SMTP settings for email delivery. NASA EONET works without a key. Keep all secrets in the ignored `.env`.
3. In one terminal, create the backend environment, install dependencies, and start FastAPI:
   ```powershell
   cd backend
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```
4. In a second terminal:
   ```powershell
   cd frontend
   npm install
   npm run dev -- --host 0.0.0.0 --port 5174
   ```
5. Backend docs: `http://localhost:8000/docs`; frontend app: `http://localhost:5174`.

The backend resolves `.env` relative to the project root and stores observations, alerts, and field visits in separate SQLite databases under the user's home directory by default. Configure persistent storage for managed deployments; Docker Compose mounts a named data volume. Field-report endpoints are unauthenticated; protect access to the backend at the network or deployment layer.

## Frontend workflow

Run the frontend commands above from PowerShell or another terminal.

## Backend workflow

Run the backend commands above from PowerShell or another terminal.

## Docker Compose

After configuring the project-root `.env`, run `docker compose up -d --build`. The frontend is served at `http://localhost:5174`, the API at `http://localhost:8000`, and OpenAPI docs at `http://localhost:8000/docs`. `docker compose down` stops services without deleting the named data volumes.

## Testing

```bash
cd frontend
npm run build

cd backend
pip install -r requirements-dev.txt
pytest
```

## Guardrails

- Do not add AI providers or API keys to the working application.
- Do not ship fake AI insights or placeholder chat features.
- Keep the project modular and AI-ready without enabling AI in v1.
- Never interpret EONET event reports as FIRMS sensor detections or invent their missing FRP/confidence values.
- Simulation markers are opt-in and visibly watermarked; they are excluded from APIs, reports, alerts, and field visits.
- OSM park boundaries are mapped estimates, not legal dispatch boundaries; preserve ODbL attribution.
- Protect the shared field key and private database files; shared-key access is not a substitute for user-specific identity or authorization in a public deployment.

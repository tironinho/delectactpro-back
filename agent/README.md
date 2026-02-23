# DROP Compliance Agent

Runs in the customer environment. Connects to the control plane (backend) for config, heartbeat, and events. Connects to the customer DB for local hashing (zero-knowledge). **No PII is sent to the backend** — only subject hashes, request IDs, status, and timestamps.

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `CONTROL_PLANE_URL` | Yes | Backend URL (e.g. `http://localhost:4242`) |
| `CONNECTOR_TOKEN` | Yes | Bearer token from backend (create connector → copy token once) |
| `CONNECTOR_ID` | Yes | Connector UUID from backend |
| `DB_TYPE` | Yes | `postgres` or `mysql` |
| `DB_URL` | Yes | Connection string for customer DB |
| `DRY_RUN` | No | `1` or `true` to run dry-run match (default: 1) |
| `POLL_INTERVAL_HOURS` | No | How often to run sync (default: 24). Max 45 days for compliance. |
| `DROP_REQUESTS_FILE` | No | Path to JSON file with DROP requests (array). If unset, uses demo request. |
| `HASH_TABLE` | No | Table name for subject hashes (default: `subject_hashes`) |
| `HASH_COLUMN` | No | Column name for subject hash (default: `subject_hash`) |

## Build & run

```bash
npm install
npm run build
npm start
```

## Docker

```bash
docker build -t drop-agent .
docker run --env-file .env drop-agent
```

See `docker-compose.example.yml` for a full example.

## Behavior

1. **Heartbeat** — Every 30s sends `POST /api/connector/heartbeat` with agent version and DB type.
2. **Config** — Fetches active hash recipe and partners/policies from `GET /api/connector/config`.
3. **Dry-run** — Reads requests from `DROP_REQUESTS_FILE` or uses one demo request; computes `subject_hash` locally; queries customer DB for match (by hash column); sends events (DROP_REQUEST_RECEIVED, MATCH_RESULT, RUN_START, RUN_END) to the control plane.
4. **Schedule** — Runs dry-run every `POLL_INTERVAL_HOURS`; ensure last run is within 45 days for compliance.

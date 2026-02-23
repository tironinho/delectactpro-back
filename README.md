# DROP Compliance Gateway — Backend

Multi-tenant SaaS backend (TypeScript, Express, SQLite) for DROP compliance: auth + RBAC, connectors & tokens for the Docker Agent, hash recipes, partners & cascade policies, runs & audit logs, Stripe setup fee + portal. **No PII is stored** — only hashes and event logs.

## Quick start

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET, optionally STRIPE_* and ADMIN_TOKEN
npm install
npm run dev
```

Server: `http://localhost:4242`. Health: `GET /health`.

---

## 1. Create org and user

```bash
# Signup (creates org + owner user)
curl -s -X POST http://localhost:4242/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"orgName":"Acme Inc","email":"admin@acme.com","password":"your-secure-password"}'
# Response: { "token": "<JWT>", "user": { "id", "orgId", "email", "role": "OWNER" } }

# Login
curl -s -X POST http://localhost:4242/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.com","password":"your-secure-password"}'
# Response: { "token": "<JWT>", "user": { ... } }

# Current user + org
curl -s http://localhost:4242/auth/me -H "Authorization: Bearer <JWT>"
```

---

## 2. Create connector and get token

The connector token is **shown only once** at creation (and when rotating). Store it securely for the Agent.

```bash
export JWT="<your-jwt-from-login>"

# Create connector (returns token in response — save it)
curl -s -X POST http://localhost:4242/api/app/connectors \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"Production DB","dbType":"postgres"}'
# Response: { "id": "<connector-uuid>", "name": "Production DB", "dbType": "postgres", "status": "PENDING", "createdAt": "...", "token": "<64-char-hex>" }

# List connectors (token is never returned again)
curl -s http://localhost:4242/api/app/connectors -H "Authorization: Bearer $JWT"

# Rotate token (new token returned once)
curl -s -X POST http://localhost:4242/api/app/connectors/<CONNECTOR_ID>/rotate-token \
  -H "Authorization: Bearer $JWT"
# Response: { "token": "<new-64-char-hex>" }
```

---

## 3. Heartbeat and events (Agent or manual)

Use the **connector token** (Bearer), not the user JWT.

```bash
export CONNECTOR_TOKEN="<token-from-create-connector>"

# Heartbeat (updates last_heartbeat_at and status)
curl -s -X POST http://localhost:4242/api/connector/heartbeat \
  -H "Authorization: Bearer $CONNECTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentVersion":"0.1.0","dbType":"postgres"}'

# Send events (e.g. from Agent)
curl -s -X POST http://localhost:4242/api/connector/events \
  -H "Authorization: Bearer $CONNECTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"type":"DROP_REQUEST_RECEIVED","requestId":"req-1"},{"type":"MATCH_RESULT","requestId":"req-1","matched":true,"matchCount":1}]'

# Get config (hash recipe + partners + policies)
curl -s http://localhost:4242/api/connector/config -H "Authorization: Bearer $CONNECTOR_TOKEN"
```

---

## 4. Run the Agent via Docker

From the `agent/` directory:

```bash
cd agent
cp docker-compose.example.yml docker-compose.yml
# Set in .env or export: CONNECTOR_TOKEN, CONNECTOR_ID, DB_URL
docker compose up -d
```

Or build and run manually:

```bash
cd agent
npm install && npm run build
CONTROL_PLANE_URL=http://localhost:4242 CONNECTOR_TOKEN=... CONNECTOR_ID=... DB_TYPE=postgres DB_URL=postgresql://user:pass@localhost:5432/db DRY_RUN=1 npm start
```

See `agent/README.md` for all env vars and behavior.

---

## 5. Other app endpoints (all require `Authorization: Bearer <JWT>`)

- **Hash recipes**: `GET/POST /api/app/hash-recipes`, `PATCH /api/app/hash-recipes/:id`, `POST /api/app/hash-recipes/:id/activate`
- **Partners**: `GET/POST/PATCH/DELETE /api/app/partners`, `GET/POST/DELETE /api/app/partners/links`, `GET/POST/PATCH/DELETE /api/app/partners/policies`
- **Cascade**: `POST /api/app/cascade/dispatch-test` (body: `{ "requestId": "<id>" }`)
- **Runs**: `GET /api/app/runs`, `GET /api/app/runs/:id`
- **Audit**: `GET /api/app/audit?requestId=<id>`, `GET /api/app/audit/requests/:id/export` (audit packet JSON)
- **DSAR**: `POST /api/app/dsar/requests` (body: `subjectHash`, optional `requestRef`, `payloadHash`, `system`, `meta`), `GET /api/app/dsar/requests/:id`, `POST /api/app/dsar/requests/:id/events`
- **Billing**: `POST /api/app/billing/portal` → returns Stripe customer portal URL

---

## 6. Stripe

- **Checkout (setup fee $999)**: `POST /api/create-checkout-session` — optional `Authorization: Bearer <JWT>` to pass `orgId` in metadata so the webhook sets `setup_fee_paid_at` on the org.
- **Webhook**: `POST /webhook` (raw body) — on `checkout.session.completed` with `metadata.orgId`, sets `orgs.setup_fee_paid_at`.
- **Portal**: `POST /api/app/billing/portal` (auth) → redirect URL for Stripe billing portal.

---

## Criteria (back)

- Signup/login works; `org_id` is enforced on all app endpoints.
- Connector token is generated once and listed without exposing the secret.
- Heartbeat updates `connectors.last_heartbeat_at` and status.
- Hash recipes CRUD + activate.
- Partners, links, and cascade policies CRUD; dispatch-test creates PENDING cascade jobs.
- Agent can connect to DB, send heartbeat and events; backend exposes heartbeat, events, config.
- Stripe checkout and webhook set `setup_fee_paid_at`; portal returns URL.
- Audit packet export returns only hashes and events (no PII).

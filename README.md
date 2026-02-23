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

## 6. Stripe (Checkout, Webhook, Billing)

### Configuring Stripe locally

1. Create a Stripe account and get **Secret key** (test: `sk_test_...`) and **Webhook signing secret** (test: `whsec_...`).
2. In `.env`: set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Optionally `STRIPE_SETUP_FEE_PRICE_ID` (a Price ID from Stripe Dashboard) to use a fixed price instead of inline `price_data`.
3. Set `APP_URL` (e.g. `http://localhost:5173` for dev, `https://deleteactpro.com` for prod) — used for `success_url` and `cancel_url` of Checkout.

### Running the webhook locally (Stripe CLI)

Stripe needs to send events to your server. Locally, use the Stripe CLI to forward events:

```bash
stripe listen --forward-to localhost:4242/webhook
# Or: --forward-to localhost:4242/api/stripe/webhook
```

Use the signing secret printed by `stripe listen` as `STRIPE_WEBHOOK_SECRET` in `.env`. In production, configure the webhook URL in Stripe Dashboard (e.g. `https://api.deleteactpro.com/webhook`) and set `STRIPE_WEBHOOK_SECRET` to the dashboard secret.

### Events handled (idempotent)

- **checkout.session.completed** — Persist payment in `billing_payments`, set `orgs.setup_fee_paid_at` when `metadata.orgId` or matching org by email.
- **payment_intent.succeeded** — Acknowledged (payment already recorded via session).
- **payment_intent.payment_failed** — Update `billing_payments.status` to `failed`.
- **checkout.session.expired** — Update `billing_payments.status` to `expired` when row exists.

All events are stored in `stripe_events` by `stripe_event_id`; duplicate events are ignored (idempotency).

### Flow: landing → checkout → success → webhook → payment marked paid

1. User lands on pricing/checkout; frontend calls `POST /api/create-checkout-session` (optional JWT for org, optional `email`, `leadId`, `utm`, etc.).
2. Backend creates a Stripe Checkout Session and returns `{ id, url }`; frontend redirects to `url` or uses `id` with Stripe.js.
3. User pays; Stripe redirects to `APP_URL/billing/success?session_id={CHECKOUT_SESSION_ID}`.
4. Frontend can call `GET /api/billing/checkout-session/:sessionId` (no auth) to confirm status from our DB (or Stripe fallback).
5. Stripe sends `checkout.session.completed` to `POST /webhook` or `POST /api/stripe/webhook`; backend persists payment and updates org; responds 2xx quickly.

### Endpoints

- **Checkout**: `POST /api/create-checkout-session` — body: `planId: "setup_fee_999"`, optional `email`, `companyName`, `leadId`, `sourcePage`, `referrer`, `utm`. Optional `Authorization: Bearer <JWT>` to link org. Returns `{ id, url? }`.
- **Webhook**: `POST /webhook` or `POST /api/stripe/webhook` (raw body; do not use JSON parser for this route).
- **Session status**: `GET /api/billing/checkout-session/:sessionId` — returns `sessionId`, `status`, `paymentStatus`, `planId`, `amountCents`, `currency`, `customerEmail`, `createdAt` (from DB or Stripe).
- **Pricing config**: `GET /api/public/pricing` — returns `setupFee` and `plans` (single source of truth for frontend).
- **Portal**: `POST /api/app/billing/portal` (auth) → Stripe customer portal URL.

### Environment variables (Stripe)

| Var | Description |
|-----|-------------|
| `STRIPE_SECRET_KEY` | Stripe API key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Dashboard or `stripe listen` |
| `STRIPE_SETUP_FEE_PRICE_ID` | Optional; Stripe Price ID for setup fee (else inline price_data) |
| `APP_URL` | Frontend base URL for success/cancel redirects (defaults to `CLIENT_URL`) |
| `API_BASE_URL` | Optional; API base URL when different from origin |

---

## 7. Integration modes (Agent / Customer APIs / Hybrid)

The backend supports three ways to integrate deletion targets:

- **AGENT**: Docker Agent connects to your DB; connectors report heartbeat and events. Use `GET /api/app/connectors`, partners/links/policies with `connector_id`.
- **CUSTOMER_APIS**: You expose a BYO API (health, delete, status); the gateway calls it. Use `GET/POST /api/app/customer-apis`, test-health/test-delete/test-status.
- **HYBRID**: Both connectors and customer APIs exist; mode is detected in `GET /api/app/integrations/summary` as `modeDetected`.

---

## 8. Customer API contract (BYO API)

If you implement a Customer API, it must expose (paths configurable per integration):

- **Health**: `GET <base_url><health_path>` (default `/deleteactpro/health`) — return 200 when ready.
- **Status**: `GET <base_url><status_path>` (default `/deleteactpro/status`) — optional; return request status.
- **Delete**: `POST <base_url><delete_path>` (default `/deleteactpro/delete`) — body: `{ requestId, subjectHash, mode, source }`. `mode` is `DRY_RUN` or `ENFORCE`.

Auth: **NONE**, **HMAC**, or **BEARER**. For HMAC, the gateway sends `X-DAP-Timestamp` (unix seconds) and `X-DAP-Signature` (HMAC-SHA256 of `timestamp + body`). For BEARER, `Authorization: Bearer <token>`.

---

## 9. HMAC signing format

Signature = HMAC-SHA256(shared_secret, timestamp + raw_body). Timestamp is sent in `X-DAP-Timestamp` (configurable via `timestampHeaderName`). Header name for signature is configurable (default `X-DAP-Signature`). Replay window (default 300s) should be enforced by your API.

---

## 10. Onboarding readiness

- **GET /api/app/onboarding/status** — returns `steps`, `readinessScore`, `dropReady`, `blockers`. Steps: org, integrations, hashRecipe, partners, cascadeTargets, policies, dryRun (last run within 45 days), billing.
- **POST /api/app/onboarding/validate** — returns `valid`, `daysSinceLastRun`, `within45Days`.
- **POST /api/app/onboarding/mark-ready** — (OWNER/ADMIN) valid if last completed run is within 45 days.

---

## 11. Env vars (no secrets in repo)

| Var | Description |
|-----|-------------|
| `PORT` | Server port (default 4242) |
| `CLIENT_URL` | Frontend URL for Stripe redirects |
| `ADMIN_TOKEN` | Legacy admin Bearer token |
| `DB_PATH` | SQLite path (default `./data/app.db`) |
| `DB_PROVIDER` | `sqlite` (default) or `postgres` — future Supabase/Postgres |
| `DATABASE_URL` | Postgres connection string when `DB_PROVIDER=postgres` |
| `JWT_SECRET` | Signing secret for JWT |
| `JWT_EXPIRES_IN` | e.g. `7d` |
| `APP_ENCRYPTION_KEY` | **Required** for Customer APIs with HMAC/BEARER (min 32 chars); used to encrypt secrets at rest |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret |
| `STRIPE_SETUP_FEE_PRICE_ID` | Optional; Stripe Price ID for setup fee |
| `APP_URL` | Frontend URL for checkout redirects (default `CLIENT_URL`) |
| `API_BASE_URL` | Optional |

---

## 12. New endpoints (this release)

- **Customer APIs**: `GET/POST /api/app/customer-apis`, `PATCH/DELETE /api/app/customer-apis/:id`, `POST .../test-health`, `.../test-delete`, `.../test-status`, `.../rotate-secret`
- **Integrations summary**: `GET /api/app/integrations/summary` — `connectors`, `customerApis`, `counts`, `modeDetected`, `lastOnlineConnectorAt`, `lastHealthyCustomerApiAt`
- **Aliases**: `GET/PUT /api/app/cascade-policies` (legacy + v2), `POST /api/app/admin/dispatch` (body: `requestId`)
- **Cascade v2**: `GET/POST/PATCH/DELETE /api/app/cascade-policies` (v2: `targetType`/`targetId`), `GET/POST/DELETE /api/app/partners/targets`
- **Onboarding**: `GET /api/app/onboarding/status`, `POST /api/app/onboarding/validate`, `POST /api/app/onboarding/mark-ready`
- **Hash match**: `POST /api/app/hash-match/validate` (body: `subjectHash`, optional `sourceType`, `dryRun`) — returns `matchedTargets`, `cascadeCandidates`, `notes`
- **DSAR**: `POST /api/app/dsar/requests/:id/dispatch-cascade-test` — same as cascade dispatch-test for that request

---

## Criteria (back)

- Signup/login works; `org_id` is enforced on all app endpoints.
- Connector token is generated once and listed without exposing the secret.
- Heartbeat updates `connectors.last_heartbeat_at` and status.
- Hash recipes CRUD + activate.
- Partners, links, and cascade policies CRUD; dispatch-test creates PENDING cascade jobs (legacy + v2 with target_type/target_id).
- Agent can connect to DB, send heartbeat and events; backend exposes heartbeat, events, config.
- Stripe checkout and webhook set `setup_fee_paid_at`; portal returns URL.
- Audit packet export returns only hashes and events (no PII).
- Customer APIs CRUD, test-health/delete/status, rotate-secret; secrets encrypted at rest when APP_ENCRYPTION_KEY set.
- Onboarding status/validate/mark-ready; 45-day dry run cadence.
- Hash-match validate returns cascade candidates without PII.
- Stripe: checkout session with Zod payload; webhook idempotent via `stripe_events`; payments in `billing_payments`; GET checkout-session and GET public/pricing.

### Pending (recurring billing / subscriptions)

- Recurring subscriptions (Startup/Growth plans) not implemented; structure in `src/services/stripe/` (stripeClient, checkout, webhooks) is ready for expansion.
- Customer portal is implemented for existing customers; invoices and subscription management would be added in a future phase.

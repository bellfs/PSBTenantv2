# Guesty Short-Lets Agentic Integration

## What This Adds

Guesty is now treated as a first-class source system inside FFR Property OS. The platform stores:

- Guesty accounts and webhook registration metadata.
- Guesty listings mapped to FFR properties where possible.
- Guesty reservations with financial, guest, channel, date and status fields.
- Reservation versions so agents can see when a booking changed.
- Raw webhook deliveries for replay and evidence.
- Daily listing metrics for occupancy, gap nights, ADR, RevPAR and booked revenue.

## Environment Variables

Set these in Railway for live Guesty sync:

```txt
GUESTY_CLIENT_ID=
GUESTY_CLIENT_SECRET=
GUESTY_ACCOUNT_NAME=FFR Guesty
GUESTY_WEBHOOK_TOKEN=
GUESTY_SYNC_INTERVAL_MINUTES=60
```

Optional:

```txt
GUESTY_WEBHOOK_URL=https://maintenance.52oldelvet.com/api/guesty/webhook
GUESTY_FETCH_ON_WEBHOOK=true
```

`GUESTY_FETCH_ON_WEBHOOK=true` makes the webhook handler fetch the latest reservation from Guesty during webhook processing. Keep it off if you want faster webhook acknowledgements and rely on scheduled/manual sync for reconciliation.

## Platform Routes

- `GET /api/guesty/summary`
- `GET /api/guesty/accounts`
- `POST /api/guesty/accounts`
- `POST /api/guesty/sync`
- `POST /api/guesty/accounts/:id/sync`
- `POST /api/guesty/webhooks/register`
- `POST /api/guesty/webhook`
- `GET /api/guesty/listings`
- `GET /api/guesty/reservations`

## Team Surface

- `/short-lets` is the Short Lets control room.
- Today shows Guesty check-ins/check-outs, next-30-day occupancy, revenue and short-let alerts.
- Dashboard shows booked revenue, occupancy, gap nights, check-ins/check-outs and property-level STR performance.
- The Short-Let Operator agent now reads `wiki/short-lets/guesty.md` in Business Memory.

## Agent Guardrails

Agents can monitor, draft and recommend. Human approval is still required for:

- Guest-facing messages.
- Pricing or availability changes.
- Payment/refund/cancellation decisions.
- Access-code or key changes.
- Cleaner/linen instructions that commit spend or access.

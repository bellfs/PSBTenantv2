# FFR Property OS Build Plan

## Goal

Evolve the current PSB Maintenance Hub into a consolidated operating platform for PSB, PSB52 and FFR Group without breaking the existing maintenance build.

The core principle is additive migration:

1. Keep existing maintenance, tenant, compliance, utilities, inspection and finance modules live.
2. Add a shared agent/task/approval/event layer beside them.
3. Move workflows into the new layer one lane at a time.
4. Keep Codex agents in dry-run mode until each workflow is trusted.

## Non-Destructive Build Strategy

- Work on feature branches.
- Keep the current dashboard and API routes intact.
- Add new `/api/os` and `/api/agents` routes rather than rewriting existing routes.
- Add new tables with `CREATE TABLE IF NOT EXISTS`; do not mutate existing tables unless needed.
- Keep Codex agent execution dry-run by default.
- Require approvals for legal, access, rent, deposit, pricing, payment, contractor instruction and external message actions.
- Treat WhatsApp exports and live SQLite data as private source material, not repo seed data.

## Current Base

The existing app already includes:

- Properties and tenants
- Tenancies
- Maintenance issues and WhatsApp bot
- Contractors and quotes
- Compliance certificates and documents
- Utility readings, rates, alerts and fair usage
- Check-in/check-out inspections
- Bank accounts and transactions
- Copilot panel

This is enough to become an operating system rather than a rebuild.

## Pain Points Encoded From Team Context

- Operational memory sits in WhatsApp, voice notes, emails and spreadsheets.
- Job lists are discussed repeatedly because there is no single task source.
- Summer turnaround needs visible trade-offs between urgency, budget, compliance and tenant readiness.
- Contractor value needs tracking by day rate, job quality, responsiveness and evidence.
- Utility and supplier contracts need source-document discipline.
- Short-let operations need calendar, availability, Guesty/OTA, cleaning, linen and access coordination.
- Leasing needs lead, viewing, follow-up, contract, deposit and pricing state in one place.
- Compliance/legal responses need AI drafting but human approval.

## Platform Layers

### 1. Property Graph

Canonical entities:

- Property
- Unit/apartment/room
- Tenant
- Tenancy
- Guarantor
- Lead
- Viewing
- Contract
- Deposit
- Issue
- Contractor
- Quote
- Invoice
- Certificate
- Document
- Meter
- Utility contract
- Booking
- Cleaning task
- Development project
- Deal

### 2. Event Log

Every important business event should become an `agent_events` record:

- Tenant message received
- Issue created
- Certificate uploaded
- Contractor chased
- Invoice received
- Viewing booked
- Contract sent
- Deposit paid
- Booking created
- Calendar changed
- Utility bill uploaded
- Approval requested

### 3. Tasks

All operational work should become an `agent_tasks` record with:

- Domain
- Priority
- Due date
- Owner
- Source
- Linked property/tenant/issue
- Status

### 4. Approvals

Actions requiring approval:

- External tenant/staff/contractor messages
- Legal/compliance-sensitive replies
- Rent or deposit positions
- Access notices
- Pricing changes
- Calendar opening/closure
- Supplier contract acceptance
- Contractor instruction above threshold
- Bank/payment actions

### 5. Codex Agent Runner

Agents run through local Codex CLI:

- Dry-run default
- Read-only sandbox default
- Structured prompt with guardrails
- Full audit trail in `agent_runs`
- Execution only when `CODEX_AGENT_MODE=execute`

Codex can also launch platform agents through the local bridge:

```bash
npm run agent -- list
npm run agent -- health
npm run agent -- run compliance_guardian "Check certificates expiring in 60 days"
npm run agent -- intake:whatsapp "/Users/fergusbell/Downloads/_chat 26.txt" team_group
```

The bridge calls the FFR OS API, so runs are still recorded in `agent_runs` and visible in the Agents page. It uses `FFR_OS_TOKEN` if supplied, or logs in with `FFR_OS_EMAIL` and `FFR_OS_PASSWORD`.

## WhatsApp Group Chat Reality

The official WhatsApp Business Cloud API is suitable for the tenant-facing bot and direct business-number messaging, but it is not a clean way to add a bot into an existing private team group chat and read every message as a group participant.

Practical options:

- Import WhatsApp `.txt` exports into Intake.
- Forward important group messages to the business bot number.
- Move operating chatter that needs live bot participation into Slack or Teams.
- Keep WhatsApp for human conversation, but make FFR OS the source of truth by converting messages into tasks, approvals and agent triggers.

## Agent Registry

Initial agents:

- Ops Copilot
- Maintenance Triage Agent
- Compliance Guardian
- Leasing & Revenue Agent
- Turnaround Orchestrator
- Contractor Value Agent
- Finance Reconciler
- Utilities Procurement Agent
- Short-Let Operator
- Development & Deals Agent

## Implementation Phases

### Phase 1: Foundation

- Add FFR OS overview page.
- Add agent registry page.
- Add agent run/task/approval/event tables.
- Add Codex dry-run runner.
- Add API routes for overview and agents.
- Add security cleanup for local data and repo hygiene.
- Add Admin Email Agent for inbox sync, draft replies, reminders and daily brief.

### Phase 2: Intake

- Convert WhatsApp exports into structured task/event imports.
- Add email-to-task classification through the Admin Email Agent.
- Add document intake for contracts, invoices, certificates and supplier bills.
- Add source linking so every task has evidence.

## Admin Email Agent

The Admin Email Agent is registered as `admin_email_agent` in the Codex agent registry and also runs as a platform service over connected email accounts.

Default inbox:

- `admin@52oldelvet.com`

Default team report recipients:

- `andy@52oldelvet.com`
- `akiel@52oldelvet.com`
- `hannah@52oldelvet.com`
- `fergus@fiftytwo-group.com`

Capabilities:

- Sync the connected admin inbox from Settings.
- Classify incoming email by operating domain.
- Create follow-up tasks for the likely owner.
- Draft replies into an approval queue.
- Require approval before sending replies.
- Generate and send an end-of-day team brief.

Useful commands:

```bash
npm run agent -- email:run
npm run agent -- email:report
npm run agent -- email:report --send
npm run agent -- run admin_email_agent "Review today's admin inbox and team follow-ups"
```

Configuration:

- `EMAIL_AGENT_INBOX=admin@52oldelvet.com`
- `EMAIL_AGENT_TEAM_RECIPIENTS=andy@52oldelvet.com,akiel@52oldelvet.com,hannah@52oldelvet.com,fergus@fiftytwo-group.com`
- `EMAIL_AGENT_DAILY_REPORT_ENABLED=true`
- `EMAIL_AGENT_REPORT_HOUR=17`
- `EMAIL_AGENT_REPORT_MINUTE=30`
- `EMAIL_AGENT_TIMEZONE=Europe/London`
- Scheduled reports wait until the configured admin inbox is connected unless `EMAIL_AGENT_SEND_EMPTY_REPORTS=true`.

### Phase 3: Leasing

- Add leads, viewings, reservations and contract status.
- Add StuRents/Squarespace/WhatsApp/manual enquiry intake.
- Add viewing reminders and post-viewing follow-ups.
- Add contract/deposit chase workflows.
- Add pricing and availability board.

### Phase 4: Turnaround

- Add traffic-light job lists.
- Add property readiness score.
- Add contractor/day-rate work planning.
- Add cleaning, keys, access, photos and handover workflows.
- Add cost-to-complete by property.

### Phase 5: Compliance

- Expand certs into a per-property requirement matrix.
- Add HMO/fire/EPC/EICR/gas/deposit/access evidence packs.
- Add deadline alerts.
- Add compliance-sensitive reply drafting with approval.

### Phase 6: Finance, Utilities, Contractors

- Add invoice intake and matching.
- Add rent/deposit reconciliation.
- Add utility contract tracker.
- Add supplier dispute timeline.
- Add contractor scorecards.
- Add monthly property P&L.

### Phase 7: Short Lets

- Add bookings, channels, availability and calendar state.
- Add Guesty/OTA integration hooks.
- Add cleaning/linen/access task generation.
- Add net income target tracking.
- Add owner-use conflict checks.

### Phase 8: Development & Capital

- Add deals and acquisition pipeline.
- Add planning/heritage document tracker.
- Add capex and cost-to-complete.
- Add lender/investor pack generation.

## Safety Rules

- Never store raw WhatsApp exports in the repo.
- Never hard-code live tenant data in source.
- Never auto-send legal, rent, deposit, supplier or contractor messages.
- Never auto-approve payments.
- Never allow Codex execution mode in production until role permissions and audit logs are reviewed.

## Environment Flags

```bash
CODEX_AGENT_MODE=dry_run
CODEX_AGENT_SANDBOX=read-only
CODEX_AGENT_MODEL=gpt-5.2
CODEX_AGENT_TIMEOUT_MS=120000
```

To execute agents intentionally:

```bash
CODEX_AGENT_MODE=execute
```

Execution should remain read-only for analysis agents unless a specific implementation workflow has been reviewed.

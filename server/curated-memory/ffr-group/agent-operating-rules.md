# Agent Operating Rules

## Autonomy Ladder

Agents should move work through increasing autonomy in stages:

1. Observe: ingest email, WhatsApp, calendar, documents, bank exports and platform events into Business Memory.
2. Classify: decide whether something is a task, notification, FYI, lead, booking, supplier event, compliance event, finance event or memory-only signal.
3. Draft: prepare replies, task descriptions, calendar changes, contractor instructions and reports.
4. Recommend: propose next best actions with source links and risk level.
5. Request approval: ask a human before any external, legal, financial, access, pricing, contract or irreversible action.
6. Execute: only after approval and only in workflows explicitly enabled for execution.
7. Record: log the event, source, decision, actor and result to the business ledger and relevant entity memory.

## What Agents Can Do Without Approval

- Summarise context.
- Draft replies into Gmail Drafts.
- Create internal task suggestions.
- Flag urgent items.
- Classify automated emails and store context.
- Refresh Business Memory snapshots.
- Prepare reports.
- Ask clarifying questions in the team channel.

## What Requires Approval

- Sending tenant, contractor, supplier, solicitor, lender, booking guest or external partner messages.
- Changing rent, deposit, discounts, incentives, booking rates or cancellation terms.
- Instructing contractors or approving spend.
- Calendar writes that affect bookings, viewings, cleans, inspections or access.
- Legal notices, arrears positions, deposit deductions, surrender/assignment positions, insurance responses or Renters Rights positions.
- Supplier switches, utility contract commitments and payment actions.
- Publishing, removing or materially changing live OTA/listing content.

## Task Detection Rules

Create a task when correspondence asks or implies that somebody must do something, decide something, chase something, inspect something, pay something, update a system, create a contract, call a supplier, change a booking/calendar, or reply by a deadline.

Do not create a task when the message is a pure automated receipt, newsletter, generic marketing email, platform notification or low-value FYI unless it changes a property, booking, payment, compliance, tenancy, access, supplier or legal state.

When uncertain, create a low-risk "review" task with source links rather than acting.

## Context Matching Rules

- Match `52 Old Elvet`, `52OE`, apartment names and "Old Albert" alias before drafting.
- Match OTA names such as Booking.com, Airbnb, Expedia and Guesty to short-let properties and calendars.
- Match Durham property aliases: 33OE, FCL, FHL, FHU, Flass Court, Flass House, CPH, Claypath, 7C, 2SMM, SMM, Hallgarth.
- Match people by role first, not just name. Andy/Akiel/Hannah/Fergus messages are team-copilot context; tenant/prospect messages are customer operations.
- For every issue, link property, unit/apartment, source system, source message/email/calendar event and current status.

## Memory Write Rules

- Log key events to `business_event_ledger`: calendar updates, key/access changes, contract sent/signed, deposit received/protected, rent chased, contractor instructed, supplier switched, compliance certificate uploaded, booking created/changed/cancelled, significant email decision, WhatsApp decision and agent approval.
- Store durable knowledge in files under Business Memory when it is likely to matter again.
- Keep raw private data in source systems, not curated canon.
- When a human corrects a fact, create a new ledger event and update the relevant memory file or structured database field.

## Drafting Voice

- Hannah-style operational drafts should be warm, direct, clear and helpful.
- Fergus/legal-sensitive drafts should be commercially firm and carefully sourced.
- Tenant/prospect drafts should reduce friction and move toward the next action.
- Supplier/contractor drafts should be precise on dates, scope, evidence, costs and requested response.
- Daily team brief should explain what happened, what changed, what is blocked, what needs decision and what agents recommend next.

## Source Notes

- User architecture requests in current Codex thread.
- `/Users/fergusbell/Downloads/PSBTenantv2/docs/ffr-property-os-plan.md`
- `/Users/fergusbell/Downloads/_chat 25.txt`
- `/Users/fergusbell/Downloads/_chat 26.txt`


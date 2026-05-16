# Systems, Communications and AI

## Email and Inbox Context

- `admin@52oldelvet.com` is the primary 52 Old Elvet admin inbox.
- `info@psb.properties`, `hannah@psb.properties` and alias `hannah.winn@psb.properties` are PSB/FFR operating email context.
- Zoho has been used for PSB mail. IMAP is enabled/needed for long-running sync.
- Gmail/OAuth is used or desired so the email agent can create Gmail drafts and pull long-term context.
- Fyxer was evaluated and was useful when working, especially for `admin@`, but it could miss drafting and move emails into folders unexpectedly.
- The platform must support multiple connected Gmail/email accounts per logged-in user, with only that user authorising their own account.

## Email Agent Rules

- The admin email agent should draft replies into the connected Gmail Drafts folder for every email that genuinely needs a reply.
- It should classify emails into: needs reply/action, automated notification, FYI/context, supplier/utility, booking/OTA, tenancy/legal, finance/payment, maintenance, calendar/scheduling.
- It should use Business Memory context from emails, WhatsApp, property records, ledgers and calendar before drafting.
- It must not send without explicit approval.
- It should produce an end-of-day team report for Andy, Akiel, Hannah and Fergus, with actual context: urgent replies, unresolved maintenance, new leads, booking/calendar changes, supplier issues, finance/admin blockers and what changed in memory.
- It should detect automated emails and ingest them as context without creating noisy tasks unless they imply a required action.

## WhatsApp Context

- WhatsApp remains a core human operating channel, but private group chats are not a clean live-bot source through the official WhatsApp Business Cloud API.
- Practical workflow: import WhatsApp `.txt` exports, forward important messages to the bot, or move bot-native workflows into FFR OS/Slack/Teams if live group participation is required.
- The platform should still treat messages from Fergus, Andy, Akiel and Hannah differently from tenant reports: for core team members the WhatsApp AI should behave like an operating copilot, able to answer from Business Memory, propose actions and ask whether to trigger an agent.
- Tenant-facing WhatsApp remains a maintenance intake and triage channel.

## Calendar Context

- Google Calendar integration should be a source of record for viewings, cleans, short-let stays, inspections, contractor appointments, move-ins, move-outs, compliance checks, utility appointments and key events.
- Every calendar event and meaningful update should also be logged to the business event ledger so future agents can reconstruct decisions and timelines.
- Shared calendar access requires Google OAuth scopes for calendar read/sync and any write scopes only where the platform is intended to create or update events.

## AI and Codex Operating Context

- Codex is the agent runner. Platform agents should be launchable from the UI and from Codex CLI through `scripts/ffr-agent.js`.
- Railway/live execution requires Codex CLI availability or `CODEX_BIN` configured. If unavailable, agent runs can prepare prompts/dry runs but cannot execute live Codex.
- Agent runs must be logged in `agent_runs`, with prompts, dry-run/execute mode, result and approval requirements.
- Keep dry-run as default until a workflow has proven safe.
- Store agent output and task decisions back into Business Memory/ledger rather than leaving them in ephemeral chat.

## Key Tools Mentioned Across Context

- Calendly: viewing booking, reminders, follow-up.
- Whelp / Omni Inbox: comms consolidation / live chat idea.
- Claude/ChatGPT/Codex: inbox and document retrieval, drafting, agentic workflows.
- Fyxer: email assistant, especially Gmail-like workflows.
- Zoho: PSB email.
- Pleo: maintenance/team card spend wallet.
- Wise: PSB52 rents/payment context.
- Tide: PSB52 secondary/lease payment context.
- Starling: FFR banking context.
- Signable/DocuSign/e-sign: contract signing context.
- August, Tyten, Fixflo: property/maintenance tooling candidates.
- Guesty, Booking.com, Airbnb, Expedia, OpenRent: short-let/listing channels.
- Google Drive: document store for policies, certificates, contracts, source docs.

## Source Notes

- `/Users/fergusbell/Downloads/_chat 25.txt`
- `/Users/fergusbell/Downloads/_chat 26.txt`
- `/Users/fergusbell/Downloads/PSBTenantv2/docs/ffr-property-os-plan.md`
- `Ffr Group & 52 Old Elvet - Definitive Operating Manual (for Hannah).docx`


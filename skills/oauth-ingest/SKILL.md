---
name: oauth-ingest
version: 1.0.0
description: |
  Refine raw context-memory pulled from OAuth-connected services (Gmail, Slack,
  Notion, GitHub, Linear, Google Calendar, …) into proper brainpages. The
  ContextBridge module (@contextbridge/core) connects services via one-click
  OAuth and walks each active connection every ~20 minutes, landing new items as
  `type: oauth-raw` pages via put_page. This skill is the second tier: it routes
  each raw page to the right refining skill, then retypes it so it isn't
  reprocessed.
triggers:
  - "process oauth pages"
  - "refine oauth-raw"
  - "ingest pulled email"
  - "process connected service data"
  - "oauth ingest"
tools:
  - query
  - put_page
  - add_timeline_entry
  - add_link
  - log_ingest
mutating: true
---

# OAuth Ingest (router)

## What this is

`@contextbridge/core` is a standalone module that owns the "118+ integrations +
20-minute auto-pull" capability: one-click OAuth into Gmail / Slack / Notion /
GitHub / Linear / Calendar / … via Composio (direct mode), each connection
exposed to an agent as typed tools, and a periodic pull loop that lands new
items into a pluggable sink. Its default sink (`GbrainSink`) writes each pulled
item as a `type: oauth-raw` brainpage with honest provenance
(`source_kind: oauth-pull`, `source_uri: <message-id|permalink>`,
`ingested_via: contextbridge:<toolkit>`).

The puller does NO LLM-shaped work — it only normalizes structure. This skill is
where the enrichment happens: turn each raw page into the right kind of
brainpage by dispatching to an existing skill.

## Contract

This skill guarantees:
- Every `type: oauth-raw` page is routed to exactly one refining skill (per the
  provider map) and then retyped to its final form (so it is processed once).
- Entity back-references are created (Iron Law: each mentioned person/company
  page gets a back-link) — delegated to the refining skill.
- Provenance is preserved: the refined page keeps the original `source_uri` /
  `source_kind` so the audit trail survives.
- Idempotency: slugs are deterministic (`emails/YYYY-MM/…`, `meetings/…`,
  `messages/slack/…`), so re-processing upserts rather than duplicates.

## Phases

1. **Select raw pages.** Find unprocessed pulled items:
   `gbrain query --type oauth-raw` (optionally `--source oauth`). Each carries
   frontmatter: `provider`, `kind`, `external_id`, `suggested_skill`,
   `participants`, `occurred_at`, `source_uri`.

2. **Route by `suggested_skill`** (set by the ContextBridge provider adapter;
   see `PROVIDER-MAP.md` for the full table). If absent, fall back to the
   provider → skill mapping in `PROVIDER-MAP.md`.

3. **Dispatch to the refining skill** for each page:
   - Gmail thread (multiple human participants) / Calendar event →
     `skills/meeting-ingestion/SKILL.md` (creates `meetings/…`, enriches each
     attendee, merges a timeline entry onto every entity).
   - Gmail single-party / GitHub / Linear / Jira / Stripe →
     `skills/webhook-transforms/SKILL.md` (event → page + entities + timeline).
   - Slack → `skills/signal-detector/SKILL.md` (ambient entity/idea capture).
   - Notion / Drive doc → `skills/media-ingest/SKILL.md` (document → page).
   - Contacts / people surfaces → `skills/enrich/SKILL.md` (deepen the entity).

4. **Retype the raw page.** After the refining skill has produced the proper
   brainpage(s), set the raw page's `type` away from `oauth-raw` (e.g.
   `email`, `meeting`, `message`, `issue`, `processed`) via `put_page` so step 1
   won't pick it up again. Keep `source_uri` / `source_kind`.

5. **Log the batch.** `log_ingest` with `source_type: oauth-ingest`,
   `source_ref: <run-id>`, `pages_updated: [...]`, a one-line summary.

## Preconditions

- A GBrain **source** for pulled data exists. Default is `oauth`:
  `gbrain sources add oauth` (or write into `default`). The ContextBridge
  `GbrainSink` is constructed with this `sourceId`.
- The ContextBridge puller is running (or `pull --once` was invoked) so
  `type: oauth-raw` pages exist to refine.

## Notes

- This skill is tool-agnostic markdown; it is invoked by an agent or a cron job
  after a pull, NOT called in-process by the puller. The puller's only GBrain
  contract is `put_page` + `log_ingest` (see `@contextbridge/core` `GbrainSink`).
- Direct-mode Composio is sync-only (no real-time trigger webhooks), so this
  skill always operates on the periodic-pull output, never on push events.

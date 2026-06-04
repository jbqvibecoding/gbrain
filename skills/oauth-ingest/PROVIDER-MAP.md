# OAuth Provider → Refining Skill Map

The ContextBridge puller (`@contextbridge/core`) lands each pulled item as a
`type: oauth-raw` brainpage and stamps a `suggested_skill` in the frontmatter.
This table is the source of truth for that suggestion and for the fallback
routing when `suggested_skill` is absent.

| Provider (toolkit) | Item kind | `suggested_skill` | Why |
|---|---|---|---|
| `gmail` (≥3 participants) | email thread | `meeting-ingestion` | thread → `meetings/` + attendee enrichment + timeline |
| `gmail` (1–2 participants) | email | `webhook-transforms` | single-party mail → page + entities + timeline |
| `googlecalendar` | event | `meeting-ingestion` | event → `meetings/YYYY-MM-DD/…` + attendee enrichment |
| `slack` | message | `signal-detector` | ambient entity/idea capture from chatter |
| `notion` | page | `media-ingest` | document body → page |
| `googledrive` | doc | `media-ingest` | document body → page |
| `github` | issue/PR | `webhook-transforms` | issue/PR event → page + entities + timeline |
| `linear` | issue | `webhook-transforms` | issue event → page + entities + timeline |
| `jira` | issue | `webhook-transforms` | issue event → page + entities + timeline |
| `stripe` | event | `webhook-transforms` → `data-research` | financial event → tracker page |
| contacts / people surfaces | person | `enrich` | deepen the person/company page |

## Slug conventions (deterministic → idempotent upsert)

GBrain's page key is `(source_id, slug)`, so deterministic slugs make re-pulls
upsert instead of duplicate. The puller computes these (`src/sink/slug.ts`):

| Provider | Slug |
|---|---|
| gmail | `emails/{YYYY-MM}/{external_id}` |
| slack | `messages/slack/{external_id}` |
| googlecalendar | `meetings/{YYYY-MM-DD}/{external_id}` |
| notion | `notion/{external_id}` |
| googledrive | `docs/{external_id}` |
| github / linear / jira | `issues/{toolkit}/{external_id}` |
| stripe | `stripe/{external_id}` |
| (other) | `{toolkit}/{external_id}` |

## Provenance (always preserved)

Every raw page carries:

- `source_kind: oauth-pull`
- `source_uri: <message-id | permalink | provider-native id>`
- `ingested_via: contextbridge:<toolkit>`

When the refining skill produces the final brainpage(s), keep these fields so
the audit trail (who/where this came from) survives the transformation.

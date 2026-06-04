# @contextbridge/core

**Standalone OAuth-integrations + 20-minute auto-pull module.**

One-click OAuth into 118+ third-party services (Gmail, Notion, GitHub, Slack,
Stripe, Calendar, Drive, Linear, Jira, …) via [Composio](https://composio.dev)
in **direct mode** (bring your own Composio API key). Each connection is exposed
to an agent as **typed tools**, and a periodic loop walks every active
connection every ~20 minutes, pulling new data into a **pluggable sink** — no
prompts, no hand-written polling loops.

This is the OpenHuman "118+ integrations + auto-pull" capability, **extracted as
a reusable, standalone module** so it can be dropped into any product. The
default sink lands pulled context-memory as **GBrain brainpages**.

## Why it's standalone

OpenHuman's Composio domain is coupled to its backend proxy, event bus, agent
harness, and an internal `memory_tree`. ContextBridge depends on **none** of
that. It talks to Composio v3 directly with your own key (`HttpComposioClient`),
and reaches its destination only through a narrow `IngestSink` interface.

**Trade-off:** direct mode is **sync-only**. Composio trigger webhooks are
HMAC-verified by a backend and never reach a direct client, so ContextBridge
ships the periodic *pull* loop (exactly the "every 20 minutes" feature), not
real-time push.

## Architecture

```
@contextbridge/core
├── connections   — OAuth connect / catalog (118+) / list / delete / waitForActive
├── tools         — typed tools exposed to an agent (scope-gated read/write/admin)
├── puller        — the 20-minute auto-pull loop + portable SyncState (cursor/dedup/budget)
└── sink          — IngestSink interface + GbrainSink default impl
```

The pull loop, `SyncState` (cursor watermark, dedup set, daily request budget),
and the provider adapters are ported from OpenHuman's
`src/openhuman/composio/{periodic,providers/sync_state,providers/*}.rs`. In this
architecture **GBrain does the enrichment**, so the adapters do only light
structural normalization (e.g. HTML→text for email bodies).

## Quick start

```ts
import { ContextBridge } from '@contextbridge/core';
import { openGbrainSink } from '@contextbridge/core/sink/gbrain';

// 1. Open the default GBrain sink (embedded PGLite brain, source "oauth").
//    Run `gbrain sources add oauth` first, or use sourceId "default".
const { sink, close } = await openGbrainSink({ engine: 'pglite', sourceId: 'oauth' });

// 2. Build the bridge with a direct-mode Composio key + the sink.
const bridge = new ContextBridge({
  composio: { apiKey: process.env.COMPOSIO_API_KEY! },
  sink,
});

// 3. One-click OAuth.
const { connectUrl, connectionId } = await bridge.connections.authorize('gmail');
//    → open connectUrl in a browser, then:
await bridge.connections.waitForActive(connectionId);

// 4. Typed tools for your agent (read-only by default).
const tools = await bridge.tools.toAnthropicTools({ maxScope: 'read' });

// 5. Start the 20-minute auto-pull → brainpages.
bridge.puller.start();
// ...later: bridge.puller.stop(); await close();
```

### Run a single pull tick (e.g. a cron job)

```ts
const report = await bridge.puller.runOneTick();
console.log(report); // { considered, fired, connections: [...] }
```

## The GBrain bridge

`GbrainSink` writes each pulled item as a `type: oauth-raw` brainpage via
`put_page`, with honest provenance — `source_kind: oauth-pull`,
`source_uri: <message-id|permalink>`, `ingested_via: contextbridge:<toolkit>` —
plus one `log_ingest` per batch. It runs **in-process with `remote: false`**,
the only mode under which GBrain honors client-supplied provenance.

A second tier, the GBrain **`oauth-ingest` skill**, refines each raw page into a
proper brainpage by routing to the right skill (Gmail/Calendar →
`meeting-ingestion`, Slack → `signal-detector`, GitHub/Linear → `webhook-transforms`,
Notion/Drive → `media-ingest`). See `gbrain/skills/oauth-ingest/`.

### Custom sinks

Implement `IngestSink` to send pulled data anywhere:

```ts
import type { IngestSink, IngestItem, SinkBatchContext } from '@contextbridge/core';

class MySink implements IngestSink {
  async writeBatch(items: IngestItem[], ctx: SinkBatchContext) {
    // ...your destination...
    return { pagesUpserted: items.map((i) => i.externalId), summary: `${items.length} items` };
  }
}
```

## Providers with a native pull adapter

`gmail`, `googlecalendar`, `slack`, `notion`, `github`, `linear`. Every other
toolkit in the live catalog is still connectable and exposed as typed tools; add
a `ProviderAdapter` (or a `GenericAdapter` config) to bring it into the pull loop.

## Develop

```bash
bun test            # unit + PGLite integration
bunx tsc --noEmit   # typecheck
```

The repo-coupling to GBrain is isolated to a single `@ts-nocheck` module,
`src/gbrain/runtime.ts`. To extract ContextBridge into its own repo, swap its
three relative imports for the published `gbrain/*` package subpaths.

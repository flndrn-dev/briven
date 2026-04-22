# @briven/realtime — reactive query WebSocket service

per `CLAUDE.md §7.4`:

1. client calls `useQuery("getPosts", { userId })`
2. SDK sends query name + args to realtime over WebSocket
3. realtime computes a query hash, checks cache
4. on miss: invokes query via runtime, caches, returns
5. realtime subscribes to Postgres `LISTEN` channels for every table touched
6. on `NOTIFY` (auto-generated triggers), recompute and push deltas to subscribed clients
7. subscriptions expire when client disconnects

**status: skeleton.** lands Phase 2 month 1 per `docs/BUILD_PLAN.md`.

year-one scale target: 10,000 concurrent subscriptions. migrate to logical replication + WAL streaming if this becomes a bottleneck.

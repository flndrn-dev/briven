/**
 * @briven/client — framework-agnostic JavaScript client.
 *
 * Status: skeleton. First usable version lands in Phase 1 week 7-8 per
 * BUILD_PLAN.md, with a non-reactive `query` + `mutation` over HTTP. The
 * reactive WebSocket transport lands with `apps/realtime` in Phase 2.
 */
export function createClient(options) {
    return {
        options,
        async query() {
            throw new Error('briven-client.query: not implemented — scheduled for Phase 1 week 7-8');
        },
        async mutation() {
            throw new Error('briven-client.mutation: not implemented — scheduled for Phase 1 week 7-8');
        },
    };
}
//# sourceMappingURL=index.js.map
/**
 * @briven/client — framework-agnostic browser client for briven projects.
 *
 *   const briven = createBrivenClient({
 *     projectId: 'p_...',
 *     apiOrigin: 'https://api.briven.cloud',
 *     wsOrigin: 'wss://ws.briven.cloud',
 *   });
 *
 *   const notes = await briven.invoke('listNotes');
 *
 *   const sub = briven.subscribe('listNotes', { userId: 'u_...' }, (frame) => {
 *     console.log(frame.value);
 *   });
 *   // sub.close() when done
 */
export interface BrivenClientOptions {
    /** Briven project id (`p_...`). Required. */
    readonly projectId: string;
    /** REST control plane origin, e.g. `https://api.briven.cloud`. */
    readonly apiOrigin: string;
    /** WebSocket origin for reactive queries, e.g. `wss://ws.briven.cloud`. */
    readonly wsOrigin?: string;
    /** Session token / api key forwarded as `Authorization: Bearer <token>`. */
    readonly token?: string | (() => string | Promise<string>);
    /** Auto-reconnect after a transient disconnect. Default: true. */
    readonly reconnect?: boolean;
}
export type InvokeFrame = {
    ok: true;
    value: unknown;
    durationMs: number;
    deploymentId?: string;
} | {
    ok: false;
    code: string;
    message: string;
    durationMs: number;
};
export interface SubscribeHandle {
    readonly subscriptionId: string;
    /** Unsubscribe and stop receiving frames. Idempotent. */
    close(): void;
}
export interface BrivenClient {
    /** One-shot invoke over HTTP. */
    invoke(functionName: string, args?: unknown): Promise<InvokeFrame>;
    /** Subscribe to a function. The handler is called once on initial value
     *  and again every time the touched tables change. */
    subscribe(functionName: string, args: unknown, handler: (frame: InvokeFrame) => void): SubscribeHandle;
    /** Force-close all subscriptions and the underlying socket. */
    close(): void;
}
export declare function createBrivenClient(options: BrivenClientOptions): BrivenClient;
//# sourceMappingURL=index.d.ts.map
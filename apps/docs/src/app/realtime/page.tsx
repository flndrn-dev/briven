import Link from 'next/link';

import { DocsShell } from '../../components/shell';

export const metadata = { title: 'realtime' };

function Snippet({ children }: { children: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-4 font-mono text-xs text-[var(--color-code-text)]">
      <code>{children}</code>
    </pre>
  );
}

export default function RealtimePage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">realtime</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        every <code>query()</code> function is reactive by default. clients subscribe over
        a WebSocket; when the rows your query touched change, the server re-invokes the
        function and pushes the new result. no extra code on your side — write a normal
        SQL query and the platform handles the rest.
      </p>

      <section className="mt-8">
        <h2 className="font-mono text-lg tracking-tight">how it works</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 font-mono text-sm text-[var(--color-text-muted)]">
          <li>
            <strong>subscribe</strong> — the client opens a WS to{' '}
            <code>wss://api.briven.tech/v1/projects/&lt;id&gt;/realtime</code>, sends{' '}
            <code>{`{ type: 'subscribe', function, args }`}</code>, receives the initial
            result + a subscription id.
          </li>
          <li>
            <strong>register</strong> — the platform invokes the query once, captures the
            list of tables it touched (e.g. <code>['posts', 'users']</code>), and stores
            the subscription under those table keys.
          </li>
          <li>
            <strong>notify</strong> — every <code>mutation()</code> publishes the tables it
            wrote to via Postgres LISTEN/NOTIFY. the realtime service hears the NOTIFY and
            looks up every subscription that touched that table.
          </li>
          <li>
            <strong>re-invoke + push</strong> — the platform re-runs each matching
            subscription with the original args, diffs against the last sent result, and
            pushes a <code>{`{ type: 'result' }`}</code> frame only when the value changed.
          </li>
          <li>
            <strong>unsubscribe</strong> — the client sends{' '}
            <code>{`{ type: 'unsubscribe', id }`}</code> or just closes the socket. the
            server cleans up subscription state and UNLISTENs when no subscriber remains
            for a table.
          </li>
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-lg tracking-tight">touched-tables tracking</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          the runtime instruments <code>ctx.db</code> and records every table the query
          read from. the list is stored on the invocation envelope (visible in the
          dashboard logs tab as &quot;touched&quot;) and used to register the subscription.
          you can&apos;t opt out — every table you read becomes a re-invoke trigger.
        </p>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          for very hot tables you don&apos;t actually want to subscribe to (e.g. an
          audit-log read inside an otherwise stable query), consider splitting that read
          into a separate action() call so it doesn&apos;t register the subscription.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-lg tracking-tight">when not to use it</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          realtime carries a cost — every active subscription holds an open WS and a
          server-side subscription record. for one-shot reads (e.g. a page that loads data
          once on navigation), call the function via HTTP invoke instead:
        </p>
        <Snippet>{`POST https://api.briven.tech/v1/projects/p_xxx/invoke
Authorization: Bearer brk_xxx
Content-Type: application/json

{ "function": "getStaticPage", "args": { "slug": "about" } }`}</Snippet>
        <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
          the SDK clients (<code>useQuery</code> et al) always subscribe — pass{' '}
          <code>{`{ reactive: false }`}</code> to make them one-shot HTTP calls instead.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-lg tracking-tight">concurrency limits</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          concurrent subscription caps live on your tier. free: 100 concurrent. pro: 1,000.
          team: 10,000. the limit is per-project, not per-user — adjust your client&apos;s
          subscription pattern if many users will be online simultaneously.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-lg tracking-tight">debugging</h2>
        <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 font-mono text-sm text-[var(--color-text-muted)]">
          <li>
            <strong>dashboard logs tab</strong> — filter by your query function name; the{' '}
            <em>touched</em> field shows which tables the platform registered.
          </li>
          <li>
            <strong>per-function stats</strong> — count + p50/p99 over the last 24h on the
            functions tab. high count + flat p99 = you have a chatty subscription.
          </li>
          <li>
            <strong>prometheus</strong> — <code>briven_realtime_active_subs</code> +{' '}
            <code>briven_realtime_active_channels</code> if you self-host; the operator
            grafana dashboard has both as graphs.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-lg tracking-tight">protocol reference</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          the SDK wraps this; you only need to know it if you&apos;re writing your own
          client. JSON-over-WS, no binary frames.
        </p>
        <Snippet>{`// → client
{ "type": "subscribe", "function": "listTodos", "args": { "filter": "open" } }

// ← server (initial)
{ "type": "result", "id": "sub_01HZ…", "data": [{ "id": "td_…", "body": "ship realtime" }] }

// ← server (push, fires whenever the result diffs)
{ "type": "result", "id": "sub_01HZ…", "data": [...] }

// → client (terminate)
{ "type": "unsubscribe", "id": "sub_01HZ…" }`}</Snippet>
      </section>

      <p className="mt-10 font-mono text-xs text-[var(--color-text-subtle)]">
        see also:{' '}
        <Link href="/functions" className="text-[var(--color-text-link)] underline-offset-2 hover:underline">
          functions
        </Link>{' '}
        ·{' '}
        <Link href="/sdks" className="text-[var(--color-text-link)] underline-offset-2 hover:underline">
          client sdks
        </Link>{' '}
        ·{' '}
        <Link href="/api" className="text-[var(--color-text-link)] underline-offset-2 hover:underline">
          http api
        </Link>
      </p>
    </DocsShell>
  );
}

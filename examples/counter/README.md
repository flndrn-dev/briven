# counter

the smallest possible briven app — one table, two functions, demonstrates the
reactive query pipeline end-to-end without any UI complexity.

## what's in here

```
counter/
├─ briven.json              project descriptor (filled by `briven link`)
├─ briven/
│  ├─ schema.ts             one table: counters (id, count)
│  └─ functions/
│     ├─ getCount.ts        reactive query · returns {id, count}
│     └─ increment.ts       mutation · upserts +1, returns new count
└─ README.md                you are here
```

## try it in 30 seconds

```sh
# 1. authenticate (skip if you already have credentials stored)
briven login --project p_<id> --key brk_<...>

# 2. copy, link, deploy
cp -r examples/counter my-counter
cd my-counter
briven link
briven deploy

# 3. exercise the api
briven invoke getCount
briven invoke increment
briven invoke increment --body '{"by":5}'
briven invoke getCount
```

## react client

```tsx
import { BrivenProvider, useMutation, useQuery } from '@briven/react';

function App() {
  return (
    <BrivenProvider config={{ projectId: 'p_<id>', apiKey: 'brk_<...>' }}>
      <Counter />
    </BrivenProvider>
  );
}

function Counter() {
  const { data } = useQuery('getCount', {});
  const inc = useMutation('increment');
  return (
    <button onClick={() => inc({})}>
      count: {data?.count ?? '…'}
    </button>
  );
}
```

`useQuery('getCount')` subscribes to the `counters` table. When `increment`
commits its UPDATE, postgres NOTIFY fires, the realtime service re-invokes the
query, and every subscribed button re-renders with the new count.

Two browser windows side by side make the reactive nature obvious — increment
in one, watch the other refresh in real time.

## next steps

- per-user counters: extend `increment` to read `ctx.auth.userId` and use that
  as the counter id, so each signed-in user has their own row
- rate limit: the existing project rate-limit middleware already caps invokes
  per-tier; for stricter per-user limits, gate inside the mutation handler

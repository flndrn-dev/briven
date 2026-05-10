# todo-app

the canonical briven hello-world. one table, four mutations, one reactive query, and a tiny react client. demonstrates:

- schema with default values + nullable columns
- input validation throwing `brivenError`
- ULID generation via `@briven/shared`
- a reactive `listTodos` query that the react client subscribes to

## what's in here

```
todo-app/
├─ briven.json              project descriptor (filled by `briven link`)
├─ briven/
│  ├─ schema.ts             one table: todos
│  └─ functions/
│     ├─ listTodos.ts       reactive query · accepts {filter: 'open'|'done'|'all'}
│     ├─ createTodo.ts      mutation · validates body, returns the new row
│     ├─ toggleTodo.ts      mutation · flips done, sets/clears completedAt
│     └─ deleteTodo.ts      mutation · deletes by id
└─ README.md                you are here
```

## try it in 60 seconds

```sh
# 1. authenticate (skip if you already have credentials stored)
briven login --project p_<id> --key brk_<...>

# 2. copy the example, link it, deploy
cp -r examples/todo-app my-todo-app
cd my-todo-app
briven link
briven deploy

# 3. exercise the api
briven invoke createTodo --body '{"body":"buy milk"}'
briven invoke listTodos
briven invoke toggleTodo --body '{"id":"td_<paste-id>"}'
```

## react client

```tsx
import { BrivenProvider, useQuery, useMutation } from '@briven/react';

function App() {
  return (
    <BrivenProvider config={{ projectId: 'p_<id>', apiKey: 'brk_<...>' }}>
      <TodoList />
    </BrivenProvider>
  );
}

function TodoList() {
  const { data, isLoading } = useQuery('listTodos', { filter: 'open' });
  const create = useMutation('createTodo');
  const toggle = useMutation('toggleTodo');

  if (isLoading) return <p>loading…</p>;

  return (
    <div>
      <button onClick={() => create({ body: prompt('what?') ?? '' })}>+ add</button>
      <ul>
        {data.map((t) => (
          <li key={t.id}>
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => toggle({ id: t.id })}
            />
            {t.body}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`useQuery('listTodos')` subscribes to the underlying `todos` table — when any
mutation commits, the query re-runs and the component re-renders. no manual
invalidation, no cache keys.

## next steps

- swap `@briven/react` for `@briven/svelte` or `@briven/vue` — same surface
- add multi-user todos: extend the schema with `ownerId text().notNull()` and
  read `ctx.auth.userId` inside `createTodo`
- add a search query: `ctx.db('todos').where(..).orderBy(..)` is just a query
  builder, anything postgres can do you can do here

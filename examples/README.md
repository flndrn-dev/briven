# briven examples

each subdirectory is a self-contained briven project you can copy as a starting point. all examples target the latest `@briven/cli`. license: MIT.

| example | what it covers |
|---|---|
| [todo-app](./todo-app) | the canonical hello-world: schema, four mutations + one reactive query, the react client |
| [realtime-chat](./realtime-chat) | two-table schema + per-room reactive queries — a multi-room chat in ~80 lines |
| (more on the way — counter, file-uploads, oauth-protected api) | |

## use one of these

```sh
# 1. copy the example into a new folder
cp -r examples/todo-app my-todo-app
cd my-todo-app

# 2. link it to a briven project (requires `briven login` first)
briven link

# 3. push schema + functions
briven deploy

# 4. invoke and verify
briven invoke listTodos
```

each example ships its own `README.md` with a 30-second tour.

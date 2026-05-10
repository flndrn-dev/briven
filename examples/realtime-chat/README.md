# realtime-chat

a tiny multi-room chat showing off briven's reactive query primitives:
`useQuery('listMessages', { roomId })` re-runs automatically whenever the
`messages` table changes for that room. no polling, no manual cache
invalidation, no websocket plumbing in your code.

## what's in here

```
realtime-chat/
├─ briven.json
├─ briven/
│  ├─ schema.ts              two tables: rooms, messages
│  └─ functions/
│     ├─ listRooms.ts        reactive · all rooms newest-first
│     ├─ listMessages.ts     reactive · messages in a room, newest-first
│     ├─ createRoom.ts       mutation · creates a room
│     └─ sendMessage.ts      mutation · validates room exists, inserts
└─ README.md                 you are here
```

## try it in 60 seconds

```sh
cp -r examples/realtime-chat my-chat
cd my-chat
briven link
briven deploy

# create a room and post a message
briven invoke createRoom --body '{"name":"general"}'
briven invoke sendMessage --body '{"roomId":"rm_<id>","authorName":"j","body":"hello"}'
briven invoke listMessages --body '{"roomId":"rm_<id>"}'
```

## react

```tsx
import { BrivenProvider, useQuery, useMutation } from '@briven/react';

function ChatRoom({ roomId, me }: { roomId: string; me: string }) {
  const { data: messages = [] } = useQuery('listMessages', { roomId });
  const send = useMutation('sendMessage');
  const [draft, setDraft] = useState('');

  return (
    <>
      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.authorName}:</strong> {m.body}
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          await send({ roomId, authorName: me, body: draft });
          setDraft('');
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">send</button>
      </form>
    </>
  );
}
```

When `sendMessage` commits on the server, briven re-runs every active
`listMessages` query that read the touched row. Subscribers in *every* tab,
*every* device, get re-rendered without any extra code in the client.

## why this is a good learning example

- shows a **two-table schema** with a foreign-key relationship enforced in
  application code (`sendMessage` validates `room` exists before insert)
- shows **input validation** that returns proper status codes
- shows **per-room reactivity** — only subscribers of the same room get the
  re-run, not every connected client
- maps cleanly to the chat patterns you'd build on Convex/Firestore but on a
  database you can `pg_dump` whenever you want

## next steps

- **pagination**: add `before` (cursor) to `listMessages` and switch the
  client to infinite scroll
- **typing indicators**: a `typing` ephemeral table or a presence channel via
  the realtime websocket
- **auth**: wire `ctx.auth.userId` into `sendMessage` and reject anonymous
  posts; reuse the same query function unchanged

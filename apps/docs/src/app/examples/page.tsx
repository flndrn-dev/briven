import { DocsShell } from '../../components/shell';

export const metadata = { title: 'examples' };

interface Example {
  id: string;
  title: string;
  description: string;
  schema: string;
  notes?: string;
}

const EXAMPLES: readonly Example[] = [
  {
    id: 'todo',
    title: 'todo app',
    description:
      'one-user todo list. optional starter via `briven setup --template todo-app` (or `briven init --template todo-app` for local files only). minimal example to see reactive queries in action: every insert / update / delete from the cli or studio re-runs the active subscriptions on the client.',
    schema: `import { boolean, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  todos: table({
    id: text().primaryKey(),
    body: text().notNull(),
    done: boolean().default('false').notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),
});`,
  },
  {
    id: 'blog',
    title: 'blog with comments',
    description:
      'multi-user blog. posts belong to authors; comments belong to posts and can reply to other comments (self-FK on parent_id). createdAt is indexed on both tables for "newest first" feeds.',
    schema: `import { schema, table, text, timestamp, boolean } from '@briven/cli/schema';

export default schema({
  authors: table({
    id: text().primaryKey(),
    email: text().notNull(),
    displayName: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }, {
    indexes: [{ columns: ['email'], unique: true }],
  }),

  posts: table({
    id: text().primaryKey(),
    authorId: text().notNull().references('authors', 'id'),
    title: text().notNull(),
    body: text().notNull(),
    published: boolean().default('false').notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }, {
    indexes: [{ columns: ['authorId', 'createdAt'] }],
  }),

  comments: table({
    id: text().primaryKey(),
    postId: text().notNull().references('posts', 'id'),
    authorId: text().notNull().references('authors', 'id'),
    parentId: text().nullable().references('comments', 'id'),
    body: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }, {
    indexes: [{ columns: ['postId', 'createdAt'] }],
  }),
});`,
  },
  {
    id: 'chat',
    title: 'chat / dm app',
    description:
      'real-time chat with rooms and members. members table is the join — a user belongs to a room with a role. messages reference both the room and the author so realtime fan-out scopes per-room.',
    schema: `import { schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  users: table({
    id: text().primaryKey(),
    email: text().notNull(),
    displayName: text().notNull(),
  }, {
    indexes: [{ columns: ['email'], unique: true }],
  }),

  rooms: table({
    id: text().primaryKey(),
    name: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),

  roomMembers: table({
    roomId: text().notNull().references('rooms', 'id'),
    userId: text().notNull().references('users', 'id'),
    role: text().default("'member'").notNull(),
    joinedAt: timestamp().default('now()').notNull(),
  }, {
    indexes: [
      { columns: ['roomId', 'userId'], unique: true },
      { columns: ['userId'] },
    ],
  }),

  messages: table({
    id: text().primaryKey(),
    roomId: text().notNull().references('rooms', 'id'),
    authorId: text().notNull().references('users', 'id'),
    body: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }, {
    indexes: [{ columns: ['roomId', 'createdAt'] }],
  }),
});`,
    notes:
      'tip: the realtime subscriber filters by roomId, so server-side fan-out only pushes a message to the people in that room.',
  },
  {
    id: 'ecommerce',
    title: 'tiny e-commerce',
    description:
      'products, carts, orders. money in integer cents (no floats!), stock tracked at the product level, orders cascade to order_items so deleting an order cleans up its line items.',
    schema: `import { bigint, integer, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  products: table({
    id: text().primaryKey(),
    name: text().notNull(),
    descriptionMd: text().notNull(),
    priceCents: integer().notNull(),
    stock: integer().default('0').notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),

  customers: table({
    id: text().primaryKey(),
    email: text().notNull(),
    displayName: text().notNull(),
  }, {
    indexes: [{ columns: ['email'], unique: true }],
  }),

  orders: table({
    id: text().primaryKey(),
    customerId: text().notNull().references('customers', 'id'),
    status: text().default("'pending'").notNull(),
    totalCents: bigint().notNull(),
    placedAt: timestamp().default('now()').notNull(),
  }, {
    indexes: [{ columns: ['customerId', 'placedAt'] }],
  }),

  orderItems: table({
    orderId: text().notNull().references('orders', 'id', { onDelete: 'cascade' }),
    productId: text().notNull().references('products', 'id'),
    quantity: integer().notNull(),
    unitPriceCents: integer().notNull(),
  }, {
    indexes: [{ columns: ['orderId', 'productId'], unique: true }],
  }),
});`,
    notes:
      'always store money as integer cents. floats lose precision and break sums. the cli\'s integer() maps to int4 (up to ~$21M); use bigint() for totals that span many orders.',
  },
  {
    id: 'multi-tenant',
    title: 'multi-tenant SaaS',
    description:
      'org → projects → resources. every resource references the org it belongs to so a single WHERE clause enforces tenant isolation. consider also using row-level security if your runtime queries the database directly.',
    schema: `import { schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  orgs: table({
    id: text().primaryKey(),
    name: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }),

  users: table({
    id: text().primaryKey(),
    email: text().notNull(),
  }, {
    indexes: [{ columns: ['email'], unique: true }],
  }),

  orgMembers: table({
    orgId: text().notNull().references('orgs', 'id', { onDelete: 'cascade' }),
    userId: text().notNull().references('users', 'id'),
    role: text().default("'member'").notNull(),
  }, {
    indexes: [{ columns: ['orgId', 'userId'], unique: true }],
  }),

  resources: table({
    id: text().primaryKey(),
    orgId: text().notNull().references('orgs', 'id', { onDelete: 'cascade' }),
    name: text().notNull(),
    payload: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
  }, {
    indexes: [{ columns: ['orgId', 'createdAt'] }],
  }),
});`,
    notes:
      'every query in your functions should start with `WHERE orgId = ?` where ? comes from the authenticated user\'s org membership. think of it like a partition key — make sure it\'s the leading column on every index.',
  },
];

export default function ExamplesPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">examples</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        copy-paste schemas for common app shapes. every example is a real{' '}
        <code>briven/schema.ts</code> — drop it in your project, run{' '}
        <code>briven deploy</code>, and you have a working data model. or click-build the
        equivalent in studio if you&apos;d rather start from the dashboard.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2 font-mono text-xs">
        {EXAMPLES.map((e) => (
          <a
            key={e.id}
            href={`#${e.id}`}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {e.title}
          </a>
        ))}
      </nav>

      {EXAMPLES.map((e) => (
        <section key={e.id} id={e.id} className="mt-10 scroll-mt-20">
          <h2 className="font-mono text-lg tracking-tight">{e.title}</h2>
          <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
            {e.description}
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-4 font-mono text-xs text-[var(--color-code-text)]">
            <code>{e.schema}</code>
          </pre>
          {e.notes ? (
            <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
              <span className="text-[var(--color-text)]">note: </span>
              {e.notes}
            </p>
          ) : null}
        </section>
      ))}
    </DocsShell>
  );
}

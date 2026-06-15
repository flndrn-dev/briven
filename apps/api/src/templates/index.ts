import type { TemplateDef } from './types.js';

export type { TemplateDef, TemplateTable } from './types.js';

/**
 * Starter templates. The flagship is `contacts-crm`; the other three share
 * the same engine and are pure data recipes on top of it.
 *
 * Conventions:
 *  - Every table has a `uuid` primary key defaulting to gen_random_uuid().
 *  - Tables are listed in FK order (parents before children).
 *  - Referenced sample rows carry explicit literal uuids so child rows can
 *    point at them.
 */

const ID = (n: string) => `a0000000-0000-4000-8000-0000000000${n}`;

const contactsCrm: TemplateDef = {
  id: 'contacts-crm',
  name: 'Contacts / CRM',
  description: 'Track people, companies and deals. A simple customer relationship manager.',
  icon: '👥',
  tables: [
    {
      tableName: 'companies',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'name', type: 'text', notNull: true },
        { name: 'website', type: 'text' },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('a1'), name: 'Acme NV', website: 'https://acme.example' },
        { id: ID('a2'), name: 'Globex BV', website: 'https://globex.example' },
      ],
    },
    {
      tableName: 'contacts',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'first_name', type: 'text', notNull: true },
        { name: 'last_name', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'phone', type: 'text' },
        {
          name: 'company_id',
          type: 'uuid',
          references: { table: 'companies', column: 'id', onDelete: 'setNull' },
        },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('b1'), first_name: 'Anke', last_name: 'Peeters', email: 'anke@acme.example', phone: '+32 470 00 00 01', company_id: ID('a1') },
        { id: ID('b2'), first_name: 'Tom', last_name: 'Janssens', email: 'tom@globex.example', company_id: ID('a2') },
        { id: ID('b3'), first_name: 'Lina', last_name: 'De Smet', email: 'lina@acme.example', company_id: ID('a1') },
      ],
    },
    {
      tableName: 'deals',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'title', type: 'text', notNull: true },
        { name: 'amount', type: 'numeric' },
        { name: 'stage', type: 'text', notNull: true, defaultExpr: "'lead'" },
        {
          name: 'contact_id',
          type: 'uuid',
          references: { table: 'contacts', column: 'id', onDelete: 'setNull' },
        },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('c1'), title: 'Acme website rebuild', amount: 4500, stage: 'proposal', contact_id: ID('b1') },
        { id: ID('c2'), title: 'Globex support retainer', amount: 1200, stage: 'lead', contact_id: ID('b2') },
      ],
    },
  ],
};

const inventory: TemplateDef = {
  id: 'inventory',
  name: 'Inventory / stock',
  description: 'Track products, stock levels and suppliers.',
  icon: '📦',
  tables: [
    {
      tableName: 'suppliers',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'name', type: 'text', notNull: true },
        { name: 'email', type: 'text' },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('a1'), name: 'North Supply Co', email: 'sales@northsupply.example' },
        { id: ID('a2'), name: 'Benelux Parts', email: 'orders@beneluxparts.example' },
      ],
    },
    {
      tableName: 'products',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'name', type: 'text', notNull: true },
        { name: 'sku', type: 'text' },
        { name: 'quantity', type: 'integer', notNull: true, defaultExpr: '0' },
        { name: 'price', type: 'numeric' },
        {
          name: 'supplier_id',
          type: 'uuid',
          references: { table: 'suppliers', column: 'id', onDelete: 'setNull' },
        },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('b1'), name: 'Widget A', sku: 'WID-A', quantity: 120, price: 9.99, supplier_id: ID('a1') },
        { id: ID('b2'), name: 'Widget B', sku: 'WID-B', quantity: 40, price: 14.5, supplier_id: ID('a1') },
        { id: ID('b3'), name: 'Cable 2m', sku: 'CBL-2M', quantity: 300, price: 3.25, supplier_id: ID('a2') },
      ],
    },
  ],
};

const bookings: TemplateDef = {
  id: 'bookings',
  name: 'Bookings / appointments',
  description: 'Track clients, services and appointments.',
  icon: '📅',
  tables: [
    {
      tableName: 'clients',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'name', type: 'text', notNull: true },
        { name: 'email', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('a1'), name: 'Marie Claes', email: 'marie@example.com', phone: '+32 471 11 11 11' },
        { id: ID('a2'), name: 'Joris Vermeulen', email: 'joris@example.com' },
      ],
    },
    {
      tableName: 'services',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'name', type: 'text', notNull: true },
        { name: 'duration_min', type: 'integer', notNull: true, defaultExpr: '30' },
        { name: 'price', type: 'numeric' },
      ],
      rows: [
        { id: ID('b1'), name: 'Consultation', duration_min: 30, price: 40 },
        { id: ID('b2'), name: 'Full session', duration_min: 60, price: 75 },
      ],
    },
    {
      tableName: 'appointments',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        {
          name: 'client_id',
          type: 'uuid',
          references: { table: 'clients', column: 'id', onDelete: 'cascade' },
        },
        {
          name: 'service_id',
          type: 'uuid',
          references: { table: 'services', column: 'id', onDelete: 'setNull' },
        },
        { name: 'starts_at', type: 'timestamptz' },
        { name: 'notes', type: 'text' },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('c1'), client_id: ID('a1'), service_id: ID('b1'), notes: 'First visit' },
        { id: ID('c2'), client_id: ID('a2'), service_id: ID('b2'), notes: 'Follow-up' },
      ],
    },
  ],
};

const tasks: TemplateDef = {
  id: 'tasks',
  name: 'Project / task tracker',
  description: 'Track projects, tasks, status and due dates.',
  icon: '✅',
  tables: [
    {
      tableName: 'task_projects',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'name', type: 'text', notNull: true },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('a1'), name: 'Website launch' },
        { id: ID('a2'), name: 'Office move' },
      ],
    },
    {
      tableName: 'tasks',
      columns: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
        { name: 'title', type: 'text', notNull: true },
        { name: 'status', type: 'text', notNull: true, defaultExpr: "'todo'" },
        { name: 'due_date', type: 'timestamptz' },
        {
          name: 'project_id',
          type: 'uuid',
          references: { table: 'task_projects', column: 'id', onDelete: 'cascade' },
        },
        { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ],
      rows: [
        { id: ID('b1'), title: 'Design homepage', status: 'doing', project_id: ID('a1') },
        { id: ID('b2'), title: 'Write copy', status: 'todo', project_id: ID('a1') },
        { id: ID('b3'), title: 'Book movers', status: 'todo', project_id: ID('a2') },
      ],
    },
  ],
};

export const TEMPLATES: Record<string, TemplateDef> = {
  [contactsCrm.id]: contactsCrm,
  [inventory.id]: inventory,
  [bookings.id]: bookings,
  [tasks.id]: tasks,
};

/** Public list for the picker UI (no internal detail). */
export function listTemplates(): Array<Pick<TemplateDef, 'id' | 'name' | 'description' | 'icon'>> {
  return Object.values(TEMPLATES).map(({ id, name, description, icon }) => ({
    id,
    name,
    description,
    icon,
  }));
}

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES[id];
}

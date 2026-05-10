import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseInitArgs, TEMPLATES } from './init.js';

describe('parseInitArgs', () => {
  test('defaults to blank template + no name + no force', () => {
    const args = parseInitArgs([]);
    assert.equal(args.template, 'blank');
    assert.equal(args.name, undefined);
    assert.equal(args.force, false);
  });

  test('positional name', () => {
    assert.equal(parseInitArgs(['my-project']).name, 'my-project');
  });

  test('--name overrides positional', () => {
    assert.equal(parseInitArgs(['ignored', '--name', 'real']).name, 'real');
  });

  test('--template <name> picks a known template', () => {
    assert.equal(parseInitArgs(['--template', 'todo-app']).template, 'todo-app');
    assert.equal(parseInitArgs(['--template', 'chat']).template, 'chat');
  });

  test('--template=<name> shorthand', () => {
    assert.equal(parseInitArgs(['--template=todo-app']).template, 'todo-app');
  });

  test('--template carries unknown names through (rejected at runtime)', () => {
    // Defer reject to runInit so the error message can list available
    // templates. parseInitArgs returns the literal so the caller can
    // detect the mismatch.
    assert.equal(parseInitArgs(['--template', 'mystery']).template, 'mystery');
  });

  test('--force flag', () => {
    assert.equal(parseInitArgs(['--force']).force, true);
  });

  test('--list-templates', () => {
    assert.equal(parseInitArgs(['--list-templates']).list, true);
  });
});

describe('TEMPLATES', () => {
  test('every template has a briven/schema.ts and at least one function', () => {
    for (const [name, tpl] of Object.entries(TEMPLATES)) {
      assert.match(tpl.description, /.+/);
      assert.ok(tpl.files['briven/schema.ts'], `${name} should have briven/schema.ts`);
      const fnFiles = Object.keys(tpl.files).filter((p) => p.startsWith('briven/functions/'));
      assert.ok(fnFiles.length >= 1, `${name} should have functions`);
    }
  });

  test('todo-app template ships the expected four mutations + listing', () => {
    const t = TEMPLATES['todo-app'];
    assert.ok(t.files['briven/functions/listTodos.ts']);
    assert.ok(t.files['briven/functions/createTodo.ts']);
    assert.ok(t.files['briven/functions/toggleTodo.ts']);
    assert.ok(t.files['briven/functions/deleteTodo.ts']);
  });

  test('chat template ships rooms + messages + the four functions', () => {
    const t = TEMPLATES.chat;
    const schema = t.files['briven/schema.ts'];
    assert.ok(schema);
    assert.match(schema, /rooms/);
    assert.match(schema, /messages/);
    assert.ok(t.files['briven/functions/listRooms.ts']);
    assert.ok(t.files['briven/functions/listMessages.ts']);
    assert.ok(t.files['briven/functions/createRoom.ts']);
    assert.ok(t.files['briven/functions/sendMessage.ts']);
  });

  test('every function source imports from @briven/cli/server', () => {
    for (const tpl of Object.values(TEMPLATES)) {
      for (const [path, src] of Object.entries(tpl.files)) {
        if (path.startsWith('briven/functions/') && src) {
          assert.match(src, /@briven\/cli\/server/, `${path} should import @briven/cli/server`);
        }
      }
    }
  });
});

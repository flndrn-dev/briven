import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { pullSchemaToDisk } from './schema-pull.js';

test('pullSchemaToDisk writes schema.ts from api response', async () => {
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ schemaTs: "export default schema({});\n" }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), 'briven-pull-'));
  try {
    await pullSchemaToDisk({
      apiOrigin: `http://127.0.0.1:${port}`,
      bearer: 'tk',
      projectId: 'p_test',
      cwd: dir,
    });
    const written = await readFile(join(dir, 'briven', 'schema.ts'), 'utf8');
    assert.match(written, /export default schema/);
    const readme = await readFile(join(dir, 'briven', 'functions', 'README.md'), 'utf8');
    assert.match(readme, /your functions live on briven/i);
  } finally {
    srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('pullSchemaToDisk propagates api errors', async () => {
  const srv = createServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'internal', message: 'boom' }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), 'briven-pull-err-'));
  try {
    await assert.rejects(
      () =>
        pullSchemaToDisk({
          apiOrigin: `http://127.0.0.1:${port}`,
          bearer: 'tk',
          projectId: 'p_test',
          cwd: dir,
        }),
    );
  } finally {
    srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});

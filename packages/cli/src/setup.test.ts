import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideBranch,
  looksLikeProjectRef,
  parseConnectProjectArgs,
  parseSetupArgs,
} from './setup.js';

describe('decideBranch', () => {
  it('missing briven.json → wizard', () => {
    assert.equal(decideBranch({ hasBrivenJson: false, hasUserToken: true }), 'wizard');
  });
  it('missing token → auth then watch', () => {
    assert.equal(decideBranch({ hasBrivenJson: true, hasUserToken: false }), 'auth-then-watch');
  });
  it('both present → watch', () => {
    assert.equal(decideBranch({ hasBrivenJson: true, hasUserToken: true }), 'watch');
  });
});

describe('parseSetupArgs (new project only)', () => {
  it('defaults', () => {
    const a = parseSetupArgs([]);
    assert.equal(a.template, 'blank');
    assert.equal(a.yes, false);
    assert.equal(a.name, undefined);
    assert.equal(a.project, undefined);
  });

  it('parses --name and --template', () => {
    const a = parseSetupArgs(['--name', 'my-app', '--template', 'todo-app', '--region', 'us-east']);
    assert.equal(a.name, 'my-app');
    assert.equal(a.template, 'todo-app');
    assert.equal(a.region, 'us-east');
  });

  it('still parses --project so setup can redirect to connect', () => {
    const a = parseSetupArgs(['--project=p_abc', '-y']);
    assert.equal(a.project, 'p_abc');
    assert.equal(a.yes, true);
  });

  it('positional name → create new project', () => {
    const a = parseSetupArgs(['my-cool-app']);
    assert.equal(a.name, 'my-cool-app');
    assert.equal(a.project, undefined);
  });

  it('positional p_ id is treated as a name token (runSetup redirects to connect)', () => {
    const a = parseSetupArgs(['p_01HZabc123']);
    assert.equal(a.name, 'p_01HZabc123');
    assert.equal(a.project, undefined);
    assert.equal(looksLikeProjectRef(a.name!), true);
  });

  it('explicit --name wins over positional', () => {
    const a = parseSetupArgs(['ignored', '--name', 'real-name']);
    assert.equal(a.name, 'real-name');
  });
});

describe('parseConnectProjectArgs (existing project)', () => {
  it('defaults', () => {
    const a = parseConnectProjectArgs([]);
    assert.equal(a.project, undefined);
    assert.equal(a.yes, false);
    assert.equal(a.force, false);
  });

  it('positional p_ id → project', () => {
    const a = parseConnectProjectArgs(['p_01HZabc123']);
    assert.equal(a.project, 'p_01HZabc123');
  });

  it('parses --project and --force', () => {
    const a = parseConnectProjectArgs(['--project', 'my-slug', '--force', '-y']);
    assert.equal(a.project, 'my-slug');
    assert.equal(a.force, true);
    assert.equal(a.yes, true);
  });
});

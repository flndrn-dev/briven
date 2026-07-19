import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideBranch, parseSetupArgs } from './setup.js';

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

describe('parseSetupArgs', () => {
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

  it('parses --project and --yes', () => {
    const a = parseSetupArgs(['--project=p_abc', '-y']);
    assert.equal(a.project, 'p_abc');
    assert.equal(a.yes, true);
  });

  it('positional name → create new project', () => {
    const a = parseSetupArgs(['my-cool-app']);
    assert.equal(a.name, 'my-cool-app');
    assert.equal(a.project, undefined);
  });

  it('positional p_ id → attach existing project', () => {
    const a = parseSetupArgs(['p_01HZabc123']);
    assert.equal(a.project, 'p_01HZabc123');
    assert.equal(a.name, undefined);
  });

  it('explicit --name wins over positional', () => {
    const a = parseSetupArgs(['ignored', '--name', 'real-name']);
    assert.equal(a.name, 'real-name');
  });
});

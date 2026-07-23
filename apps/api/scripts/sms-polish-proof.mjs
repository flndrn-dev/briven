/**
 * SMS polish proof (steps 1–5 of product polish).
 *
 * Checks, without requiring a real Twilio account:
 *   1) Config: SMS “ready” only when SID + token + From are all saved
 *   2) Methods: passwordlessSms on/off + ready = method AND secrets
 *   3) Honest delivery: no secrets → ok:false mode:log
 *   4) Honest delivery: bad Twilio → ok:false mode:error (mocked HTTP)
 *   5) Success path → ok:true mode:provider (mocked HTTP 201)
 *   6) Passwordless create+consume still works when SMS only logged
 *   7) Test helper rejects bad phone numbers
 *
 * Optional live Twilio (step 6 of the plan — only if YOU set env):
 *   BRIVEN_SMS_LIVE_SID / BRIVEN_SMS_LIVE_TOKEN / BRIVEN_SMS_LIVE_FROM / BRIVEN_SMS_LIVE_TO
 *   When all four are set, one real test SMS is sent (costs Twilio credit).
 *
 * Run:
 *   cd apps/api
 *   BRIVEN_ENGINE_DATABASE_URL=postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable \
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable \
 *   BRIVEN_AUTH_CORE_ENABLED=true BRIVEN_ENV=development \
 *   bun scripts/sms-polish-proof.mjs
 *
 * Human checklist after this script is green:
 *   [ ] Dashboard → project → Providers → SMS card shows ready/not set
 *   [ ] Security → SMS block matches Providers
 *   [ ] Save Twilio secrets → SMS ready
 *   [ ] Send test SMS to your phone (or live env above)
 *   [ ] Deploy only when you say ship
 */

process.env.BRIVEN_AUTH_CORE_ENABLED = 'true';
process.env.BRIVEN_ENV = 'development';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk } = await import('../src/services/auth-core/engine.ts');
const {
  getBrivenEngineProjectConfig,
  setBrivenEngineMethodFlags,
  setBrivenEngineSmsSecrets,
} = await import('../src/services/auth-core/project-config.ts');
const {
  createPasswordlessCode,
  consumePasswordlessCode,
} = await import('../src/services/auth-core/passwordless.ts');
const {
  sendBrivenEngineSms,
  sendBrivenEngineSmsTest,
} = await import('../src/services/auth-core/delivery.ts');

const projectId = `p_sms_polish_${Date.now().toString(36)}`;
const phone = `+1555${String(Date.now()).slice(-7)}`;
let failed = 0;

function pass(label, detail) {
  console.log(`  ✔ ${label}`, detail ?? '');
}

function fail(label, detail) {
  failed += 1;
  console.error(`  ✘ ${label}`, detail ?? '');
}

function assert(cond, label, detail) {
  if (cond) pass(label, detail);
  else fail(label, detail);
}

/** Mock only api.twilio.com so proof works offline. */
function withMockedTwilio(handler, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.twilio.com')) {
      return handler(u, init);
    }
    return realFetch(url, init);
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = realFetch;
    });
}

console.log('=== SMS polish proof ===');
console.log({ projectId, phone });

const ensured = await ensureBrivenEngineDatabase();
if (!ensured.ok) {
  console.error('FAIL ensure DB', ensured);
  console.error(
    'Start local Doltgres (port 5434) then re-run. See compose.briven-engine.local.yml',
  );
  process.exit(1);
}
const inited = await initAuthCoreSdk();
if (!inited) {
  console.error('FAIL init auth-core');
  process.exit(1);
}

// ── 1) Fresh project: SMS not configured ─────────────────────────────
console.log('\n[1] config without secrets');
{
  const cfg = await getBrivenEngineProjectConfig(projectId);
  assert(
    cfg.delivery.sms.configured === false,
    'sms.configured is false',
    cfg.delivery.sms,
  );
  assert(
    cfg.delivery.sms.provider === null,
    'sms.provider is null',
    cfg.delivery.sms.provider,
  );
}

// ── 2) Method on but no secrets → not ready ──────────────────────────
console.log('\n[2] passwordlessSms method vs secrets');
{
  await setBrivenEngineMethodFlags(projectId, { passwordlessSms: true });
  const cfg = await getBrivenEngineProjectConfig(projectId);
  assert(cfg.methods.passwordlessSms === true, 'method passwordlessSms on');
  assert(
    cfg.delivery.sms.configured === false,
    'still not configured without secrets',
  );
  const chip = cfg.methodChips.find((c) => c.id === 'passwordless-sms');
  assert(chip?.enabled === true, 'chip enabled');
  assert(chip?.configured === false, 'chip configured=false (no Twilio)');
  const ready =
    cfg.methods.passwordlessSms && cfg.delivery.sms.configured;
  assert(ready === false, 'passwordlessSmsReady false');
}

// ── 3) Honest delivery without secrets ───────────────────────────────
console.log('\n[3] delivery without secrets (honest fail)');
{
  const sent = await sendBrivenEngineSms({
    phoneNumber: phone,
    userInputCode: '123456',
    projectId,
    type: 'PASSWORDLESS_LOGIN',
  });
  assert(sent.ok === false, 'ok=false without secrets', sent);
  assert(sent.mode === 'log', 'mode=log without secrets', sent.mode);
  assert(
    typeof sent.message === 'string' &&
      sent.message.toLowerCase().includes('sms not set'),
    'message mentions SMS not set',
    sent.message,
  );

  const noProject = await sendBrivenEngineSms({
    phoneNumber: phone,
    userInputCode: '123456',
    type: 'PASSWORDLESS_LOGIN',
  });
  assert(noProject.ok === false, 'ok=false without projectId', noProject);
  assert(noProject.mode === 'log', 'mode=log without projectId', noProject.mode);
}

// ── 4) Passwordless create still works; delivery honest ──────────────
console.log('\n[4] passwordless create+consume (delivery may be log)');
{
  const created = await createPasswordlessCode({
    phoneNumber: phone,
    projectId,
    flowType: 'USER_INPUT_CODE',
  });
  assert(created.status === 'OK', 'create status OK', created);
  assert(
    created.status === 'OK' && created.channel === 'sms',
    'channel=sms',
    created.status === 'OK' ? created.channel : null,
  );
  assert(
    created.status === 'OK' && created.delivery?.ok === false,
    'delivery.ok false (no Twilio yet)',
    created.status === 'OK' ? created.delivery : null,
  );
  assert(
    created.status === 'OK' && Boolean(created.userInputCode),
    'dev userInputCode present',
  );

  if (created.status === 'OK' && created.userInputCode) {
    const consumed = await consumePasswordlessCode({
      preAuthSessionId: created.preAuthSessionId,
      deviceId: created.deviceId,
      userInputCode: created.userInputCode,
      projectId,
    });
    assert(consumed.status === 'OK', 'consume OK even when SMS only logged', {
      status: consumed.status,
      user:
        consumed.status === 'OK'
          ? { id: consumed.user.id, phone: consumed.user.phone }
          : null,
    });
  }
}

// ── 5) Save secrets → configured ─────────────────────────────────────
console.log('\n[5] save Twilio-compatible secrets');
{
  await setBrivenEngineSmsSecrets(projectId, {
    accountSid: 'ACffffffffffffffffffffffffffffffff',
    authToken: 'test_auth_token_not_real',
    fromNumber: '+15550001111',
  });
  const cfg = await getBrivenEngineProjectConfig(projectId);
  assert(cfg.delivery.sms.configured === true, 'sms.configured true', cfg.delivery.sms);
  assert(
    cfg.delivery.sms.provider === 'twilio-compatible',
    'provider twilio-compatible',
  );
  const chip = cfg.methodChips.find((c) => c.id === 'passwordless-sms');
  assert(chip?.configured === true, 'chip configured=true');
  const ready =
    cfg.methods.passwordlessSms && cfg.delivery.sms.configured;
  assert(ready === true, 'passwordlessSmsReady true');
}

// ── 6) Bad phone on test helper ──────────────────────────────────────
console.log('\n[6] test helper rejects bad phone');
{
  const bad = await sendBrivenEngineSmsTest({
    projectId,
    phoneNumber: '5551234',
  });
  assert(bad.ok === false, 'bad phone ok=false', bad);
  assert(bad.mode === 'error', 'bad phone mode=error', bad.mode);
}

// ── 7) Mock Twilio failure → honest error ────────────────────────────
console.log('\n[7] mocked Twilio 401 → mode error');
await withMockedTwilio(
  async () =>
    new Response(JSON.stringify({ message: 'Authenticate', code: 20003 }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  async () => {
    const sent = await sendBrivenEngineSmsTest({
      projectId,
      phoneNumber: phone,
    });
    assert(sent.ok === false, 'Twilio fail ok=false', sent);
    assert(sent.mode === 'error', 'Twilio fail mode=error', sent.mode);
    assert(
      typeof sent.message === 'string' && sent.message.includes('401'),
      'message includes provider status',
      sent.message,
    );
  },
);

// ── 8) Mock Twilio success → provider ────────────────────────────────
console.log('\n[8] mocked Twilio 201 → mode provider');
await withMockedTwilio(
  async () =>
    new Response(JSON.stringify({ sid: 'SM_mock_success', status: 'queued' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }),
  async () => {
    const sent = await sendBrivenEngineSmsTest({
      projectId,
      phoneNumber: phone,
    });
    assert(sent.ok === true, 'Twilio success ok=true', sent);
    assert(sent.mode === 'provider', 'Twilio success mode=provider', sent.mode);
  },
);

// ── 9) Method off with secrets → ready false ─────────────────────────
console.log('\n[9] method off → ready false even with secrets');
{
  await setBrivenEngineMethodFlags(projectId, { passwordlessSms: false });
  const cfg = await getBrivenEngineProjectConfig(projectId);
  assert(cfg.delivery.sms.configured === true, 'secrets still saved');
  assert(cfg.methods.passwordlessSms === false, 'method off');
  const ready =
    cfg.methods.passwordlessSms && cfg.delivery.sms.configured;
  assert(ready === false, 'ready false when method off');
  // restore for any follow-on
  await setBrivenEngineMethodFlags(projectId, { passwordlessSms: true });
}

// ── 10) Optional real Twilio (only with env) ─────────────────────────
console.log('\n[10] optional live Twilio');
const liveSid = process.env.BRIVEN_SMS_LIVE_SID?.trim();
const liveToken = process.env.BRIVEN_SMS_LIVE_TOKEN?.trim();
const liveFrom = process.env.BRIVEN_SMS_LIVE_FROM?.trim();
const liveTo = process.env.BRIVEN_SMS_LIVE_TO?.trim();
if (liveSid && liveToken && liveFrom && liveTo) {
  const liveProject = `p_sms_live_${Date.now().toString(36)}`;
  await setBrivenEngineSmsSecrets(liveProject, {
    accountSid: liveSid,
    authToken: liveToken,
    fromNumber: liveFrom,
  });
  const live = await sendBrivenEngineSmsTest({
    projectId: liveProject,
    phoneNumber: liveTo,
  });
  assert(live.ok === true, 'LIVE test SMS sent', live);
  assert(live.mode === 'provider', 'LIVE mode=provider', live.mode);
  console.log('  (check phone', liveTo, 'for Briven Auth test message)');
} else {
  console.log(
    '  · skipped (set BRIVEN_SMS_LIVE_SID, _TOKEN, _FROM, _TO to send a real text)',
  );
}

// ── Summary ──────────────────────────────────────────────────────────
console.log('');
if (failed > 0) {
  console.error(`✘ SMS POLISH PROOF FAILED (${failed} assertion(s))`);
  process.exit(1);
}

console.log('✔ SMS POLISH PROOF OK');
console.log('  config ready only with SID+token+From');
console.log('  method + secrets → ready; either missing → not ready');
console.log('  no secrets → delivery ok=false mode=log');
console.log('  Twilio fail → delivery ok=false mode=error');
console.log('  Twilio ok (mocked) → delivery ok=true mode=provider');
console.log('  passwordless create+consume works without real SMS');
console.log('  test helper rejects non-E.164 phones');
console.log('');
console.log('Next: dashboard smoke (Providers + Security + test button),');
console.log('then live Twilio when you say go, then deploy only with your OK.');
process.exit(0);

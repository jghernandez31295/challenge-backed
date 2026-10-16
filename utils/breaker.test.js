const { test } = require('node:test');
const assert = require('node:assert');

process.env.BREAKER_FAILURE_THRESHOLD = '3';
process.env.BREAKER_WINDOW_MS = '30000';
process.env.BREAKER_COOLDOWN_MS = '5000';
process.env.BREAKER_MAX_COOLDOWN_MS = '30000';

const loadBreaker = () => {
  delete require.cache[require.resolve('./breaker')];
  return require('./breaker');
};

const ok = async () => 'ok';
const fail = async () => {
  throw new Error('boom');
};

const tripBreaker = async (callWithBreaker) => {
  for (let i = 0; i < 3; i++) {
    await assert.rejects(callWithBreaker(fail), /boom/);
  }
};

test('returns result when service is healthy', async () => {
  const { callWithBreaker } = loadBreaker();
  assert.strictEqual(await callWithBreaker(ok), 'ok');
});

test('opens after 3 failures and rejects without calling the service', async () => {
  const { callWithBreaker } = loadBreaker();
  await tripBreaker(callWithBreaker);

  let called = false;
  const err = await callWithBreaker(async () => { called = true; }).catch((e) => e);
  assert.strictEqual(called, false);
  assert.strictEqual(err.retryAfter, 5);
});

test('ignores failures older than the window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const { callWithBreaker } = loadBreaker();
  await assert.rejects(callWithBreaker(fail), /boom/);
  await assert.rejects(callWithBreaker(fail), /boom/);

  t.mock.timers.tick(30000);
  await assert.rejects(callWithBreaker(fail), /boom/);
  assert.strictEqual(await callWithBreaker(ok), 'ok');
});

test('closes again when probe succeeds after cooldown', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const { callWithBreaker } = loadBreaker();
  await tripBreaker(callWithBreaker);

  t.mock.timers.tick(5000);
  assert.strictEqual(await callWithBreaker(ok), 'ok');
  assert.strictEqual(await callWithBreaker(ok), 'ok');
});

test('doubles cooldown when probe fails', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const { callWithBreaker } = loadBreaker();
  await tripBreaker(callWithBreaker);

  t.mock.timers.tick(5000);
  await assert.rejects(callWithBreaker(fail), /boom/);
  const err = await callWithBreaker(ok).catch((e) => e);
  assert.strictEqual(err.retryAfter, 10);
});

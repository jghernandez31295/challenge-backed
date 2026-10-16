const { logger } = require('./logger');

const FAILURE_THRESHOLD = Number(process.env.BREAKER_FAILURE_THRESHOLD) || 3;
const WINDOW_MS = Number(process.env.BREAKER_WINDOW_MS) || 30000;
const COOLDOWN_MS = Number(process.env.BREAKER_COOLDOWN_MS) || 5000;
const MAX_COOLDOWN_MS = Number(process.env.BREAKER_MAX_COOLDOWN_MS) || 30000;

let state = 'CLOSED';
let failures = [];
let cooldown = COOLDOWN_MS;
let openedAt = 0;

const open = () => {
  state = 'OPEN';
  openedAt = Date.now();
  logger.warn(`Breaker OPEN, next try in ${cooldown}ms`);
};

const callWithBreaker = async (fn) => {
  const waited = Date.now() - openedAt;
  if (state === 'HALF_OPEN' || (state === 'OPEN' && waited < cooldown)) {
    const err = new Error('Event service unavailable');
    err.retryAfter = Math.max(1, Math.ceil((cooldown - waited) / 1000));
    throw err;
  }
  if (state === 'OPEN') {
    state = 'HALF_OPEN';
    logger.info('Breaker HALF_OPEN, testing service');
  }

  try {
    const result = await fn();
    if (state === 'HALF_OPEN') {
      state = 'CLOSED';
      failures = [];
      cooldown = COOLDOWN_MS;
      logger.info('Breaker CLOSED, service recovered');
    }
    return result;
  } catch (err) {
    if (state === 'HALF_OPEN') {
      cooldown = Math.min(cooldown * 2, MAX_COOLDOWN_MS);
      open();
    } else if (state === 'CLOSED') {
      const now = Date.now();
      failures = failures.filter((time) => now - time < WINDOW_MS);
      failures.push(now);
      if (failures.length >= FAILURE_THRESHOLD) open();
    }
    throw err;
  }
};

module.exports = {
  callWithBreaker
};

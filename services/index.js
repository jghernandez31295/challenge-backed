const fastify = require('fastify')({ logger: true });
const listenMock = require('../mock-server');
const { callWithBreaker } = require('../utils/breaker');
const { logger } = require('../utils/logger');
const EVENT_BASE_URL = process.env.EVENT_BASE_URL;
const PORT = process.env.PORT || 3000;
const TIMEOUT_MS = 5000;

if (!EVENT_BASE_URL) {
  logger.error('EVENT_BASE_URL is not set');
  process.exit(1);
}

const fetchJson = async (path) => {
  const resp = await fetch(`${EVENT_BASE_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) {
    throw new Error(`Event service responded ${resp.status}`);
  }
  // getUserById answers 200 with an empty body when the user doesn't exist
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
};

fastify.get('/getUsers', async () => {
  const users = await fetchJson('/getUsers');
  logger.info('getUsers: users fetched', { count: users.length });
  return users;
});

const addEventSchema = {
  body: {
    type: 'object',
    required: ['name', 'userId'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1 },
      userId: { type: 'string', minLength: 1 },
      details: { type: 'string' }
    }
  }
};

fastify.post('/addEvent', { schema: addEventSchema }, async (request, reply) => {
  const { userId } = request.body;

  // check the user first, otherwise a typo in userId counts as an outage in the breaker
  const user = await fetchJson(`/getUserById/${userId}`);
  if (!user) {
    logger.info('addEvent: user not found', { userId });
    return reply.code(404).send({ error: 'User not found' });
  }

  const body = JSON.stringify({
    id: new Date().getTime(),
    ...request.body
  });
  let resp;
  try {
    resp = await callWithBreaker(async () => {
      const resp = await fetch(`${EVENT_BASE_URL}/addEvent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body
      });

      if (resp.status >= 500) {
        throw new Error(`Event service responded ${resp.status}`);
      }
      return resp;
    });
  } catch (err) {
    logger.warn('addEvent: event service call failed', err);
    if (err.retryAfter) {
      reply.header('Retry-After', err.retryAfter);
    }
    return reply.code(503).send({ error: 'Event service unavailable, try again later' });
  }
  if (!resp.ok) {
    throw new Error(`Event service responded ${resp.status}`);
  }
  logger.info('addEvent: event created', { userId });
  return resp.json();
});

fastify.get('/getEvents', async () => {
  const events = await fetchJson('/getEvents');
  logger.info('getEvents: events fetched', { count: events.length });
  return events;
});

fastify.get('/getEventsByUserId/:id', async (request, reply) => {
  const { id } = request.params;

  try {
    const user = await fetchJson(`/getUserById/${id}`);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // getEventById takes ~500ms, so fetching one by one was N x 500ms
    const events = await Promise.all(
      user.events.map((eventId) => fetchJson(`/getEventById/${eventId}`))
    );
    logger.info('getEventsByUserId: events fetched', { userId: id, count: events.length });
    return events;
  } catch (err) {
    logger.error(`getEventsByUserId: failed for user ${id}`, err);
    return reply.code(502).send({ error: `Failed to fetch events for user ${id}` });
  }
});

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    logger.error('Server failed to start', err);
    process.exit(1);
  }
  listenMock();
});

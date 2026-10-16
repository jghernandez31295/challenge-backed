const fastify = require('fastify')({ logger: true });
const listenMock = require('../mock-server');
const { callWithBreaker } = require('../utils/breaker');
const { logger } = require('../utils/logger');
const EVENT_BASE_URL = process.env.EVENT_BASE_URL;
const PORT = process.env.PORT || 3000;

if (!EVENT_BASE_URL) {
  logger.error('EVENT_BASE_URL is not set');
  process.exit(1);
}
fastify.get('/getUsers', async (request, reply) => {
  const resp = await fetch(`${EVENT_BASE_URL}/getUsers`);
  if (!resp.ok) {
    throw new Error(`Event service responded ${resp.status}`);
  }
  const data = await resp.json();
  logger.info('getUsers: users fetched', { count: data.length });
  reply.send(data);
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
        signal: AbortSignal.timeout(5000),
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
  const { userId } = request.body;
  if (resp.status === 404) {
    logger.info('addEvent: user not found', { userId });
    return reply.code(404).send({ error: 'User not found' });
  }
  if (!resp.ok) {
    throw new Error(`Event service responded ${resp.status}`);
  }
  logger.info('addEvent: event created', { userId });
  return resp.json();
});
fastify.get('/getEvents', async (request, reply) => {
  const resp = await fetch(`${EVENT_BASE_URL}/getEvents`);
  if (!resp.ok) {
    throw new Error(`Event service responded ${resp.status}`);
  }
  const data = await resp.json();
  logger.info('getEvents: events fetched', { count: data.length });
  reply.send(data);
});

fastify.get('/getEventsByUserId/:id', async (request, reply) => {
  const { id } = request.params;

  const user = await fetch(`${EVENT_BASE_URL}/getUserById/${id}`).then((res) => res.json()).catch((err) => {
    reply.code(404).send({ error: 'User not found' });
  });
  const userEvents = user.events;
  let eventArray = [];

  // for (let i = 0; i < userEvents.length; i++) {
  //   const event = await fetch('http://event.com/getEventById/' + userEvents[i]);
  //   const eventData = await event.json();
  //   eventArray.push(eventData);
  // }
  // reply.send(eventArray);

  //  this is slow better to use Promise.all to fetch all events in parallel
  try {
    await Promise.all(userEvents.map(async (eventId) => {
      const event = await fetch(`${EVENT_BASE_URL}/getEventById/${eventId}`);
      if (!event.ok) {
        throw new Error(`Event service responded ${event.status}`);
      }
      const eventData = await event.json();
      eventArray.push(eventData);
    }));
    logger.info('getEventsByUserId: events fetched', { userId: id, count: eventArray.length });
    reply.send(eventArray);
  } catch (error) {

    reply.code(500).send({ error: `Error fetching events for user ${id}` });
  }

});

fastify.listen({ port: PORT }, (err) => {
  listenMock();
  if (err) {
    logger.error('Server failed to start', err);
    process.exit();
  }
});

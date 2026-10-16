const fastify = require('fastify')({ logger: true });
const listenMock = require('../mock-server');
const { callWithBreaker } = require('../utils/breaker');
const EVENT_BASE_URL = process.env.EVENT_BASE_URL;
fastify.get('/getUsers', async (request, reply) => {
  const resp = await fetch(`${EVENT_BASE_URL}/getUsers`);
  const data = await resp.json();
  reply.send(data);
});

fastify.post('/addEvent', async (request, reply) => {
  try {
    const data = await callWithBreaker(async () => {
      const resp = await fetch(`${EVENT_BASE_URL}/addEvent`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          id: new Date().getTime(),
          ...request.body
        })
      });
      if (!resp.ok) throw new Error(`Event service responded ${resp.status}`);
      return resp.json();
    });
    reply.send(data);
  } catch (err) {
    if (err.retryAfter) reply.header('Retry-After', err.retryAfter);
    reply.code(503).send({ error: 'Event service unavailable, try again later' });
  }
});
fastify.get('/getEvents', async (request, reply) => {
  const resp = await fetch(`${EVENT_BASE_URL}/getEvents`);
  const data = await resp.json();
  reply.send(data);
});

fastify.get('/getEventsByUserId/:id', async (request, reply) => {
  const { id } = request.params;
  if (!id) {
    reply.code(400).send({ error: 'User ID is required' });
    return;
  }
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
      const eventData = await event.json();
      eventArray.push(eventData);
    }));
    reply.send(eventArray);
  } catch (error) {
    reply.code(500).send({ error: `Error fetching events for user ${id}` });
  }

});

fastify.listen({ port: 3000 }, (err) => {
  listenMock();
  if (err) {
    fastify.log.error(err);
    process.exit();
  }
});

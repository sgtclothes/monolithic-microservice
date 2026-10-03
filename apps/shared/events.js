// RabbitMQ-based event bus (topic exchange "tokoku.events").
// A publisher just "announces" an event (e.g. order.paid) without knowing who
// is listening. Consumers (e.g. notification-service) react on their own.
const amqp = require('amqplib');
const log = require('./logger');

const EXCHANGE = 'tokoku.events';

function createEventBus(url = process.env.RABBITMQ_URL || 'amqp://tokoku:tokoku@rabbitmq:5672') {
  let conn = null;
  let channel = null;
  let connecting = null;
  const subscriptions = [];

  async function connect() {
    if (channel) return channel;
    if (connecting) return connecting;
    connecting = (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          conn = await amqp.connect(url);
          channel = await conn.createConfirmChannel();
          await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
          conn.on('error', (err) => log.warn('rabbitmq connection error', { err: err.message }));
          conn.on('close', () => {
            log.warn('rabbitmq connection closed, reconnect...');
            channel = null;
            conn = null;
            setTimeout(() => connect().catch(() => {}), 2000);
          });
          for (const s of subscriptions) await consume(s);
          log.info('connected to rabbitmq');
          return channel;
        } catch (err) {
          log.warn('rabbitmq not ready yet, retrying...', { attempt, err: err.message });
          await new Promise((r) => setTimeout(r, Math.min(5000, attempt * 1000)));
        }
      }
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  // Publish with publisher confirms: resolves once the broker has stored the message.
  async function publish(routingKey, payload, { timeoutMs = 2000 } = {}) {
    if (!channel) throw new Error('message broker not connected');
    const ch = channel;
    const body = Buffer.from(JSON.stringify(payload));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('publish confirm timeout')), timeoutMs);
      ch.publish(EXCHANGE, routingKey, body, { persistent: true, contentType: 'application/json' }, (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async function consume({ queue, routingKey, prefetch, handler, retryDelayMs }) {
    const ch = channel;
    await ch.assertQueue(queue, { durable: true });
    await ch.bindQueue(queue, EXCHANGE, routingKey);
    await ch.prefetch(prefetch);
    await ch.consume(queue, async (msg) => {
      if (!msg) return;
      try {
        await handler(JSON.parse(msg.content.toString()));
        ch.ack(msg);
      } catch (err) {
        // Failure -> put it back on the queue after a delay (retry). The message is NOT lost.
        log.warn('failed to process event, will retry', { queue, err: err.message });
        setTimeout(() => {
          try {
            ch.nack(msg, false, true);
          } catch {
            /* channel already closed; the broker requeues the message automatically */
          }
        }, retryDelayMs);
      }
    });
  }

  async function subscribe(queue, routingKey, handler, { prefetch = 20, retryDelayMs = 2000 } = {}) {
    const sub = { queue, routingKey, prefetch, handler, retryDelayMs };
    subscriptions.push(sub);
    if (channel) await consume(sub);
    else await connect();
  }

  async function close() {
    if (conn) {
      conn.removeAllListeners('close');
      await conn.close().catch(() => {});
    }
  }

  return { connect, publish, subscribe, close, isConnected: () => Boolean(channel) };
}

module.exports = { createEventBus };

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { HomeError, MqttTransport } from '../src/transport.mjs';

const config = { mqtt: { url: 'mqtt://example.invalid', base_topic: 'zigbee2mqtt', timeout_ms: 50 }, devices: [] };
const device = { device_id: 'lamp', mqtt_topic: 'lamp', require_availability: true, state_confirmation: 'correlated_read' };

class Client extends EventEmitter {
  publications = [];
  subscriptions = [];
  ended = 0;
  subscribe(topics, options, callback) {
    this.subscriptions.push({ topics, options });
    this.ack = (error, grants = topics.map(topic => ({ topic, qos: 0 }))) => callback(error, grants);
    this.onSubscribe?.();
  }
  publish(topic, payload, options, callback) {
    this.publications.push({ topic, payload: JSON.parse(payload), options });
    this.onPublish?.(topic, payload);
    if (!this.noPublishCallback) callback(this.publishError);
  }
  end(force) {
    assert.equal(force, true);
    this.ended += 1;
  }
  message(topic, payload, retain = false) {
    this.emit('message', topic, Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)), { retain });
  }
  ready({ bridge = 'online', available = 'online', ack = true } = {}) {
    this.emit('connect');
    this.message('zigbee2mqtt/bridge/state', { state: bridge }, true);
    this.message('zigbee2mqtt/lamp/availability', { state: available }, true);
    if (ack) this.ack();
  }
  readProperty() {
    return this.publications.find(p => p.payload.read)?.payload.read.state_property;
  }
  readReply(onOff, retain = false) {
    const property = this.readProperty();
    assert.match(property, /^codex_home_read_[0-9a-f]{32}$/);
    this.message('zigbee2mqtt/lamp', { [property]: { onOff } }, retain);
  }
}

function setup(settings = config) {
  const client = new Client();
  let calls = 0;
  let options;
  const transport = new MqttTransport({ connect: (_url, opts) => { calls += 1; options = opts; return client; } });
  return { client, transport, settings, calls: () => calls, options: () => options };
}

function assertClean(client) {
  assert.equal(client.ended, 1);
  assert.deepEqual(client.eventNames(), ['error']);
  assert.equal(client.listenerCount('error'), 1);
}

test('subscribes before publish, waits for ACK, sends one state command then one correlated read', async () => {
  const s = setup();
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.ready({ ack: false });
  assert.equal(s.client.publications.length, 0);
  s.client.ack();
  assert.deepEqual(s.client.publications, [{ topic: 'zigbee2mqtt/lamp/set', payload: { state: 'ON' }, options: { qos: 0, retain: false } }]);
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  assert.equal(s.client.publications.length, 2);
  assert.deepEqual(s.client.publications[1], { topic: 'zigbee2mqtt/lamp/set', payload: { read: {
    cluster: 'genOnOff', attributes: ['onOff'], state_property: s.client.readProperty(),
  } }, options: { qos: 0, retain: false } });
  s.client.readReply(1);
  const result = await pending;
  assert.equal(result.request_outcome, 'confirmed');
  assert.equal(result.confirmation, 'correlated_device_read');
  assert.equal(result.state_freshness_verified, true);
  assert.equal(JSON.stringify(result).includes(s.client.readProperty()), false);
  assert.equal(result.requested_state, 'ON');
  assert.ok(Number.isFinite(Date.parse(result.observed_at)));
  assert.equal(s.options().reconnectPeriod, 0);
  assert.equal(s.options().queueQoSZero, false);
  assert.equal(s.options().resubscribe, false);
  assert.equal(s.calls(), 1);
  assertClean(s.client);
});

test('cached state, optimistic state, old nonce, retained and malformed reports cannot confirm', async () => {
  const s = setup();
  const pending = s.transport.setState(s.settings, device, 'OFF');
  let finished = false;
  pending.then(() => { finished = true; });
  s.client.message('zigbee2mqtt/lamp', { state: 'OFF' });
  s.client.ready();
  s.client.message('zigbee2mqtt/lamp', { state: 'OFF' }, true);
  s.client.message('zigbee2mqtt/other', { state: 'OFF' });
  s.client.message('zigbee2mqtt/lamp', '{bad json');
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  await Promise.resolve();
  assert.equal(finished, false);
  s.client.message('zigbee2mqtt/lamp', { state: 'OFF' });
  const property = s.client.readProperty();
  s.client.message('zigbee2mqtt/lamp', { state: 'OFF', linkquality: 100 });
  s.client.message('zigbee2mqtt/lamp', { codex_home_read_old: { onOff: 0 } });
  s.client.message('zigbee2mqtt/other', { [property]: { onOff: 0 } });
  s.client.readReply(0, true);
  for (const value of [null, {}, '0', 'OFF', 2]) s.client.readReply(value);
  await Promise.resolve();
  assert.equal(finished, false);
  s.client.readReply(0);
  assert.equal((await pending).state, 'OFF');
  assertClean(s.client);
});

for (const [label, ready, code] of [
  ['bridge offline', { bridge: 'offline' }, 'BRIDGE_OFFLINE'],
  ['device offline', { available: 'offline' }, 'DEVICE_OFFLINE'],
]) {
  test(`${label} never sends a control`, async () => {
    const s = setup();
    const pending = s.transport.setState(s.settings, device, 'ON');
    s.client.ready(ready);
    await assert.rejects(pending, error => error.code === code && error.outcome === 'not_sent');
    assert.equal(s.client.publications.length, 0);
    assertClean(s.client);
  });
}

test('all phases share a deadline, missing availability does not publish', async () => {
  const s = setup();
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.emit('connect');
  s.client.ack();
  s.client.message('zigbee2mqtt/bridge/state', 'online', true);
  await assert.rejects(pending, error => error.code === 'MQTT_TIMEOUT' && error.outcome === 'not_sent');
  assert.equal(s.client.publications.length, 0);
  assertClean(s.client);
});

test('wrong state eventually returns unknown without retry', async () => {
  const s = setup();
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.ready();
  s.client.message('zigbee2mqtt/lamp', { state: 'OFF' });
  await assert.rejects(pending, error => error.code === 'MQTT_TIMEOUT' && error.outcome === 'unknown' && error.retry_safe === false);
  assert.equal(s.client.publications.length, 1);
  assert.equal(s.calls(), 1);
  assertClean(s.client);
});

for (const event of ['close', 'disconnect', 'offline', 'error']) {
  test(`${event} after publish is unknown and never retried`, async () => {
    const s = setup();
    const pending = s.transport.setState(s.settings, device, 'ON');
    s.client.ready();
    s.client.emit(event, new Error('secret mqtt://password@broker'));
    await assert.rejects(pending, error => error.outcome === 'unknown' && error.retry_safe === false && !error.message.includes('password'));
    assert.equal(s.client.publications.length, 1);
    assert.equal(s.calls(), 1);
    assertClean(s.client);
  });
}

test('publish error is unknown, no broker error text leaks', async () => {
  const s = setup();
  s.client.publishError = new Error('private password');
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.ready();
  await assert.rejects(pending, error => error.code === 'MQTT_PUBLISH_FAILED' && error.outcome === 'unknown' && !error.message.includes('private'));
  assertClean(s.client);
});

test('retained reports never confirm even when publish callback is pending', async () => {
  const s = setup();
  s.client.noPublishCallback = true;
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.ready();
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' }, true);
  await assert.rejects(pending, error => error.code === 'MQTT_TIMEOUT' && error.outcome === 'unknown');
  assertClean(s.client);
});

test('subscription ACL rejection prevents command', async () => {
  const s = setup();
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.ready({ ack: false });
  s.client.ack(undefined, s.client.subscriptions[0].topics.map(topic => ({ topic, qos: 128 })));
  await assert.rejects(pending, error => error.code === 'MQTT_SUBSCRIBE_FAILED' && error.outcome === 'not_sent');
  assert.equal(s.client.publications.length, 0);
  assertClean(s.client);
});

test('subscription callback error and missing grants prevent command', async () => {
  for (const [error, grants] of [[new Error('private URL'), []], [undefined, []]]) {
    const s = setup();
    const pending = s.transport.setState(s.settings, device, 'ON');
    s.client.ready({ ack: false });
    s.client.ack(error, grants);
    await assert.rejects(pending, value => value.code === 'MQTT_SUBSCRIBE_FAILED' && !value.message.includes('private'));
    assert.equal(s.client.publications.length, 0);
    assertClean(s.client);
  }
});

test('health reads retained bridge state without controlling or querying devices', async () => {
  for (const state of ['online', 'offline']) {
    const s = setup();
    const pending = s.transport.health(s.settings);
    s.client.emit('connect');
    s.client.ack();
    s.client.message('zigbee2mqtt/bridge/state', { state }, true);
    assert.equal((await pending).bridge_state, state);
    assert.deepEqual(s.client.subscriptions[0].topics, ['zigbee2mqtt/bridge/state']);
    assert.equal(s.client.publications.length, 0);
    assertClean(s.client);
  }
});

test('correlated status sends a fixed read-only payload and requires its exact response', async () => {
  const s = setup();
  const pending = s.transport.status(s.settings, device);
  s.client.ready();
  assert.deepEqual(s.client.publications[0], { topic: 'zigbee2mqtt/lamp/set', payload: { read: {
    cluster: 'genOnOff', attributes: ['onOff'], state_property: s.client.readProperty(),
  } }, options: { qos: 0, retain: false } });
  s.client.readReply(0);
  assert.equal((await pending).state, 'OFF');
  assertClean(s.client);
});

test('optional availability gate supports devices without availability', async () => {
  const s = setup();
  const pending = s.transport.status(s.settings, { ...device, require_availability: false });
  s.client.emit('connect');
  s.client.ack();
  s.client.message('zigbee2mqtt/bridge/state', 'online', true);
  assert.equal(s.client.publications.length, 1);
  assert.equal(s.client.subscriptions[0].topics.includes('zigbee2mqtt/lamp/availability'), false);
  s.client.readReply(1);
  await pending;
  assertClean(s.client);
});

test('oversized relevant message fails safely without echoing data', async () => {
  const s = setup();
  const pending = s.transport.status(s.settings, device);
  s.client.ready();
  s.client.message('zigbee2mqtt/lamp', 'sensitive'.repeat(2000));
  await assert.rejects(pending, error => error.code === 'MQTT_INVALID_MESSAGE' && !error.message.includes('sensitive'));
  assertClean(s.client);
});

test('hung connection and subscription both respect total timeout', async () => {
  for (const connect of [false, true]) {
    const s = setup();
    const pending = s.transport.status(s.settings, device);
    if (connect) s.client.emit('connect');
    await assert.rejects(pending, error => error.code === 'MQTT_TIMEOUT' && error.outcome === 'not_sent');
    assertClean(s.client);
  }
});

test('invalid desired state and synchronous connect failures are safe', async () => {
  const s = setup();
  await assert.rejects(s.transport.setState(s.settings, device, 'TOGGLE'), error => error instanceof HomeError && error.code === 'INVALID_STATE');
  assert.equal(s.calls(), 0);
  const transport = new MqttTransport({ connect: () => { throw new Error('mqtt://secret'); } });
  await assert.rejects(transport.health(config), error => error.code === 'MQTT_CONNECTION_ERROR' && !error.message.includes('secret'));
});

test('late errors after completion and after timeout cannot crash the MCP process', async () => {
  for (const successful of [true, false]) {
    const s = setup();
    const pending = s.transport.status(s.settings, device);
    if (successful) {
      s.client.ready();
      s.client.readReply(1);
      await pending;
    } else {
      await assert.rejects(pending, error => error.code === 'MQTT_TIMEOUT');
    }
    assert.doesNotThrow(() => {
      s.client.emit('error', new Error('late private socket failure'));
      s.client.emit('close');
      s.client.emit('error', new Error('another late socket failure'));
    });
    assertClean(s.client);
  }
});

test('pre-aborted signal prevents connecting for every operation', async () => {
  for (const operation of ['health', 'status', 'setState']) {
    const s = setup();
    const controller = new AbortController();
    controller.abort('private reason');
    const pending = operation === 'health' ? s.transport.health(s.settings, { signal: controller.signal })
      : operation === 'status' ? s.transport.status(s.settings, device, { signal: controller.signal })
        : s.transport.setState(s.settings, device, 'ON', { signal: controller.signal });
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED' && error.outcome === 'not_sent' && !error.message.includes('private'));
    assert.equal(s.calls(), 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test('cancelling while waiting for subscription ACK prevents late control publication', async () => {
  const s = setup();
  const controller = new AbortController();
  const pending = s.transport.setState(s.settings, device, 'ON', { signal: controller.signal });
  s.client.ready({ ack: false });
  controller.abort();
  s.client.ack();
  s.client.message('zigbee2mqtt/bridge/state', 'online', true);
  s.client.message('zigbee2mqtt/lamp/availability', 'online', true);
  await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED' && error.outcome === 'not_sent');
  assert.equal(s.client.publications.length, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assertClean(s.client);
});

test('cancelling after set publication returns unknown with no retry', async () => {
  const s = setup();
  const controller = new AbortController();
  const pending = s.transport.setState(s.settings, device, 'ON', { signal: controller.signal });
  s.client.ready();
  controller.abort();
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED' && error.outcome === 'unknown' && error.retry_safe === false);
  assert.equal(s.client.publications.length, 1);
  assert.equal(s.calls(), 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assertClean(s.client);
});

test('cancelled connection cannot subscribe after a late connect event', async () => {
  const s = setup();
  const controller = new AbortController();
  const pending = s.transport.setState(s.settings, device, 'ON', { signal: controller.signal });
  controller.abort();
  s.client.emit('connect');
  await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED' && error.outcome === 'not_sent');
  assert.equal(s.client.subscriptions.length, 0);
  assert.equal(s.client.publications.length, 0);
  assertClean(s.client);
});

test('abort during client creation closes client without subscribing', async () => {
  const controller = new AbortController();
  const client = new Client();
  const transport = new MqttTransport({ connect: () => { controller.abort(); return client; } });
  await assert.rejects(transport.health(config, { signal: controller.signal }), error => error.code === 'REQUEST_ABORTED' && error.outcome === 'not_sent');
  assert.equal(client.subscriptions.length, 0);
  assertClean(client);
});

test('successful completion removes AbortSignal listener', async () => {
  const s = setup();
  const controller = new AbortController();
  const pending = s.transport.status(s.settings, device, { signal: controller.signal });
  s.client.ready();
  s.client.readReply(0);
  await pending;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  assertClean(s.client);
});

test('unverified mode is read-only and labels potentially cached state honestly', async () => {
  const s = setup();
  const unverified = { ...device, state_confirmation: 'unverified' };
  await assert.rejects(s.transport.setState(s.settings, unverified, 'ON'), error => error.code === 'STATE_CONFIRMATION_REQUIRED' && error.outcome === 'not_sent');
  assert.equal(s.calls(), 0);
  const pending = s.transport.status(s.settings, unverified);
  s.client.ready();
  assert.deepEqual(s.client.publications[0], { topic: 'zigbee2mqtt/lamp/get', payload: { state: '' }, options: { qos: 0, retain: false } });
  s.client.message('zigbee2mqtt/lamp', { state: 'ON', linkquality: 10 });
  const result = await pending;
  assert.equal(result.confirmation, 'unverified_gateway_report');
  assert.equal(result.state_freshness_verified, false);
  assert.equal(result.request_outcome, 'unverified');
  assertClean(s.client);
});

test('mismatching correlated read fails unknown without another write or read', async () => {
  const s = setup();
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.ready();
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  s.client.readReply(0);
  await assert.rejects(pending, error => error.code === 'STATE_MISMATCH' && error.outcome === 'unknown' && error.retry_safe === false);
  assert.equal(s.client.publications.length, 2);
  assertClean(s.client);
});

test('state alone never confirms, even after the read starts', async () => {
  const s = setup();
  const pending = s.transport.setState(s.settings, device, 'ON');
  s.client.ready();
  for (let i = 0; i < 3; i++) s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  await assert.rejects(pending, error => error.code === 'MQTT_TIMEOUT' && error.outcome === 'unknown');
  assert.equal(s.client.publications.length, 2);
  assertClean(s.client);
});

test('every read has a new property; a prior read response is not accepted', async () => {
  const first = setup();
  const one = first.transport.status(first.settings, device);
  first.client.ready();
  const oldProperty = first.client.readProperty();
  first.client.readReply(true);
  assert.equal((await one).state, 'ON');
  const second = setup();
  const two = second.transport.status(second.settings, device);
  second.client.ready();
  assert.notEqual(second.client.readProperty(), oldProperty);
  second.client.message('zigbee2mqtt/lamp', { [oldProperty]: { onOff: 1 }, state: 'ON' });
  second.client.readReply(false);
  assert.equal((await two).state, 'OFF');
});

test('read waits for successful write callback and stops on callback failure', async () => {
  for (const fails of [false, true]) {
    const s = setup();
    const originalPublish = s.client.publish.bind(s.client);
    let callback;
    s.client.publish = (topic, payload, options, cb) => {
      if (JSON.parse(payload).state) {
        s.client.noPublishCallback = true;
        callback = cb;
      } else s.client.noPublishCallback = false;
      originalPublish(topic, payload, options, cb);
    };
    const pending = s.transport.setState(s.settings, device, 'ON');
    s.client.ready();
    s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
    assert.equal(s.client.publications.length, 1);
    callback(fails ? new Error('private detail') : undefined);
    if (fails) {
      await assert.rejects(pending, error => error.code === 'MQTT_PUBLISH_FAILED' && error.outcome === 'unknown');
      assert.equal(s.client.publications.length, 1);
    } else {
      s.client.readReply(1);
      assert.equal((await pending).state, 'ON');
      assert.equal(s.client.publications.length, 2);
    }
    assertClean(s.client);
  }
});

test('cancellation during read preparation never sends a late read', async () => {
  const s = setup();
  const ac = new AbortController();
  const pending = s.transport.setState(s.settings, device, 'ON', { signal: ac.signal });
  s.client.ready();
  ac.abort();
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED' && error.outcome === 'unknown');
  assert.equal(s.client.publications.length, 1);
});

test('cancellation after the correlated read is sent rejects a late valid response', async () => {
  const s = setup();
  const controller = new AbortController();
  const pending = s.transport.setState(s.settings, device, 'ON', { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.code === 'REQUEST_ABORTED' && error.outcome === 'unknown' && error.retry_safe === false);
  s.client.ready();
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  assert.equal(s.client.publications.length, 2);
  controller.abort();
  s.client.readReply(1);
  await rejected;
  assert.equal(s.client.publications.length, 2);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assertClean(s.client);
});

test('a late write callback after the deadline never sends a correlated read', async () => {
  const s = setup();
  const originalPublish = s.client.publish.bind(s.client);
  let callback;
  s.client.noPublishCallback = true;
  s.client.publish = (topic, payload, options, cb) => {
    callback = cb;
    originalPublish(topic, payload, options, cb);
  };
  const pending = s.transport.setState(s.settings, device, 'ON');
  const rejected = assert.rejects(pending, error => error.code === 'MQTT_TIMEOUT' && error.outcome === 'unknown');
  s.client.ready();
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  assert.equal(s.client.publications.length, 1);
  await rejected;
  callback();
  s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
  assert.equal(s.client.publications.length, 1);
  assertClean(s.client);
});

test('going offline during a correlated read rejects a late valid response', async () => {
  for (const [topic, code] of [
    ['zigbee2mqtt/bridge/state', 'BRIDGE_OFFLINE'],
    ['zigbee2mqtt/lamp/availability', 'DEVICE_OFFLINE'],
  ]) {
    const s = setup();
    const pending = s.transport.setState(s.settings, device, 'ON');
    const rejected = assert.rejects(pending, error => error.code === code && error.outcome === 'unknown');
    s.client.ready();
    s.client.message('zigbee2mqtt/lamp', { state: 'ON' });
    assert.equal(s.client.publications.length, 2);
    s.client.message(topic, { state: 'offline' });
    s.client.readReply(1);
    await rejected;
    assert.equal(s.client.publications.length, 2);
    assertClean(s.client);
  }
});

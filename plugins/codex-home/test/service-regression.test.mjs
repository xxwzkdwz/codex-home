import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.mjs';
import { HomeService, resolveDevice } from '../src/service.mjs';
import { HomeError } from '../src/transport.mjs';

// Pure service tests: injected loader/transport, no files or broker connections.
const lamp = {
  device_id: 'light.demo', room_id: 'demo_room', name: 'Demo lamp', aliases: ['demo'],
  kind: 'light', mqtt_topic: 'demo-lamp', state_confirmation: 'correlated_read',
};
const make = devices => parseConfig({ version: 1, devices: devices ?? [lamp] });
const confirmed = {
  state: 'ON', confirmation: 'correlated_device_read', state_freshness_verified: true, request_outcome: 'confirmed',
};
const atBroker = (url, { base_topic = 'zigbee2mqtt', mqtt_topic = lamp.mqtt_topic } = {}) => parseConfig({
  version: 1, mqtt: { url, base_topic, allow_insecure_lan: true }, devices: [{ ...lamp, mqtt_topic }],
});
const equivalentBrokers = [
  ['MQTT default port and root slash', ['mqtt://127.0.0.1:1883', 'mqtt://127.0.0.1:1883/', 'mqtt://127.0.0.1', 'mqtt://127.0.0.1:01883/']],
  ['MQTTS default port and hostname case', ['mqtts://broker.example:8883', 'mqtts://broker.example/', 'MQTTS://BROKER.EXAMPLE:8883/']],
  ['MQTT hostname case', ['mqtt://broker.example:1883', 'MQTT://BROKER.EXAMPLE/']],
  ['IPv6 spelling', ['mqtt://[::1]:1883', 'mqtt://[0:0:0:0:0:0:0:1]/']],
];

for (const [label, urls] of equivalentBrokers) {
  test(`unknown protection survives equivalent broker URLs: ${label}`, async () => {
    let config = atBroker(urls[0]);
    let writes = 0;
    const seenUrls = [];
    const service = new HomeService({ loader: async () => config, transport: {
      setState: async current => {
        seenUrls.push(current.mqtt.url);
        if (++writes === 1) throw new HomeError('MQTT_TIMEOUT', 'Synthetic unknown write', { outcome: 'unknown' });
        return confirmed;
      },
      status: async current => { seenUrls.push(current.mqtt.url); return confirmed; },
    } });
    await assert.rejects(service.setState('demo', 'ON'), { outcome: 'unknown' });
    for (const url of urls) {
      config = atBroker(url);
      await assert.rejects(service.setState('demo', 'OFF'), { code: 'STATUS_REQUIRED', outcome: 'unknown' });
    }
    assert.equal(writes, 1);
    await service.status('demo');
    config = atBroker(urls[0]);
    assert.equal((await service.setState('demo', 'OFF')).request_outcome, 'confirmed');
    assert.equal(writes, 2);
    assert.deepEqual(seenUrls, [urls[0], urls.at(-1), urls[0]], 'Canonical lock keys must not rewrite transport configuration.');
  });

  test(`pending protection survives equivalent broker URLs: ${label}`, async () => {
    let config = atBroker(urls[0]);
    let started, finish;
    let writes = 0;
    const entered = new Promise(resolve => { started = resolve; });
    const service = new HomeService({ loader: async () => config, transport: {
      setState: async () => {
        if (++writes > 1) return confirmed;
        started();
        return new Promise(resolve => { finish = resolve; });
      },
      status: async () => confirmed,
    } });
    const first = service.setState('demo', 'ON');
    await entered;
    try {
      for (const url of urls) {
        config = atBroker(url);
        await assert.rejects(service.setState('demo', 'OFF'), { code: 'DEVICE_BUSY' });
        await assert.rejects(service.status('demo'), { code: 'DEVICE_BUSY' });
      }
      assert.equal(writes, 1);
    } finally {
      finish(confirmed);
      await first;
    }
    assert.equal((await service.status('demo')).request_outcome, 'confirmed', 'Completion releases the canonical pending key.');
  });
}

for (const [label, url, options] of [
  ['hostname', 'mqtt://other.example:1883'],
  ['port', 'mqtt://broker.example:1884'],
  ['protocol even with the same explicit port', 'mqtts://broker.example:1883'],
  ['base topic', 'mqtt://broker.example:1883', { base_topic: 'other-gateway' }],
  ['device topic', 'mqtt://broker.example:1883', { mqtt_topic: 'other-lamp' }],
]) {
  test(`unknown protection remains independent for a different ${label}`, async () => {
    const original = atBroker('mqtt://broker.example:1883');
    let config = original;
    let writes = 0;
    const service = new HomeService({ loader: async () => config, transport: {
      setState: async () => {
        if (++writes === 1) throw new HomeError('MQTT_TIMEOUT', 'Synthetic unknown write', { outcome: 'unknown' });
        return confirmed;
      },
      status: async () => confirmed,
    } });
    await assert.rejects(service.setState('demo', 'ON'), { outcome: 'unknown' });
    config = atBroker(url, options);
    assert.equal((await service.setState('demo', 'OFF')).request_outcome, 'confirmed');
    await service.status('demo');
    config = original;
    await assert.rejects(service.setState('demo', 'OFF'), { code: 'STATUS_REQUIRED' });
    assert.equal(writes, 2, 'Reading a different broker or topic must not clear the original protection.');
  });
}

test('escaped hostnames do not share protection with WHATWG-equivalent Unicode hostnames', async () => {
  // MQTT's legacy URL parser interprets an explicit percent sign differently
  // from WHATWG URL. These accepted strings must not share a protection key.
  const original = atBroker('mqtts://bücher.example');
  let config = original;
  let writes = 0;
  const service = new HomeService({ loader: async () => config, transport: {
    setState: async () => {
      if (++writes === 1) throw new HomeError('MQTT_TIMEOUT', 'Synthetic unknown write', { outcome: 'unknown' });
      return confirmed;
    },
    status: async () => confirmed,
  } });
  await assert.rejects(service.setState('demo', 'ON'), { outcome: 'unknown' });
  config = atBroker('mqtts://b%C3%BCcher.example');
  assert.equal((await service.setState('demo', 'OFF')).request_outcome, 'confirmed');
  await service.status('demo');
  config = original;
  await assert.rejects(service.setState('demo', 'OFF'), { code: 'STATUS_REQUIRED' });
  assert.equal(writes, 2);
});

test('an exact device ID wins over another enabled light name or alias', () => {
  const other = { ...lamp, device_id: 'light.other', mqtt_topic: 'other-lamp', name: 'light.demo', aliases: ['light.demo'] };
  for (const devices of [[lamp, other], [other, lamp]]) {
    const config = make(devices);
    assert.equal(resolveDevice(config, 'light.demo').device_id, 'light.demo');
    assert.equal(resolveDevice(config, 'Light.Demo').device_id, 'light.demo');
    assert.equal(resolveDevice(config, 'light.other').device_id, 'light.other');
  }
});

test('a disabled exact ID never falls back to another light matching its alias', () => {
  const config = make([
    { ...lamp, enabled: false },
    { ...lamp, device_id: 'light.other', mqtt_topic: 'other-lamp', name: 'Other lamp', aliases: ['light.demo'] },
  ]);
  assert.throws(() => resolveDevice(config, 'light.demo'), { code: 'DEVICE_NOT_FOUND' });
  assert.throws(() => resolveDevice(config, 'Light.Demo'), { code: 'DEVICE_NOT_FOUND' });
  assert.equal(resolveDevice(config, 'light.other').device_id, 'light.other');
});

test('default unverified mode is read-only and does not call the write transport', async () => {
  let writes = 0;
  const service = new HomeService({
    loader: async () => make([{ ...lamp, state_confirmation: undefined }]),
    transport: {
      setState: async () => { writes++; return confirmed; },
      status: async () => ({ state: 'OFF', confirmation: 'unverified_gateway_report', state_freshness_verified: false, request_outcome: 'unverified' }),
    },
  });
  assert.equal((await service.list()).devices[0].state_confirmation, 'unverified');
  await assert.rejects(service.setState('light.demo', 'ON'), { code: 'STATE_CONFIRMATION_REQUIRED', outcome: 'not_sent' });
  const status = await service.status('demo');
  assert.equal(status.confirmation, 'unverified_gateway_report');
  assert.equal(status.state_freshness_verified, false);
  assert.equal(writes, 0);
});

test('ordinary states, stale nonce payloads, and incomplete freshness evidence never unlock unknown', async () => {
  let writes = 0;
  let observation;
  const service = new HomeService({ loader: async () => make(), transport: {
    setState: async () => { writes++; throw new HomeError('MQTT_TIMEOUT', 'Synthetic unknown write', { outcome: 'unknown' }); },
    status: async () => observation,
  } });
  await assert.rejects(service.setState('light.demo', 'ON'), { outcome: 'unknown' });
  for (const result of [
    { state: 'ON' },
    { state: 'ON', [`codex_home_read_${'0'.repeat(32)}`]: { onOff: 1 } },
    { ...confirmed, confirmation: 'fresh_gateway_report' },
    { ...confirmed, confirmation: 'unverified_gateway_report' },
    { ...confirmed, state_freshness_verified: false },
    { ...confirmed, state_freshness_verified: undefined },
    { ...confirmed, request_outcome: 'unverified' },
  ]) {
    observation = result;
    await service.status('demo');
    await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'STATUS_REQUIRED', outcome: 'unknown' });
  }
  assert.equal(writes, 1);
  observation = confirmed;
  await service.status('demo');
  await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'MQTT_TIMEOUT', outcome: 'unknown' });
  assert.equal(writes, 2, 'Only a fully verified correlated read may unlock a new explicit action.');
});

test('switching to default mode cannot clear an existing unknown latch even with a trusted-looking result', async () => {
  let config = make();
  let writes = 0;
  const service = new HomeService({ loader: async () => config, transport: {
    setState: async () => { writes++; throw new HomeError('MQTT_TIMEOUT', 'Synthetic unknown write', { outcome: 'unknown' }); },
    status: async () => confirmed,
  } });
  await assert.rejects(service.setState('light.demo', 'ON'), { outcome: 'unknown' });
  config = make([{ ...lamp, state_confirmation: undefined }]);
  await service.status('light.demo');
  config = make();
  await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'STATUS_REQUIRED', outcome: 'unknown' });
  assert.equal(writes, 1);
  await service.status('light.demo');
  await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'MQTT_TIMEOUT', outcome: 'unknown' });
  assert.equal(writes, 2);
});

test('a failed status read leaves the unknown latch intact', async () => {
  let writes = 0;
  const service = new HomeService({ loader: async () => make(), transport: {
    setState: async () => { writes++; throw new HomeError('STATE_MISMATCH', 'Synthetic mismatched read', { outcome: 'unknown' }); },
    status: async () => { throw new HomeError('MQTT_TIMEOUT', 'Synthetic read failure'); },
  } });
  await assert.rejects(service.setState('demo', 'ON'), { code: 'STATE_MISMATCH', outcome: 'unknown' });
  await assert.rejects(service.status('demo'), { code: 'MQTT_TIMEOUT' });
  await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'STATUS_REQUIRED' });
  assert.equal(writes, 1);
});

test('unknown protection follows a device across aliases without blocking a different lamp', async () => {
  const other = { ...lamp, device_id: 'light.other', mqtt_topic: 'other-lamp', name: 'Other lamp', aliases: ['other'] };
  const writes = [];
  const service = new HomeService({ loader: async () => make([lamp, other]), transport: {
    setState: async (_config, device) => {
      writes.push(device.device_id);
      if (device.device_id === lamp.device_id) throw new HomeError('MQTT_TIMEOUT', 'Synthetic unknown write', { outcome: 'unknown' });
      return confirmed;
    },
    status: async () => confirmed,
  } });
  await assert.rejects(service.setState('demo', 'ON'), { outcome: 'unknown' });
  await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'STATUS_REQUIRED' });
  assert.equal((await service.setState('other', 'ON')).device_id, 'light.other');
  await service.status('other');
  await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'STATUS_REQUIRED' });
  assert.deepEqual(writes, ['light.demo', 'light.other']);
});

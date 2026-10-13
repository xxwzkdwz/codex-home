import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseConfig, createConfig, loadConfig, ConfigError } from '../src/config.mjs';
import { HomeService, resolveDevice, safeError } from '../src/service.mjs';
import { HomeError } from '../src/transport.mjs';

const lamp = { device_id: 'light.demo', room_id: 'demo_room', name: 'Demo light', aliases: ['demo'], kind: 'light', mqtt_topic: 'demo-light' };
const make = (overrides = {}) => parseConfig({ version: 1, mqtt: {}, devices: [lamp], ...overrides });
const fixture = async t => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vico-home-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return path.join(dir, 'config.json'); };

test('safe defaults, literal lights and unique IDs/topics', () => {
  const config = make();
  assert.equal(config.mqtt.url, 'mqtt://127.0.0.1:1883');
  assert.equal(config.devices[0].require_availability, true);
  assert.equal(make({ mqtt: undefined }).mqtt.timeout_ms, 8000);
  for (const devices of [[{ ...lamp, kind: 'lock' }], [lamp, lamp], [{ ...lamp, mqtt_topic: 'bridge' }], [{ ...lamp, mqtt_topic: 'x/../set' }], [{ ...lamp, mqtt_topic: '+' }], [{ ...lamp, capabilities: ['brightness'] }]]) {
    assert.throws(() => make({ devices }), ConfigError);
  }
});
test('URL policy forbids credentials and unsafe endpoints', () => {
  for (const url of ['http://localhost', 'mqtt://user:secret@localhost', 'mqtt://localhost?token=secret', 'mqtt://localhost/path', 'mqtt://localhost:0', 'mqtt://198.51.100.1']) assert.throws(() => make({ mqtt: { url } }), ConfigError);
  assert.equal(make({ mqtt: { url: 'mqtts://broker.example.com' } }).mqtt.url, 'mqtts://broker.example.com');
  assert.equal(make({ mqtt: { url: 'mqtt://198.51.100.1', allow_insecure_lan: true } }).mqtt.allow_insecure_lan, true);
});
test('private config created once, credentials are not returned in public list', async t => {
  const file = await fixture(t);
  await createConfig(file, make());
  await assert.rejects(createConfig(file, make()), { code: 'CONFIG_EXISTS' });
  const loaded = await loadConfig(file);
  assert.equal(loaded.devices.length, 1);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const result = await new HomeService({ configPath: file }).list();
  assert.equal(result.count, 1);
  assert.equal(JSON.stringify(result).includes('mqtt_topic'), false);
  assert.equal(JSON.stringify(result).includes('127.0.0.1'), false);
});
test('unsafe permissions and oversized config rejected', async t => {
  const file = await fixture(t);
  await fs.writeFile(file, 'x'.repeat(70000), { mode: 0o600 });
  await assert.rejects(loadConfig(file), { code: 'CONFIG_INVALID' });
  await fs.writeFile(file, JSON.stringify(make()));
  if (process.platform !== 'win32') {
    await fs.chmod(file, 0o644);
    await assert.rejects(loadConfig(file), { code: 'CONFIG_PERMISSIONS' });
  }
});
test('secrets supplied locally and fixed errors cannot disclose their values', async t => {
  const file = await fixture(t);
  await createConfig(file, make({ mqtt: { username_env: 'TEST_USER', password_env: 'TEST_PASSWORD' } }));
  const loaded = await loadConfig(file, { TEST_USER: 'test-user', TEST_PASSWORD: 'synthetic-password' });
  assert.equal(loaded.mqtt.password, 'synthetic-password');
  await assert.rejects(loadConfig(file, {}), { code: 'CREDENTIAL_MISSING' });
  assert.equal(JSON.stringify(safeError(new Error('synthetic-password'))).includes('synthetic-password'), false);
  assert.throws(() => make({ mqtt: { password_file: 'password', password_env: 'TEST_PASSWORD' } }), ConfigError);
});
test('resolve exact aliases, reject ambiguity and disabled devices', () => {
  const config = make({ devices: [lamp, { ...lamp, device_id: 'light.other', mqtt_topic: 'other', name: 'Other', aliases: ['demo'] }] });
  assert.equal(resolveDevice(config, 'Light.Demo').device_id, 'light.demo');
  assert.throws(() => resolveDevice(config, 'demo'), { code: 'DEVICE_AMBIGUOUS' });
  assert.throws(() => resolveDevice(config, 'missing'), { code: 'DEVICE_NOT_FOUND' });
  assert.throws(() => resolveDevice(make({ devices: [{ ...lamp, enabled: false }] }), 'light.demo'), { code: 'DEVICE_NOT_FOUND' });
});
test('write values restricted and unknown outcomes latch until a fresh read', async () => {
  let writes = 0;
  const service = new HomeService({ loader: async () => make(), transport: {
    setState: async () => { writes++; throw new HomeError('TIMEOUT', 'Timed out', { outcome: 'unknown' }); },
    status: async () => ({ state: 'ON', confirmation: 'fresh_gateway_report' }),
  } });
  assert.throws(() => service.setState('light.demo', 'TOGGLE'), { code: 'STATE_INVALID' });
  await assert.rejects(service.setState('light.demo', 'ON'), { outcome: 'unknown' });
  await assert.rejects(service.setState('light.demo', 'ON'), { code: 'STATUS_REQUIRED' });
  assert.equal(writes, 1);
  await service.status('light.demo');
  await assert.rejects(service.setState('light.demo', 'OFF'), { outcome: 'unknown' });
  assert.equal(writes, 2);
});
test('busy device rejected rather than queuing a delayed physical action', async () => {
  let finish;
  const service = new HomeService({ loader: async () => make(), transport: { setState: () => new Promise(resolve => { finish = resolve; }) } });
  const first = service.setState('light.demo', 'ON');
  await Promise.resolve();
  await assert.rejects(service.setState('light.demo', 'OFF'), { code: 'DEVICE_BUSY' });
  finish({ state: 'ON' });
  await first;
});
test('AbortSignal reaches transport; already cancelled writes never reach it', async () => {
  const ac = new AbortController(); let calls = 0;
  const service = new HomeService({ loader: async () => make(), transport: { setState: async (_c, _d, _s, { signal }) => { calls++; assert.equal(signal, ac.signal); return { state: 'ON' }; } } });
  await service.setState('light.demo', 'ON', { signal: ac.signal });
  ac.abort();
  await assert.rejects(service.setState('light.demo', 'ON', { signal: ac.signal }), { code: 'REQUEST_CANCELLED' });
  assert.equal(calls, 1);
});
test('unexpected transport exception is conservatively unknown and redacted', async () => {
  const service = new HomeService({ loader: async () => make(), transport: { setState: async () => { throw new Error('secret-network-detail'); } } });
  await assert.rejects(service.setState('light.demo', 'ON'), error => {
    assert.equal(error.outcome, 'unknown');
    assert.equal(JSON.stringify(safeError(error)).includes('secret-network-detail'), false);
    return true;
  });
});

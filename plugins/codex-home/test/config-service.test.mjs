import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseConfig, createConfig, loadConfig, readPrivateFile, MAX_CONFIG_BYTES, ConfigError } from '../src/config.mjs';
import { HomeService, resolveDevice, safeError } from '../src/service.mjs';
import { HomeError } from '../src/transport.mjs';

const lamp = { device_id: 'light.demo', room_id: 'demo_room', name: 'Demo light', aliases: ['demo'], kind: 'light', mqtt_topic: 'demo-light', state_confirmation: 'correlated_read' };
const make = (overrides = {}) => parseConfig({ version: 1, mqtt: {}, devices: [lamp], ...overrides });
const fixture = async t => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return path.join(dir, 'config.json'); };
const run = promisify(execFile);

test('safe defaults, literal lights and unique IDs/topics', () => {
  const config = make();
  assert.equal(config.mqtt.url, 'mqtt://127.0.0.1:1883');
  assert.equal(config.devices[0].require_availability, true);
  assert.equal(make({ devices: [{ ...lamp, state_confirmation: undefined }] }).devices[0].state_confirmation, 'unverified');
  assert.throws(() => make({ devices: [{ ...lamp, state_confirmation: 'assume_verified' }] }), ConfigError);
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
  await assert.rejects(loadConfig(file), { code: 'CONFIG_TOO_LARGE' });
  await fs.writeFile(file, JSON.stringify(make()));
  if (process.platform !== 'win32') {
    await fs.chmod(file, 0o644);
    await assert.rejects(loadConfig(file), { code: 'CONFIG_PERMISSIONS' });
  }
});

test('expanded oversized configuration is rejected before creating any destination', async t => {
  const file = path.join(path.dirname(await fixture(t)), 'not-created', 'config.json');
  const devices = Array.from({ length: 256 }, (_, i) => ({ ...lamp, device_id: `light.demo${i}`, mqtt_topic: `demo${i}`, aliases: [] }));
  const raw = { version: 1, devices };
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) < MAX_CONFIG_BYTES);
  assert.ok(Buffer.byteLength(`${JSON.stringify(parseConfig(raw), null, 2)}\n`) > MAX_CONFIG_BYTES);
  await assert.rejects(createConfig(file, raw), error => error.code === 'CONFIG_TOO_LARGE' && error.message.includes(String(MAX_CONFIG_BYTES)));
  await assert.rejects(fs.stat(path.dirname(file)), { code: 'ENOENT' });
});

test('configuration size limit counts UTF-8 bytes rather than JavaScript characters', async t => {
  const file = await fixture(t);
  const data = make({ devices: Array.from({ length: 70 }, (_, i) => ({
    ...lamp, device_id: `light.demo${i}`, mqtt_topic: `demo${i}`, name: '灯'.repeat(80), aliases: Array(3).fill('灯'.repeat(80)),
  })) });
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  assert.ok(serialized.length < MAX_CONFIG_BYTES);
  assert.ok(Buffer.byteLength(serialized) > MAX_CONFIG_BYTES);
  await assert.rejects(createConfig(file, data), { code: 'CONFIG_TOO_LARGE' });
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('exact-limit configuration remains readable and oversized input preserves it', async t => {
  const file = await fixture(t);
  const data = make({ devices: Array.from({ length: 180 }, (_, i) => ({
    ...lamp, device_id: `light.demo${i}`, mqtt_topic: `demo${i}`, aliases: [],
  })) });
  let remaining = MAX_CONFIG_BYTES - Buffer.byteLength(`${JSON.stringify(data, null, 2)}\n`);
  assert.ok(remaining > 0);
  for (const device of data.devices) {
    const added = Math.min(remaining, 80 - device.name.length);
    device.name += 'x'.repeat(added);
    remaining -= added;
  }
  assert.equal(remaining, 0);
  await createConfig(file, data);
  const original = await fs.readFile(file);
  assert.equal(original.length, MAX_CONFIG_BYTES);
  assert.equal((await loadConfig(file)).devices.length, data.devices.length);
  data.devices.at(-1).name += 'x';
  assert.equal(Buffer.byteLength(`${JSON.stringify(data, null, 2)}\n`), MAX_CONFIG_BYTES + 1);
  await assert.rejects(createConfig(file, data), { code: 'CONFIG_TOO_LARGE' });
  assert.deepEqual(await fs.readFile(file), original);
});

test('private-file reads accept the byte limit and reject one extra byte', async t => {
  const file = await fixture(t);
  await fs.writeFile(file, 'x'.repeat(MAX_CONFIG_BYTES), { mode: 0o600 });
  assert.equal((await readPrivateFile(file)).length, MAX_CONFIG_BYTES);
  await fs.appendFile(file, 'x');
  await assert.rejects(readPrivateFile(file), { code: 'CONFIG_TOO_LARGE' });
});

test('FIFO configuration and credential paths fail without waiting for a writer', { skip: process.platform === 'win32' }, async t => {
  const file = await fixture(t);
  const fifo = path.join(path.dirname(file), 'credential.fifo');
  await run('mkfifo', ['-m', '600', fifo]);
  const moduleUrl = new URL('../src/config.mjs', import.meta.url).href;
  const scenarios = [['readPrivateFile', fifo]];
  for (const key of ['password_file', 'ca_file']) {
    const config = path.join(path.dirname(file), `${key}.json`);
    await createConfig(config, make({ mqtt: { [key]: 'credential.fifo' } }));
    scenarios.push(['loadConfig', config]);
  }
  for (const [action, target] of scenarios) {
    // A separate bounded process makes a blocking-open regression fail rather
    // than leaving the test runner with a permanently blocked libuv worker.
    const source = `import { ${action} } from ${JSON.stringify(moduleUrl)}; try { await ${action}(process.argv[1]); process.exitCode = 1; } catch (error) { console.log(error.code); if (error.code !== 'CONFIG_INVALID') process.exitCode = 1; }`;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', source, target], { timeout: 3000, killSignal: 'SIGKILL' });
    assert.equal(stdout.trim(), 'CONFIG_INVALID');
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
    status: async () => ({ state: 'ON', confirmation: 'correlated_device_read', state_freshness_verified: true, request_outcome: 'confirmed' }),
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

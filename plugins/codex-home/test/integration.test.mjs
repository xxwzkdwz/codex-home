import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const topic = 'integration/light-not-a-real-device';
const base = `codex-home-integration-${randomUUID()}`;

async function findMosquitto() {
  const candidates = ['/opt/homebrew/sbin/mosquitto', ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'mosquitto'))];
  for (const executable of new Set(candidates)) {
    try { await fs.access(executable, constants.X_OK); return executable; } catch { /* Optional dependency. */ }
  }
  return undefined;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, message, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(10);
  }
}

async function reserveHighPort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = randomInt(49152, 65536);
    assert.notEqual(port, 1883);
    const reservation = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        reservation.once('error', reject);
        reservation.listen(port, '127.0.0.1', resolve);
      });
      await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No isolated high loopback port was available.');
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 'Process did not stop.', 1500); }
  catch {
    child.kill('SIGKILL');
    await until(() => child.exitCode !== null || child.signalCode !== null, 'Process did not exit after SIGKILL.', 1500);
  }
}

async function fixture(t, executable) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-isolated-integration-'));
  let broker;
  let fake;
  let mcp;
  let transport;
  t.after(async () => {
    // Each resource belongs exclusively to this test; no existing service is stopped.
    try { await mcp?.close(); } finally {
      try { await transport?.close(); } finally {
        try {
          if (fake) await fake.endAsync(true);
        } finally {
          try { await stopProcess(broker); } finally { await fs.rm(directory, { recursive: true, force: true }); }
        }
      }
    }
  });

  const port = await reserveHighPort();
  const url = `mqtt://127.0.0.1:${port}`;
  const brokerConfig = path.join(directory, 'mosquitto.conf');
  await fs.writeFile(brokerConfig, `listener ${port} 127.0.0.1\nallow_anonymous true\npersistence false\nlog_dest stderr\nlog_type all\n`, { mode: 0o600 });
  let logs = '';
  let brokerError;
  broker = spawn(executable, ['-c', brokerConfig], { stdio: ['ignore', 'ignore', 'pipe'] });
  broker.once('error', error => { brokerError = error; });
  broker.stderr.on('data', chunk => { logs += chunk.toString(); });
  // Do not connect until our own process confirms binding its isolated listener.
  await until(() => {
    if (brokerError || broker.exitCode !== null) throw new Error('The isolated test broker could not start.');
    return /mosquitto version .* running/.test(logs);
  }, 'The isolated test broker never became ready.');

  const commandLog = [];
  let mode = 'reply';
  let currentState = 'OFF';
  let fakeError;
  fake = await mqtt.connectAsync(url, {
    clientId: `codex-home-fake-${randomUUID()}`, clean: true, reconnectPeriod: 0,
    queueQoSZero: false, connectTimeout: 3000,
  });
  fake.on('error', error => { fakeError = error; });
  await fake.subscribeAsync([`${base}/${topic}/set`, `${base}/${topic}/get`], { qos: 0 });
  fake.on('message', (receivedTopic, payload, packet) => {
    const action = receivedTopic.endsWith('/set') ? 'set' : 'get';
    const body = JSON.parse(payload.toString());
    commandLog.push({ action, body, qos: packet.qos, retain: packet.retain });
    // Correlated reads also use /set, but never change this synthetic lamp.
    // The fake never connects to a real device or another broker.
    if (body.read) {
      if (mode === 'silent') return;
      if (mode === 'ordinary-only') {
        fake.publish(`${base}/${topic}`, JSON.stringify({ state: currentState }), { qos: 0, retain: false });
        return;
      }
      const property = mode === 'stale-nonce' ? `codex_home_read_${'0'.repeat(32)}` : body.read.state_property;
      const value = currentState === 'ON' ? 1 : 0;
      const onOff = mode === 'mismatch' ? 1 - value : mode === 'boolean' ? Boolean(value) : value;
      fake.publish(`${base}/${topic}`, JSON.stringify({ [property]: { onOff }, state: currentState }), { qos: 0, retain: false });
      return;
    }
    if (action === 'set' && Object.hasOwn(body, 'state')) {
      currentState = body.state;
      if (mode === 'silent') return;
    }
    fake.publish(`${base}/${topic}`, JSON.stringify({ state: currentState }), { qos: 0, retain: false });
  });

  const configPath = path.join(directory, 'config.json');
  const config = {
    version: 1,
    mqtt: { url, base_topic: base, timeout_ms: 1000 },
    devices: [{ device_id: 'test-lamp', room_id: 'test-room', name: 'Integration test lamp', mqtt_topic: topic, kind: 'light', require_availability: true, state_confirmation: 'correlated_read' }],
  };
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  if (process.platform !== 'win32') assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);

  transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(pluginRoot, 'src/server.mjs')], cwd: pluginRoot,
    env: { CODEX_HOME_LIGHTS_CONFIG: configPath }, stderr: 'pipe',
  });
  let serverStderr = '';
  transport.stderr?.on('data', chunk => { serverStderr += chunk.toString(); });
  mcp = new Client({ name: 'codex-home-isolated-integration', version: '1.0.0' });
  await mcp.connect(transport);

  const publish = (suffix, body, retain = true) => fake.publishAsync(`${base}/${suffix}`, typeof body === 'string' ? body : JSON.stringify(body), { qos: 1, retain });
  const online = async () => {
    await publish('bridge/state', { state: 'online' });
    await publish(`${topic}/availability`, { state: 'online' });
  };
  const call = (name, args = {}, options = {}) => mcp.callTool({ name, arguments: args }, undefined, { timeout: 4000, ...options });
  const data = response => response.structuredContent ?? JSON.parse(response.content.find(item => item.type === 'text').text);
  const sets = () => commandLog.filter(item => item.action === 'set' && Object.hasOwn(item.body, 'state')).length;
  const subscriptionCount = () => (logs.match(/Received SUBSCRIBE from/g) || []).length;
  await online();
  return { mcp, call, data, publish, online, sets, commandLog, subscriptionCount,
    mode: value => { mode = value; },
    confirmation: async value => {
      if (value === undefined) delete config.devices[0].state_confirmation;
      else config.devices[0].state_confirmation = value;
      await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    },
    assertHealthy: () => { assert.equal(fakeError, undefined); assert.equal(serverStderr, ''); },
  };
}

test('isolated Mosquitto + fake Zigbee2MQTT + MCP stdio integration', { timeout: 30000 }, async t => {
  const executable = await findMosquitto();
  if (!executable) {
    t.skip('Mosquitto unavailable; install mosquitto to run real-protocol integration. No external broker is used.');
    return;
  }
  const f = await fixture(t, executable);
  const args = state => ({ device_ref: 'test-lamp', state });

  await t.test('initialize, tool annotations, and safe device listing', async () => {
    assert.equal(f.mcp.getServerVersion().name, 'codex-home');
    assert.equal(f.mcp.getServerVersion().version, '0.1.3');
    const { tools } = await f.mcp.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['home_health', 'home_list_devices', 'home_set_state', 'home_status']);
    for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, tool.name !== 'home_set_state');
    assert.equal(tools.find(tool => tool.name === 'home_set_state').annotations.destructiveHint, true);
    const listed = await f.call('home_list_devices');
    assert.equal(f.data(listed).count, 1);
    assert.equal(f.data(listed).devices[0].device_id, 'test-lamp');
    assert.doesNotMatch(JSON.stringify(listed), /mqtt_topic|mqtt:\/\/|light-not-a-real-device/);
  });

  await t.test('one state write and one nonce-correlated device read confirm control', async () => {
    assert.equal(f.data(await f.call('home_health')).bridge_state, 'online');
    const before = f.commandLog.length;
    const result = f.data(await f.call('home_set_state', args('ON')));
    assert.equal(result.state, 'ON');
    assert.equal(result.request_outcome, 'confirmed');
    assert.equal(result.confirmation, 'correlated_device_read');
    assert.equal(result.state_freshness_verified, true);
    const commands = f.commandLog.slice(before);
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[0].body, { state: 'ON' });
    assert.deepEqual(Object.keys(commands[1].body), ['read']);
    assert.equal(commands[1].body.read.cluster, 'genOnOff');
    assert.deepEqual(commands[1].body.read.attributes, ['onOff']);
    assert.match(commands[1].body.read.state_property, /^codex_home_read_[a-f0-9]{32}$/);
    for (const command of commands) {
      assert.equal(command.action, 'set');
      assert.equal(command.qos, 0);
      assert.equal(command.retain, false);
    }
    const status = f.data(await f.call('home_status', { device_ref: 'test-lamp' }));
    assert.equal(status.state, 'ON');
    assert.equal(status.confirmation, 'correlated_device_read');
    assert.equal(status.state_freshness_verified, true);
    assert.equal(status.request_outcome, 'confirmed');
    assert.notEqual(f.commandLog.at(-1).body.read.state_property, commands[1].body.read.state_property);
  });

  await t.test('retained old ON cannot confirm write; unknown latches until fresh status', async () => {
    await f.publish(topic, { state: 'ON' }, true);
    f.mode('silent');
    const before = f.sets();
    const timedOut = f.data(await f.call('home_set_state', args('ON')));
    assert.equal(timedOut.error.code, 'MQTT_TIMEOUT');
    assert.equal(timedOut.request_outcome, 'unknown');
    assert.equal(timedOut.retry_safe, false);
    assert.equal(f.sets(), before + 1);
    const blocked = f.data(await f.call('home_set_state', args('OFF')));
    assert.equal(blocked.error.code, 'STATUS_REQUIRED');
    assert.equal(f.sets(), before + 1);
    f.mode('reply');
    assert.equal(f.data(await f.call('home_status', { device_ref: 'test-lamp' })).state, 'ON');
    assert.equal(f.data(await f.call('home_set_state', args('OFF'))).request_outcome, 'confirmed');
  });

  await t.test('ordinary non-retained state and old nonce never confirm or unlock a write', async () => {
    f.mode('ordinary-only');
    const before = f.sets();
    const timedOut = f.data(await f.call('home_set_state', args('ON')));
    assert.equal(timedOut.error.code, 'MQTT_TIMEOUT');
    assert.equal(timedOut.request_outcome, 'unknown');
    assert.equal(f.sets(), before + 1);
    for (const mode of ['ordinary-only', 'stale-nonce']) {
      f.mode(mode);
      const status = f.data(await f.call('home_status', { device_ref: 'test-lamp' }));
      assert.equal(status.error.code, 'MQTT_TIMEOUT');
      const blocked = f.data(await f.call('home_set_state', args('OFF')));
      assert.equal(blocked.error.code, 'STATUS_REQUIRED');
      assert.equal(f.sets(), before + 1);
    }
    f.mode('reply');
    await f.confirmation(undefined);
    const observation = f.data(await f.call('home_status', { device_ref: 'test-lamp' }));
    assert.equal(observation.state, 'ON');
    assert.equal(observation.confirmation, 'unverified_gateway_report');
    assert.equal(observation.state_freshness_verified, false);
    assert.equal(observation.request_outcome, 'unverified');
    await f.confirmation('correlated_read');
    assert.equal(f.data(await f.call('home_set_state', args('OFF'))).error.code, 'STATUS_REQUIRED');
    assert.equal(f.sets(), before + 1);
    f.mode('boolean');
    const recovered = f.data(await f.call('home_status', { device_ref: 'test-lamp' }));
    assert.equal(recovered.state, 'ON');
    assert.equal(recovered.confirmation, 'correlated_device_read');
    f.mode('reply');
    assert.equal(f.data(await f.call('home_set_state', args('OFF'))).request_outcome, 'confirmed');
  });

  await t.test('correlated read differing from requested state returns unknown without retry', async () => {
    f.mode('mismatch');
    const before = f.sets();
    const result = f.data(await f.call('home_set_state', args('ON')));
    assert.equal(result.error.code, 'STATE_MISMATCH');
    assert.equal(result.request_outcome, 'unknown');
    assert.equal(f.sets(), before + 1);
    assert.equal(f.data(await f.call('home_set_state', args('OFF'))).error.code, 'STATUS_REQUIRED');
    f.mode('reply');
    assert.equal(f.data(await f.call('home_status', { device_ref: 'test-lamp' })).state, 'ON');
    assert.equal(f.data(await f.call('home_set_state', args('OFF'))).request_outcome, 'confirmed');
  });

  await t.test('bridge and device offline prevent control publication', async () => {
    for (const [suffix, code] of [['bridge/state', 'BRIDGE_OFFLINE'], [`${topic}/availability`, 'DEVICE_OFFLINE']]) {
      await f.publish(suffix, { state: 'offline' });
      const before = f.sets();
      const result = f.data(await f.call('home_set_state', args('ON')));
      assert.equal(result.error.code, code);
      assert.equal(result.request_outcome, 'not_sent');
      assert.equal(f.sets(), before);
      await f.online();
    }
  });

  await t.test('MCP input schema rejects non-enum state without publication', async () => {
    const before = f.sets();
    const response = await f.call('home_set_state', args('TOGGLE'));
    assert.equal(response.isError, true);
    assert.match(JSON.stringify(response), /ON|OFF|Invalid|validation/);
    assert.equal(f.sets(), before);
  });

  for (const missingTopic of ['bridge/state', `${topic}/availability`]) {
    await t.test(`cancel while awaiting ${missingTopic} never sends delayed control`, async () => {
      await f.publish(missingTopic, '', true); // Clear only this isolated broker's retained availability.
      const before = f.sets();
      const beforeSubscriptions = f.subscriptionCount();
      const controller = new AbortController();
      const pending = f.call('home_set_state', args('ON'), { signal: controller.signal });
      // Attach rejection handling immediately; cancellation intentionally rejects the client request.
      const rejected = assert.rejects(pending);
      await until(() => f.subscriptionCount() > beforeSubscriptions, 'Server did not subscribe before cancellation.');
      controller.abort();
      await rejected;
      // Allow notifications/cancelled to reach the server before providing missing availability.
      await sleep(100);
      await f.online();
      await sleep(100);
      assert.equal(f.sets(), before);
      // A new explicit request still works; pre-send cancellation must not latch unknown.
      assert.equal(f.data(await f.call('home_set_state', args('OFF'))).request_outcome, 'confirmed');
    });
  }

  await t.test('cancel after publication latches unknown until status recovery', async () => {
    f.mode('silent');
    const before = f.sets();
    const controller = new AbortController();
    const pending = f.call('home_set_state', args('ON'), { signal: controller.signal });
    const rejected = assert.rejects(pending);
    await until(() => f.sets() === before + 1, 'Expected isolated test control was not published.');
    controller.abort();
    await rejected;
    await sleep(100);
    const blocked = f.data(await f.call('home_set_state', args('OFF')));
    assert.equal(blocked.error.code, 'STATUS_REQUIRED');
    assert.equal(blocked.request_outcome, 'unknown');
    assert.equal(f.sets(), before + 1);
    f.mode('reply');
    assert.equal(f.data(await f.call('home_status', { device_ref: 'test-lamp' })).state, 'ON');
    assert.equal(f.data(await f.call('home_set_state', args('OFF'))).request_outcome, 'confirmed');
  });
  f.assertHealthy();
});

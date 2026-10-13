import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultConfigPath, parseConfig, MAX_CONFIG_BYTES } from '../src/config.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = promisify(execFile);
const fixture = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
};
const device = { device_id: 'light.demo', room_id: 'demo', name: 'Demo light', kind: 'light', mqtt_topic: 'synthetic-demo', enabled: false };

test('default configuration is namespaced separately from the Codex host setting', () => {
  const empty = defaultConfigPath({});
  assert.equal(defaultConfigPath({ CODEX_HOME: 'synthetic-host-setting' }), empty);
  assert.equal(path.basename(empty), 'config.json');
  assert.equal(path.basename(path.dirname(empty)), ['darwin', 'win32'].includes(process.platform) ? 'Codex Home' : 'codex-home');
});

test('explicit lights configuration override resolves without mutating its environment', () => {
  const env = { CODEX_HOME_LIGHTS_CONFIG: './synthetic-light-config.json' };
  assert.equal(defaultConfigPath(env), path.resolve(env.CODEX_HOME_LIGHTS_CONFIG));
  assert.deepEqual(env, { CODEX_HOME_LIGHTS_CONFIG: './synthetic-light-config.json' });
});

test('registry import copies the explicit allowlist and preserves the source', async t => {
  const directory = await fixture(t);
  const source = path.join(directory, 'registry.json');
  const destination = path.join(directory, 'settings', 'config.json');
  const original = `${JSON.stringify({ version: 1, devices: [device] })}\n`;
  await fs.writeFile(source, original, { mode: 0o600 });
  const { stdout } = await run(process.execPath, [cli, 'import-registry', source, '--config', destination]);
  assert.equal(JSON.parse(stdout).imported_devices, 1);
  assert.equal(await fs.readFile(source, 'utf8'), original);
  const imported = JSON.parse(await fs.readFile(destination, 'utf8'));
  assert.equal(imported.devices[0].device_id, device.device_id);
  assert.equal(imported.devices[0].enabled, false);
  if (process.platform !== 'win32') assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
  await assert.rejects(run(process.execPath, [cli, 'import-registry', source, '--config', destination]), error => {
    assert.equal(JSON.parse(error.stderr).error.code, 'CONFIG_EXISTS');
    return true;
  });
  assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), imported);
});

test('registry import rejects extra data without creating a destination', async t => {
  const directory = await fixture(t);
  const source = path.join(directory, 'registry.json');
  const destination = path.join(directory, 'config.json');
  await fs.writeFile(source, JSON.stringify({ version: 1, devices: [device], mqtt: {} }), { mode: 0o600 });
  await assert.rejects(run(process.execPath, [cli, 'import-registry', source, '--config', destination]), error => {
    assert.equal(JSON.parse(error.stderr).error.code, 'CONFIG_INVALID');
    return true;
  });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('registry import rejects oversized expanded output without changing the source or target', async t => {
  const directory = await fixture(t);
  const source = path.join(directory, 'registry.json');
  const destination = path.join(directory, 'settings', 'config.json');
  const registry = { version: 1, devices: Array.from({ length: 256 }, (_, i) => ({
    ...device, device_id: `light.demo${i}`, mqtt_topic: `demo${i}`, name: `Demo ${i}`,
  })) };
  const original = `${JSON.stringify(registry)}\n`;
  assert.ok(Buffer.byteLength(original) < MAX_CONFIG_BYTES);
  assert.ok(Buffer.byteLength(`${JSON.stringify(parseConfig(registry), null, 2)}\n`) > MAX_CONFIG_BYTES);
  await fs.writeFile(source, original, { mode: 0o600 });
  await assert.rejects(run(process.execPath, [cli, 'import-registry', source, '--config', destination]), error => {
    const result = JSON.parse(error.stderr);
    assert.equal(result.error.code, 'CONFIG_TOO_LARGE');
    assert.match(result.error.message, /65536/);
    assert.equal(result.request_outcome, 'not_sent');
    assert.equal(error.stdout, '');
    return true;
  });
  assert.equal(await fs.readFile(source, 'utf8'), original);
  await assert.rejects(fs.stat(path.dirname(destination)), { code: 'ENOENT' });
});

test('CLI init keeps an existing explicit configuration intact', async t => {
  const directory = await fixture(t);
  const destination = path.join(directory, 'config.json');
  await run(process.execPath, [cli, 'init', '--config', destination]);
  const before = await fs.readFile(destination, 'utf8');
  await assert.rejects(run(process.execPath, [cli, 'init', '--config', destination]), error => {
    assert.equal(JSON.parse(error.stderr).error.code, 'CONFIG_EXISTS');
    return true;
  });
  assert.equal(await fs.readFile(destination, 'utf8'), before);
});

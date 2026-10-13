import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../install.mjs';
import { checkPackage, listReleaseFiles } from '../check-package.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const selector = 'codex-home@codex-home-local';
const marketplace = 'codex-home-local';

// No subprocesses, Codex account, package registry, MQTT broker, or real home
// configuration are used. All mutations belong to this mkdtemp fixture.
function fixture(t, options = {}) {
  const taskRoot = realpathSync(mkdtempSync(join(tmpdir(), 'codex-home-installer-test-')));
  let verifyPreserved = () => {};
  t.after(() => { try { verifyPreserved(); } finally { rmSync(taskRoot, { recursive: true, force: true }); } });
  const root = join(taskRoot, 'checkout');
  const source = join(root, 'plugins/codex-home');
  const stateRoot = join(taskRoot, 'isolated-codex');
  const otherRoot = join(taskRoot, 'other-checkout');
  mkdirSync(otherRoot);
  for (const file of listReleaseFiles(repository)) {
    const destination = join(root, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repository, file), destination);
  }
  const version = checkPackage(root).version;
  const cacheFor = value => join(stateRoot, 'plugins/cache', marketplace, 'codex-home', value);
  const cache = cacheFor(version);
  const privateConfig = join(taskRoot, 'owner-config.fixture');
  const untouched = 'Synthetic owner configuration: preserve this exact content.';
  writeFileSync(privateConfig, untouched, { mode: 0o600 });
  verifyPreserved = () => assert.equal(readFileSync(privateConfig, 'utf8'), untouched);
  const localEntry = { name: marketplace, root, marketplaceSource: { sourceType: 'local', source: root } };
  const entries = options.existing ? [structuredClone(localEntry)] : [];
  if (options.conflict) entries.push({ ...localEntry, root: otherRoot, marketplaceSource: { sourceType: 'local', source: otherRoot } });
  if (options.duplicate) entries.push(structuredClone(localEntry));
  let installedVersion = options.previousVersion;
  if (installedVersion) {
    mkdirSync(cacheFor(installedVersion), { recursive: true });
    writeFileSync(join(cacheFor(installedVersion), 'previous-version.fixture'), installedVersion);
  }
  const calls = [];
  const runCommand = (executable, args, settings) => {
    calls.push({ executable, args: [...args], ...settings });
    const key = args.join(' ');
    if (executable === 'codex' && key === 'plugin add --help') return '';
    if (executable === 'npm' && key === '--version') return 'test-only';
    if (executable === 'codex' && key === 'plugin marketplace list --json') {
      assert.equal(settings.json, true);
      return options.invalidMarketplaceList ? {} : { marketplaces: structuredClone(entries) };
    }
    if (executable === 'codex' && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
      assert.deepEqual(args, ['plugin', 'marketplace', 'add', root, '--json']);
      entries.push(structuredClone(localEntry));
      return { marketplaceName: marketplace, installedRoot: options.wrongRegistration ? otherRoot : root };
    }
    if (executable === 'codex' && key === `plugin add ${selector} --json`) {
      if (options.addFailure) throw new Error('Synthetic plugin add failure');
      let installedPath = cache;
      if (options.cachePath === 'source') installedPath = source;
      if (options.cachePath === 'inside-checkout') installedPath = join(root, 'plugins/cache', marketplace, 'codex-home', version);
      if (options.cachePath === 'dot-prefixed-inside-checkout') installedPath = join(root, '..cache/plugins/cache', marketplace, 'codex-home', version);
      if (options.cachePath === 'wrong-suffix') installedPath = join(taskRoot, 'not-a-plugin-cache');
      if (installedPath !== source) {
        mkdirSync(dirname(installedPath), { recursive: true });
        cpSync(source, installedPath, { recursive: true });
      }
      if (options.cachePath === 'symlink') {
        const link = join(taskRoot, 'cache-link');
        symlinkSync(source, link, 'dir');
        installedPath = link;
      }
      if (options.fingerprintMismatch) writeFileSync(join(installedPath, 'unexpected.fixture'), 'Synthetic stale cache.');
      installedVersion = version;
      return { pluginId: options.wrongIdentity ? 'unexpected-plugin' : selector, name: 'codex-home', marketplaceName: marketplace,
        version: options.wrongVersion ? '0.0.0' : version, installedPath: options.relativeCache ? 'relative-cache' : installedPath };
    }
    if (executable === 'npm' && args[0] === 'ci') {
      assert.equal(settings.cwd, cache, 'Dependencies must be installed only in the verified cache.');
      assert.deepEqual(args, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
      if (options.npmFailure) throw new Error('Synthetic npm failure');
      return '';
    }
    if (executable === process.execPath) {
      assert.equal(settings.cwd, cache);
      assert.equal(calls.at(-2).executable, 'npm');
      assert.equal(calls.at(-2).args[0], 'ci');
      assert.deepEqual(args.slice(0, 2), ['--input-type=module', '-e']);
      assert.match(args[2], /@modelcontextprotocol\/sdk\/server\/mcp\.js/);
      assert.match(args[2], /import\('mqtt'\)/);
      if (options.importFailure) throw new Error('Synthetic dependency import failure');
      return '';
    }
    if (executable === 'codex' && key === `plugin list --marketplace ${marketplace} --json`) {
      return { installed: [{ pluginId: selector, installed: true, enabled: !options.disabled, version: installedVersion }] };
    }
    throw new Error(`Unexpected test command: ${executable} ${key}`);
  };
  return { root, source, cache, cacheFor, version, calls,
    execute: overrides => install({ root, runCommand, platform: 'linux', nodeVersion: '22.0.0', ...overrides }),
    dependencyCalls: () => calls.filter(call => call.executable === 'npm' && call.args[0] === 'ci'),
    registrationCalls: () => calls.filter(call => call.executable === 'codex' && call.args[1] === 'marketplace' && call.args[2] === 'add') };
}

test('first install registers only this source, verifies the cache, and prepares dependencies there', t => {
  const f = fixture(t);
  assert.match(f.execute(), new RegExp(`Installed Codex Home ${f.version.replaceAll('.', '\\.')}`));
  assert.equal(f.registrationCalls().length, 1);
  assert.equal(f.dependencyCalls().length, 1);
  assert.ok(existsSync(join(f.cache, 'package-lock.json')));
  assert.equal(f.calls.at(-1).args.join(' '), `plugin list --marketplace ${marketplace} --json`);
  assert.ok(!existsSync(join(f.source, 'node_modules')));
});

test('same-source reinstallation is repeatable without re-registering the marketplace', t => {
  const f = fixture(t, { existing: true });
  f.execute();
  f.execute();
  assert.equal(f.registrationCalls().length, 0);
  assert.equal(f.dependencyCalls().length, 2);
});

test('upgrade requests the checked version and installs dependencies in its new cache', t => {
  const f = fixture(t, { existing: true, previousVersion: '0.0.1' });
  assert.match(f.execute(), /Installed Codex Home/);
  assert.notEqual(f.cache, f.cacheFor('0.0.1'));
  assert.equal(f.dependencyCalls()[0].cwd, f.cache);
  assert.equal(readFileSync(join(f.cacheFor('0.0.1'), 'previous-version.fixture'), 'utf8'), '0.0.1');
});

for (const [name, options, error] of [
  ['conflicting source', { conflict: true }, /registered to another source/],
  ['duplicate marketplace', { existing: true, duplicate: true }, /Multiple codex-home-local sources/],
  ['invalid marketplace response', { invalidMarketplaceList: true }, /Unsupported Codex marketplace JSON/],
  ['unexpected registration', { wrongRegistration: true }, /unexpected marketplace/],
  ['unexpected plugin identity', { wrongIdentity: true }, /unexpected plugin identity/],
  ['wrong installed version', { wrongVersion: true }, /unexpected plugin identity/],
  ['relative cache path', { relativeCache: true }, /unexpected plugin identity/],
  ['source directory as cache', { cachePath: 'source' }, /verified, separate Codex plugin cache/],
  ['cache inside checkout', { cachePath: 'inside-checkout' }, /verified, separate Codex plugin cache/],
  ['dot-prefixed cache still inside checkout', { cachePath: 'dot-prefixed-inside-checkout' }, /verified, separate Codex plugin cache/],
  ['cache with unrelated suffix', { cachePath: 'wrong-suffix' }, /verified, separate Codex plugin cache/],
  ['symlink back into source', { cachePath: 'symlink' }, /verified, separate Codex plugin cache/],
  ['stale or altered cache content', { fingerprintMismatch: true }, /Installed cache differs/],
  ['failed plugin upgrade', { existing: true, previousVersion: '0.0.1', addFailure: true }, /Synthetic plugin add failure/],
]) {
  test(`rejects ${name} before installing dependencies`, t => {
    const f = fixture(t, options);
    assert.throws(() => f.execute(), error);
    assert.equal(f.dependencyCalls().length, 0);
    if (options.conflict || options.duplicate) assert.equal(f.registrationCalls().length, 0);
  });
}

test('failed dependency installation stops before import or completion checks', t => {
  const f = fixture(t, { npmFailure: true });
  assert.throws(() => f.execute(), /Synthetic npm failure/);
  assert.equal(f.dependencyCalls().length, 1);
  assert.equal(f.calls.at(-1).executable, 'npm');
});

test('failed dependency imports never report installation success', t => {
  const f = fixture(t, { importFailure: true });
  assert.throws(() => f.execute(), /Synthetic dependency import failure/);
  assert.equal(f.calls.at(-1).executable, process.execPath);
});

test('disabled post-install state is not reported as success', t => {
  const f = fixture(t, { disabled: true });
  assert.throws(() => f.execute(), /did not report the plugin installed and enabled/);
});

test('dry-run checks the package without any Codex or npm commands', t => {
  const f = fixture(t);
  assert.match(f.execute({ dryRun: true, platform: 'win32' }), /No Codex configuration/);
  assert.equal(f.calls.length, 0);
});

test('unsupported platform and old Node stop before external commands', t => {
  const f = fixture(t);
  assert.throws(() => f.execute({ platform: 'win32' }), /supports macOS\/Linux only/);
  assert.throws(() => f.execute({ nodeVersion: '20.0.0' }), /Node.js 22 or newer/);
  assert.equal(f.calls.length, 0);
});

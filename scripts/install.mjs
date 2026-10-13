#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPackage, listReleaseFiles } from './check-package.mjs';

const packageRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const selector = 'codex-home@codex-home-local';
const help = `Usage: node scripts/install.mjs [--dry-run]

Installs this checkout as the codex-home-local Codex marketplace and Codex Home
plugin, then installs locked production dependencies in the verified plugin
cache. Uses Codex's official plugin commands; never edits config.toml directly.
Existing unrelated plugins/configuration are preserved. It does not configure
devices, copy credentials, contact a light, or control anything in your home.

--dry-run  Check the package and print the plan without changing Codex.

Requires Node.js 22+, npm, and a Codex CLI with plugin marketplace/add support.
The installer supports macOS/Linux; Windows installation is not supported yet.
Open a new Codex chat after installation and run the packaged setup skill.`;

function command(executable, commandArgs, { cwd = packageRoot, json = false } = {}) {
  const result = spawnSync(executable, commandArgs, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    // Avoid dumping arbitrary CLI logs/config into a conversation; the owner can run the named command directly.
    throw new Error(`${executable} ${commandArgs.slice(0, 3).join(' ')} failed (${result.error?.code ?? result.status}). Run that command locally to inspect its diagnostic output.`);
  }
  if (!json) return result.stdout.trim();
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${executable} did not return supported JSON output. No dependency install was attempted.`); }
}

function canonical(path) { return realpathSync(path); }
function pluginFingerprint(directory) {
  const hash = createHash('sha256');
  for (const file of listReleaseFiles(directory)) {
    hash.update(file).update('\0').update(readFileSync(join(directory, file))).update('\0');
  }
  return hash.digest('hex');
}

// Tests inject an in-memory CLI contract, never the owner's Codex/npm processes.
// The command-line entry point always uses the real runner and package root.
export function install({ root = packageRoot, runCommand = command, dryRun = false,
  platform = process.platform, nodeVersion = process.versions.node } = {}) {
  root = canonical(root);
  const source = join(root, 'plugins', 'codex-home');
  const run = (executable, commandArgs, options = {}) => runCommand(executable, commandArgs, { cwd: root, ...options });
  if (Number(nodeVersion.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const checked = checkPackage(root);
  if (dryRun) {
    return `Package verified: Codex Home ${checked.version}.
Would register this checkout with: codex plugin marketplace add <checkout> --json
Would install: codex plugin add ${selector} --json
Would verify the returned cache identity/content, then run npm ci --omit=dev --ignore-scripts there.
No Codex configuration, dependency, or device changes were made.`;
  }
  if (!['darwin', 'linux'].includes(platform)) {
    throw new Error('The installer supports macOS/Linux only; no Codex settings were changed.');
  }
  run('codex', ['plugin', 'add', '--help']);
  run('npm', ['--version']);
  const marketplaces = run('codex', ['plugin', 'marketplace', 'list', '--json'], { json: true });
  if (!Array.isArray(marketplaces.marketplaces)) throw new Error('Unsupported Codex marketplace JSON.');
  const existing = marketplaces.marketplaces.filter((entry) => entry.name === 'codex-home-local');
  if (existing.length > 1) throw new Error('Multiple codex-home-local sources exist; resolve them in Codex before installation.');
  if (existing.length) {
    const entry = existing[0];
    if (entry.marketplaceSource?.sourceType !== 'local' || !isAbsolute(entry.root ?? '') ||
        canonical(entry.root) !== root || canonical(entry.marketplaceSource.source) !== root) {
      throw new Error('codex-home-local is registered to another source. This installer will not replace it; resolve that source explicitly in Codex first.');
    }
  } else {
    const registration = run('codex', ['plugin', 'marketplace', 'add', root, '--json'], { json: true });
    if (registration.marketplaceName !== 'codex-home-local' || !isAbsolute(registration.installedRoot ?? '') || canonical(registration.installedRoot) !== root) {
      throw new Error('Codex registered an unexpected marketplace. Inspect codex-home-local in Codex before continuing.');
    }
  }
  const installed = run('codex', ['plugin', 'add', selector, '--json'], { json: true });
  if (installed.pluginId !== selector || installed.name !== 'codex-home' || installed.marketplaceName !== 'codex-home-local' ||
      installed.version !== checked.version || !isAbsolute(installed.installedPath ?? '')) {
    throw new Error('Codex returned an unexpected plugin identity/version/cache path. Dependencies were not installed.');
  }
  const cache = canonical(installed.installedPath);
  const tail = ['plugins', 'cache', 'codex-home-local', 'codex-home', checked.version].join(sep);
  const relativeCache = relative(root, cache);
  const outsideCheckout = relativeCache === '..' || relativeCache.startsWith(`..${sep}`) || isAbsolute(relativeCache);
  if (!cache.endsWith(`${sep}${tail}`) || cache === source || !outsideCheckout) {
    throw new Error('Refusing to install dependencies outside a verified, separate Codex plugin cache.');
  }
  if (pluginFingerprint(source) !== pluginFingerprint(cache)) {
    throw new Error(`Installed cache differs from this checkout. Close chats using Codex Home, explicitly remove only ${selector} with Codex, then rerun this installer. Device configuration outside the cache is preserved.`);
  }
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: cache });
  run(process.execPath, ['--input-type=module', '-e', "await import('@modelcontextprotocol/sdk/server/mcp.js'); await import('mqtt');"], { cwd: cache });
  const state = run('codex', ['plugin', 'list', '--marketplace', 'codex-home-local', '--json'], { json: true });
  const entry = state.installed?.find((item) => item.pluginId === selector);
  if (!entry?.installed || !entry.enabled || entry.version !== checked.version) throw new Error('Codex did not report the plugin installed and enabled.');
  return `Installed Codex Home ${checked.version} and verified dependencies in the actual Codex cache.
No home device was configured or controlled. Open a new Codex chat and run Codex Home setup.
Your local device configuration is kept outside the plugin cache.`;
}

if (process.argv[1] && canonical(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help);
  } else if (args.some((arg) => arg !== '--dry-run') || args.length > 1) {
    console.error('Unknown arguments. Run node scripts/install.mjs --help.');
    process.exitCode = 2;
  } else {
    try { console.log(install({ dryRun: args.includes('--dry-run') })); }
    catch (error) {
      console.error(`Codex Home installation stopped: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

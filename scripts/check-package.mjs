#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const identity = Object.freeze({ name: 'codex-home', marketplace: 'codex-home-local', server: 'codex_home', displayName: 'Codex Home', version: '0.1.3', contributor: 'Codex Home contributors' });
const excludedDirectories = new Set(['.git', 'node_modules']);
const forbiddenDirectories = new Set(['data', 'state', 'secrets', '.cache', 'coverage', 'dist']);
const requiredFiles = [
  '.agents/plugins/marketplace.json', '.github/workflows/test.yml', '.gitignore', 'README.md', 'HARDWARE.md', 'SECURITY.md', 'LICENSE', 'docs/macos-gateway.md',
  'plugins/codex-home/plugin.json', 'plugins/codex-home/mcp.json',
  'plugins/codex-home/.codex-plugin/plugin.json', 'plugins/codex-home/.mcp.json',
  'plugins/codex-home/package.json', 'plugins/codex-home/package-lock.json',
  'plugins/codex-home/LICENSE', 'plugins/codex-home/README.md',
  'plugins/codex-home/src/server.mjs', 'plugins/codex-home/skills/setup/SKILL.md', 'plugins/codex-home/skills/home-control/SKILL.md',
  'plugins/codex-home/examples/config.example.json',
  'scripts/install.mjs', 'scripts/check-package.mjs', 'scripts/test/install.test.mjs',
];

// These checks are a release guard, not a guarantee that arbitrary secrets can be detected.
const contentRules = [
  ['personal absolute path', /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//],
  ['Windows personal path', /[A-Za-z]:[\\/]Users[\\/][a-zA-Z0-9_.-]+[\\/]/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential-shaped literal', /(?:token|password|client_secret|api_key)\s*["']?\s*[:=]\s*["'][a-zA-Z0-9_+/=-]{20,}["']/i],
  ['credential in a broker URL', /mqtts?:\/\/[^\s/"'`@]+:[^\s/"'`@]+@/i],
  ['literal bearer credential', /Bearer\s+[A-Za-z0-9_+./=-]{24,}/],
  ['private LAN device address', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/],
  ['hardware MAC address', /\b(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}\b/],
  ['numeric device ID', /["'](?:did|deviceId|device_id)["']\s*:\s*["']?\d{6,}/],
  ['OpenAI-style secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['GitHub-style secret', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
];

export function listReleaseFiles(root = packageRoot) {
  const files = [];
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const rel = relative(root, full).split('\\').join('/');
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`Release contains a symlink: ${rel}`);
      if (stat.isDirectory()) {
        if (excludedDirectories.has(name)) continue;
        if (forbiddenDirectories.has(name)) throw new Error(`Runtime/build directory in release: ${rel}`);
        walk(full);
      } else if (stat.isFile()) {
        if (name === '.DS_Store') continue;
        if (/^(?:\.env(?:\..*)?|config\.json)$/.test(name) || /\.(?:local\.json|log|pem|key|p12|pfx|tgz|zip)$/i.test(name)) {
          throw new Error(`Private/runtime/archive file in release: ${rel}`);
        }
        if (stat.size > 2_000_000) throw new Error(`Unexpected large release file: ${rel}`);
        files.push(rel);
      } else {
        throw new Error(`Unsupported release entry: ${rel}`);
      }
    }
  }
  walk(root);
  return files;
}

export function checkPackage(root = packageRoot) {
  const files = listReleaseFiles(root);
  for (const file of requiredFiles) {
    if (!files.includes(file)) throw new Error(`Missing required release file: ${file}`);
  }
  for (const file of files) {
    const buffer = readFileSync(join(root, file));
    if (buffer.includes(0)) throw new Error(`Unexpected binary in source release: ${file}`);
    // Check this source too: rules use escaped/split examples so they do not whitelist themselves.
    let text = buffer.toString('utf8');
    // One deliberately invalid, documented dummy credential used by the URL-rejection test.
    // The allowance is exact and test-only; it is not a blanket exemption for fixtures.
    if (file.startsWith('plugins/codex-home/test/')) {
      text = text.replaceAll(['mqtt://user', 'secret@localhost'].join(':'), '<invalid-test-url>');
    }
    for (const [label, pattern] of contentRules) {
      if (pattern.test(text)) throw new Error(`Potential ${label} in ${file}; remove it before publishing.`);
    }
  }

  const json = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
  const portable = json('plugins/codex-home/plugin.json');
  const compatibility = json('plugins/codex-home/.codex-plugin/plugin.json');
  const pkg = json('plugins/codex-home/package.json');
  const lock = json('plugins/codex-home/package-lock.json');
  const marketplace = json('.agents/plugins/marketplace.json');
  const lockedRoot = lock.packages?.[''];
  if ([portable, compatibility, pkg, lock, lockedRoot].some(entry => entry?.name !== identity.name || entry?.version !== identity.version)) {
    throw new Error('Plugin/package/lock identity or version mismatch.');
  }
  if ([portable, compatibility, pkg, lockedRoot].some(entry => entry.license !== 'MIT')) {
    throw new Error('Expected the owner-approved MIT license in both manifests and the package.');
  }
  const license = readFileSync(join(root, 'LICENSE'), 'utf8');
  if (!license.startsWith('MIT License\n') || !license.includes(`Copyright (c) 2026 ${identity.contributor}`) ||
      license !== readFileSync(join(root, 'plugins/codex-home/LICENSE'), 'utf8')) {
    throw new Error('Root and plugin MIT notices must match the approved project identity.');
  }
  if (marketplace.name !== identity.marketplace || marketplace.interface?.displayName !== identity.displayName || marketplace.plugins?.length !== 1 ||
      marketplace.plugins[0].name !== identity.name || marketplace.plugins[0].source?.source !== 'local' ||
      marketplace.plugins[0].source?.path !== `./plugins/${identity.name}`) {
    throw new Error('Unexpected marketplace identity or source path.');
  }
  if (portable.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json') throw new Error('Missing portable manifest schema.');
  const openai = portable.extensions?.['com.openai'];
  if (JSON.stringify(openai?.interface) !== JSON.stringify(compatibility.interface) ||
      openai?.interface?.displayName !== identity.displayName || openai?.interface?.developerName !== identity.contributor ||
      portable.author?.name !== identity.contributor || compatibility.author?.name !== identity.contributor ||
      portable.description !== compatibility.description) {
    throw new Error('Portable and compatibility interfaces differ.');
  }
  if (openai.onboardingSkill !== './skills/setup/SKILL.md' ||
      compatibility.extensions?.['com.openai']?.onboardingSkill !== openai.onboardingSkill ||
      compatibility.skills !== './skills/' || compatibility.mcpServers !== './.mcp.json') {
    throw new Error('Unexpected onboarding, skills, or compatibility MCP path.');
  }
  if (pkg.engines?.node !== '>=22' || lockedRoot.engines?.node !== pkg.engines.node ||
      JSON.stringify(pkg.dependencies) !== JSON.stringify(lockedRoot.dependencies) ||
      Object.values(pkg.dependencies ?? {}).some(version => !/^\d+\.\d+\.\d+$/.test(version))) {
    throw new Error('Runtime requirements and exactly pinned dependencies must match the lockfile.');
  }
  for (const filename of ['mcp.json', '.mcp.json']) {
    const mcp = json(`plugins/codex-home/${filename}`);
    const server = mcp.mcpServers?.[identity.server];
    if (Object.keys(mcp.mcpServers ?? {}).length !== 1 || server?.command !== 'node' ||
        JSON.stringify(server.args) !== JSON.stringify(['./src/server.mjs']) || server.cwd !== './' || server.env) {
      throw new Error(`Unexpected executable, working directory, or credentials in ${filename}.`);
    }
    if (filename === 'mcp.json' && (server.type !== 'stdio' || mcp.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')) {
      throw new Error('Invalid portable MCP declaration.');
    }
    if (filename === '.mcp.json' && (server.enabled !== true || server.startup_timeout_sec !== 30 || server.tool_timeout_sec !== 30)) {
      throw new Error('Unexpected compatibility MCP enablement or timeout.');
    }
  }
  if (!lock.packages?.[''] || lock.lockfileVersion < 3) throw new Error('A complete npm lockfile v3 is required.');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (!entry.integrity || !entry.resolved?.startsWith('https://registry.npmjs.org/')) {
      throw new Error(`Unpinned or non-public npm dependency: ${name}`);
    }
  }
  const ignored = readFileSync(join(root, '.gitignore'), 'utf8');
  for (const rule of ['node_modules/', '.env', 'config.json', 'secrets/']) {
    if (!ignored.split('\n').includes(rule)) throw new Error(`Missing ignore rule: ${rule}`);
  }
  return { version: portable.version, fileCount: files.length, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkPackage();
    console.log(`Package checks passed: Codex Home ${result.version}, ${result.fileCount} source files; dependencies excluded.`);
  } catch (error) {
    console.error(`Package check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

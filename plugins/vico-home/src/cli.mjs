import path from 'node:path';
import { createConfig, defaultConfigPath, parseConfig, readPrivateFile, ConfigError } from './config.mjs';
import { HomeService, safeError } from './service.mjs';

const args = process.argv.slice(2);
const command = args.shift();
let configPath = defaultConfigPath();
const pos = args.indexOf('--config');
if (pos >= 0 && args[pos + 1]) { configPath = path.resolve(args[pos + 1]); args.splice(pos, 2); }
try {
  if (command === 'init') {
    if (args.length) throw new ConfigError('ARGUMENTS_INVALID', 'init 只接受可选 --config 路径。');
    await createConfig(configPath, { version: 1, mqtt: {}, devices: [] });
    console.log(JSON.stringify({ ok: true, config_path: configPath, enabled_devices: 0 }));
  } else if (command === 'import-vico') {
    if (args.length !== 1) throw new ConfigError('ARGUMENTS_INVALID', '提供自己本机 devices.json 的绝对路径；不会自动寻找或覆盖配置。');
    const raw = JSON.parse(await readPrivateFile(path.resolve(args[0])));
    if (raw.version !== 1 || !Array.isArray(raw.devices) || Object.keys(raw).some(k => !['version', 'devices'].includes(k)))
      throw new ConfigError('CONFIG_INVALID', '不是支持的 VICO 设备注册表。');
    const data = parseConfig({ version: 1, mqtt: {}, devices: raw.devices });
    await createConfig(configPath, data);
    console.log(JSON.stringify({ ok: true, config_path: configPath, imported_devices: data.devices.length, note: '已复制白名单；原 VICO 配置未改。' }));
  } else if (command === 'check' || command === 'list' || command === 'status') {
    if ((command === 'status' && args.length !== 1) || (command !== 'status' && args.length)) throw new ConfigError('ARGUMENTS_INVALID', '参数数量不正确。');
    const service = new HomeService({ configPath });
    console.log(JSON.stringify({ ok: true, ...await (command === 'check' ? service.health() : command === 'list' ? service.list() : service.status(args[0])) }, null, 2));
  } else {
    console.log('VICO Home: init | import-vico <devices.json> | check | list | status <device_id> [--config <path>]\nCLI intentionally has no light-switch command. Use Codex with the owner-authorized MCP tool.');
    if (command && !['help', '--help', '-h'].includes(command)) process.exitCode = 2;
  }
} catch (error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }

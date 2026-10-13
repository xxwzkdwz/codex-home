import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(code, message) { super(message); this.code = code; this.outcome = 'not_sent'; }
}

const label = z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/);
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const topic = z.string().max(256).regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/);
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/);
export const deviceSchema = z.object({
  device_id: id, room_id: id, name: label, aliases: z.array(label).max(20).default([]),
  kind: z.literal('light'), mqtt_topic: topic.refine(v => !v.split('/').some(s => ['bridge', 'get', 'set', 'availability'].includes(s))),
  capabilities: z.array(z.literal('state')).min(1).max(1).default(['state']),
  enabled: z.boolean().default(true), require_availability: z.boolean().default(true),
}).strict();
export const configSchema = z.object({
  version: z.literal(1),
  mqtt: z.object({
    url: z.string().max(2048).default('mqtt://127.0.0.1:1883'),
    base_topic: topic.default('zigbee2mqtt'),
    timeout_ms: z.number().int().min(1000).max(30000).default(8000),
    allow_insecure_lan: z.boolean().default(false),
    username_env: envName.optional(), password_env: envName.optional(),
    password_file: z.string().min(1).max(4096).optional(), ca_file: z.string().min(1).max(4096).optional(),
  }).strict().prefault({}),
  devices: z.array(deviceSchema).max(256),
}).strict().superRefine((data, ctx) => {
  const ids = data.devices.map(d => d.device_id);
  const topics = data.devices.map(d => d.mqtt_topic);
  if (new Set(ids).size !== ids.length || new Set(topics).size !== topics.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate devices' });
  if (data.mqtt.password_file && data.mqtt.password_env)
    ctx.addIssue({ code: 'custom', message: 'Choose one password source' });
});

export function defaultConfigPath(env = process.env) {
  if (env.VICO_HOME_CONFIG) return path.resolve(env.VICO_HOME_CONFIG);
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'VICO Home')
    : process.platform === 'win32' ? path.join(env.APPDATA || os.homedir(), 'VICO Home')
    : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vico-home');
  return path.join(base, 'config.json');
}

export async function readPrivateFile(file, maxBytes = 65536) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new ConfigError('CONFIG_INVALID', '配置或凭据文件不是大小合规的普通文件。');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))
      throw new ConfigError('CONFIG_PERMISSIONS', '配置或凭据文件必须属于当前用户，权限为 0600。');
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new ConfigError('CONFIG_INVALID', '配置或凭据文件超过安全大小。');
    return buffer.subarray(0, length).toString('utf8');
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    if (error.code === 'ENOENT') throw new ConfigError('CONFIG_NOT_FOUND', '尚未配置 VICO Home；请先运行 setup。');
    throw new ConfigError('CONFIG_UNREADABLE', '无法安全读取配置或凭据文件。');
  } finally { await handle?.close(); }
}

export function parseConfig(raw) {
  try {
    const parsed = configSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    const url = new URL(parsed.mqtt.url);
    if (!['mqtt:', 'mqtts:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
      throw new Error('Unsupported URL');
    if (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535)) throw new Error('Bad port');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol === 'mqtt:' && !loopback && !parsed.mqtt.allow_insecure_lan)
      throw new ConfigError('INSECURE_BROKER', '非本机网关请使用 mqtts；仅在可信局域网明确接受明文风险后开启 allow_insecure_lan。');
    return parsed;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('CONFIG_INVALID', '配置格式不合法；检查示例、设备类型、唯一 ID/Topic 和 MQTT 地址。');
  }
}

export async function loadConfig(file = defaultConfigPath(), env = process.env) {
  const config = parseConfig(await readPrivateFile(file));
  const requireEnv = name => {
    const value = env[name];
    if (typeof value !== 'string' || !value.length) throw new ConfigError('CREDENTIAL_MISSING', '指定的 MQTT 凭据环境变量尚未设置。');
    return value;
  };
  const mqtt = { ...config.mqtt };
  if (mqtt.username_env) mqtt.username = requireEnv(mqtt.username_env);
  if (mqtt.password_env) mqtt.password = requireEnv(mqtt.password_env);
  if (mqtt.password_file) mqtt.password = (await readPrivateFile(path.resolve(path.dirname(file), mqtt.password_file), 8192)).replace(/\r?\n$/, '');
  if (mqtt.ca_file) mqtt.ca = await readPrivateFile(path.resolve(path.dirname(file), mqtt.ca_file), 65536);
  return { ...config, mqtt };
}

// Setup creates a new file exclusively. Updating existing user settings is deliberate/manual.
export async function createConfig(file, data) {
  const parsed = parseConfig(data);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try { await fs.writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new ConfigError('CONFIG_EXISTS', '已有配置，未覆盖；请编辑现有配置或选择新路径。');
    throw new ConfigError('CONFIG_WRITE_FAILED', '无法创建本机配置。');
  }
}

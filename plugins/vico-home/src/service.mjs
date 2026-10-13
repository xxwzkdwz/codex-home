import { loadConfig, ConfigError } from './config.mjs';
import { MqttTransport, HomeError } from './transport.mjs';

const normalize = text => text.toLocaleLowerCase('en-US').replace(/\s/g, '');
function publicDevice(d) {
  return { device_id: d.device_id, room_id: d.room_id, name: d.name, aliases: d.aliases, kind: d.kind, capabilities: d.capabilities };
}
export function resolveDevice(config, ref) {
  if (typeof ref !== 'string' || !ref.trim() || ref.length > 80) throw new ConfigError('DEVICE_NOT_FOUND', '请提供有效的设备名称或 ID。');
  const wanted = normalize(ref);
  const matches = config.devices.filter(d => d.enabled && [d.device_id, d.name, ...d.aliases].some(s => normalize(s) === wanted));
  if (!matches.length) throw new ConfigError('DEVICE_NOT_FOUND', '未找到已启用的设备；请先列出设备。');
  if (matches.length !== 1) throw new ConfigError('DEVICE_AMBIGUOUS', '名称对应多个设备；请使用准确的 device_id。');
  return matches[0];
}

export class HomeService {
  constructor({ configPath, loader = loadConfig, transport = new MqttTransport() } = {}) {
    this.configPath = configPath; this.loader = loader; this.transport = transport; this.pending = new Map(); this.uncertain = new Set();
  }
  async list(roomId) {
    const config = await this.loader(this.configPath);
    const devices = config.devices.filter(d => d.enabled && (!roomId || d.room_id === roomId)).map(publicDevice);
    return { devices, count: devices.length, supported: ['light:state'] };
  }
  async health(options = {}) {
    const config = await this.loader(this.configPath);
    return { configured: true, enabled_devices: config.devices.filter(d => d.enabled).length, ...await this.transport.health(config, options) };
  }
  async #run(ref, state, options = {}) {
    const config = await this.loader(this.configPath);
    if (options.signal?.aborted) throw new HomeError('REQUEST_CANCELLED', '请求已取消，未发送控制。');
    const device = resolveDevice(config, ref);
    const key = `${config.mqtt.url}|${config.mqtt.base_topic}|${device.mqtt_topic}`;
    if (state && this.uncertain.has(key)) throw new HomeError('STATUS_REQUIRED', '上次控制结果不确定；请先读取新鲜状态，再按用户意图决定，不自动重放。', { outcome: 'unknown' });
    // Reject, do not queue: a delayed physical action can outlive the user's immediate intent.
    if (this.pending.has(key)) throw new ConfigError('DEVICE_BUSY', '该设备有未完成请求；先等待结果，不自动重试控制。');
    this.pending.set(key, true);
    try {
      const result = state ? await this.transport.setState(config, device, state, options) : await this.transport.status(config, device, options);
      if (!state) this.uncertain.delete(key);
      return { ...publicDevice(device), ...result };
    } catch (error) {
      if (state && (!(error instanceof HomeError) || error.outcome === 'unknown')) {
        this.uncertain.add(key);
        if (!(error instanceof HomeError)) throw new HomeError('CONTROL_ERROR', '控制未获确认；状态可能已改变，请先读取状态。', { outcome: 'unknown' });
      }
      throw error;
    } finally { this.pending.delete(key); }
  }
  status(ref, options) { return this.#run(ref, undefined, options); }
  setState(ref, state, options) {
    if (!['ON', 'OFF'].includes(state)) throw new ConfigError('STATE_INVALID', '只支持明确的 ON 或 OFF，不支持 toggle。');
    return this.#run(ref, state, options);
  }
}

export function safeError(error) {
  const known = error instanceof ConfigError || error instanceof HomeError;
  return { ok: false, error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '操作失败，未回显内部配置或凭据。' }, request_outcome: error.outcome === 'unknown' ? 'unknown' : 'not_sent', retry_safe: false };
}

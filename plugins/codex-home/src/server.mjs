import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { HomeService, safeError } from './service.mjs';

const service = new HomeService();
const server = new McpServer({ name: 'codex-home', version: '0.1.3' });
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const result = action => async (args, extra) => {
  try {
    const data = { ok: true, ...await action(args, { signal: extra.signal }) };
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
  } catch (error) {
    const data = safeError(error);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
  }
};
server.registerTool('home_list_devices', {
  title: 'List configured home lights', description: 'List owner-configured enabled lights; returns safe IDs/names, never broker credentials or MQTT topics. Does not discover or enroll devices.',
  inputSchema: { room_id: z.string().max(80).optional() }, annotations: read,
}, result(args => service.list(args.room_id)));
server.registerTool('home_health', {
  title: 'Check home gateway', description: 'Check local configuration and read Zigbee2MQTT bridge availability. Does not change lights, restart services, pair devices, or inspect unrelated data.',
  inputSchema: {}, annotations: read,
}, result((_args, options) => service.health(options)));
server.registerTool('home_status', {
  title: 'Read light state', description: 'Query one exact configured light without changing it. In correlated_read mode a fixed ZCL onOff read with a unique response property verifies device switch state; the MQTT /set wrapper does not switch the light. Default gateway reports can contain cached state and remain unverified. Only a successful correlated read clears unknown-control protection. This is not proof of physical illumination.',
  inputSchema: { device_ref: z.string().min(1).max(80) }, annotations: read,
}, result((args, options) => service.status(args.device_ref, options)));
server.registerTool('home_set_state', {
  title: 'Set light ON or OFF',
  description: 'Physically switch one owner-authorized configured light ON/OFF. Only call for an explicit user request or authorized automation. Requires prepared correlated_read mode; do not bypass STATE_CONFIRMATION_REQUIRED. Resolve ambiguous devices first. Sends one ON/OFF command, then one correlated device read to check switch state; not optical or command-causality proof. On request_outcome=unknown, do not retry/replay: read status and report uncertainty; an unverified read cannot unlock controls. No toggle, groups, arbitrary MQTT, enrollment, locks, heaters or appliances.',
  inputSchema: { device_ref: z.string().min(1).max(80), state: z.enum(['ON', 'OFF']) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
}, result((args, options) => service.setState(args.device_ref, args.state, options)));

await server.connect(new StdioServerTransport());

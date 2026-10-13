---
name: setup
description: Set up or diagnose the standalone VICO Home Codex plugin with an existing Zigbee2MQTT gateway and a private light allowlist. Use for installation, local MQTT connection setup, importing an explicitly selected VICO registry, or gateway-offline diagnosis.
---

# Set up VICO Home

Resolve the plugin root two directories above this skill. Read `../../README.md` for platform-specific paths and supported configuration fields. This is a local desktop/CLI integration, not a hosted universal smart-home service.

1. Inspect the current installation and available tools. VICO Home needs Node.js 22+ and an existing reachable Mosquitto-compatible MQTT broker plus Zigbee2MQTT and paired lights. It does not require VICO Core or another model subscription. Do not install/reset a Zigbee network just because the plugin is unconfigured.
2. If runtime dependencies are missing in the installed copy, run `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in that plugin root. Do not substitute an old checkout's path.
3. Use `node src/cli.mjs init` from the plugin root to create a private empty configuration without overwriting an existing file. To reuse VICO's device registry, require an explicitly selected local file and run `node src/cli.mjs import-vico <absolute-devices.json-path>`. This copies the device allowlist into separate local settings; it does not read or copy Zigbee keys or alter VICO. An existing destination is never overwritten.
4. Guide the owner to edit their private configuration with their broker and exact light topics. Use `examples/config.example.json` only as a synthetic reference; its device is disabled. Do not paste real config or credentials into chat. Passwords are supplied by owner-controlled environment variables or a separate owner-only file. Never ask for passwords, network keys or backups in conversation. Keep broker TLS verification enabled.
5. Run `node src/cli.mjs check` (read-only) or use `home_health`. A healthy broker/bridge does not prove device control. Use `home_list_devices`; a `home_status` read is appropriate within the owner's setup or connectivity-check request and needs no separate permission. A real ON/OFF test requires the user to authorize that light action and any intended restoration; setup alone is not permission to flash the home lights.

Default MQTT is loopback. Non-loopback plaintext needs the owner's explicit acceptance of trusted-LAN risk before `allow_insecure_lan` is enabled; recommend `mqtts` for authenticated remote brokers. Do not expose an unauthenticated broker on the internet. On macOS/Linux the config, password and custom CA files must belong to the current user and have mode 0600; Windows relies on owner-managed file ACLs.

Offline bridge: inspect only task-relevant process/port/serial diagnostics. If the coordinator is unplugged or a path changed, explain that evidence and ask the owner to reconnect/confirm the intended hardware. Preserve existing keys, PAN, pairing database and working services. Do not automatically restart, re-pair, remove devices or change serial settings.

Install/update through the repository's installer or Codex's marketplace commands, not by overwriting the user's entire Codex configuration. After installation use a new Codex chat/session to load tools. A successful simulated test is not real-device acceptance; say exactly which layer passed.

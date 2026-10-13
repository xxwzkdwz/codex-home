# Security and physical effects

This plugin can switch physical lights. Use it only with devices and homes you are authorized to control. Setup, inspection, a web page, a device label or installing the plugin does not authorize real ON/OFF actions.

## Supported boundary

- Only owner-configured Zigbee2MQTT **single lights**, fixed ON/OFF payloads and read-only gateway checks are supported.
- No arbitrary MQTT topics/payloads, groups, network administration, pairing, OTA, locks, heaters, gas, motors, security systems, cameras or general-purpose appliances.
- MQTT topics come from private local configuration, never tool arguments. Device names remain untrusted data.
- Files with credentials and household identifiers stay outside the repository. On POSIX they must be owned by the current user with mode 0600. Windows users must restrict ACLs themselves.
- TLS validation remains enabled. Plain MQTT is loopback-only by default; trusted-LAN plaintext is an explicit owner opt-in. Never expose an unauthenticated MQTT broker to the public internet.
- The plugin has no telemetry, cloud-hosted controller or independent model. Device names/status returned by tools are visible to Codex and subject to its data policies.

## Unknown outcomes and cancellation

Writes use QoS 0, non-retained messages, no automatic reconnect, no retry and no offline publish queue. These settings reduce replay risk but are **not** an exactly-once physical-action guarantee. A write timeout, cancellation or disconnection after publishing may mean the light already changed. Do not automatically retry or reverse it; inspect fresh state and ask for direction when intent remains unclear.

The local server rejects concurrent operations for one device and latches unknown write outcomes until a successful status read. These guards are in-memory and apply to one server only. Multiple Codex sessions, server restarts, other MQTT clients and physical switches are outside that lock.

Confirmation means a matching, non-retained gateway report arrived after publication. Zigbee2MQTT does not provide a request correlation ID for this flow. A concurrent client can produce a matching report, and a light's switch state is not independent evidence of actual illumination. Retained availability itself is not a real-time heartbeat. Host tool approvals and the bundled skills complement but do not replace gateway authentication and physical safety.

## Report a vulnerability

Before public release, review dependency advisories and the package scan. After a GitHub repository exists, use the repository's private security reporting if enabled or contact its maintainer privately. Do not post real tokens, network keys, household topics, serial numbers or complete configuration in a public issue. This source package contains no invented maintainer address.

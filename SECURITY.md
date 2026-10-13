# Security and physical effects

This plugin can switch physical lights. Use it only with devices and homes you are authorized to control. Setup, inspection, a web page, a device label or installing the plugin does not authorize real ON/OFF actions.

## Supported boundary

- Only owner-configured Zigbee2MQTT **single-channel lights with standard genOnOff/onOff on the default endpoint**, fixed ON/OFF payloads and read-only checks are supported. Groups, endpoint suffixes and vendor-private state emulation are not supported.
- `state_confirmation` defaults to `unverified`, including for old configurations. It permits unverified observations but rejects switching. Correlated mode requires gateway preparation and a read-only preflight; installation does not silently opt in devices or edit gateway settings.
- No arbitrary MQTT topics/payloads, groups, network administration, pairing, OTA, locks, heaters, gas, motors, security systems, cameras or general-purpose appliances.
- MQTT topics come from private local configuration, never tool arguments. Device names remain untrusted data.
- Files with credentials and household identifiers stay outside the repository. On POSIX they must be owned by the current user with mode 0600. Windows users must restrict ACLs themselves.
- TLS validation remains enabled. Plain MQTT is loopback-only by default; trusted-LAN plaintext is an explicit owner opt-in. Never expose an unauthenticated MQTT broker to the public internet.
- The plugin has no telemetry, cloud-hosted controller or independent model. Device names/status returned by tools are visible to Codex and subject to its data policies.

## Unknown outcomes and cancellation

Writes use QoS 0, non-retained messages, no automatic reconnect, no retry and no offline publish queue. These settings reduce replay risk but are **not** an exactly-once physical-action guarantee. A write timeout, cancellation or disconnection after publishing may mean the light already changed. Do not automatically retry or reverse it; inspect fresh state and ask for direction when intent remains unclear.

The local server rejects concurrent operations for one device and latches unknown write outcomes until a successful **correlated** status read. Unverified gateway observations never unlock it. These guards are in-memory and apply to one server only. Multiple Codex sessions, server restarts, other MQTT clients and physical switches are outside that lock.

Ordinary `state` can be cached or optimistic even in a new non-retained envelope. Confirmation instead requires the exact, newly generated `state_property` returned by Z2M's generic read converter after reading standard `genOnOff/onOff`. This is a fixed read-only operation carried on `/set`, not an arbitrary MQTT interface. ON/OFF is sent once; a normal matching report only triggers one correlated read. Mismatching readback returns unknown, never an automatic retry. Never weaken exact nonce/topic matching to accommodate endpoint suffixes.

Source compatibility was reviewed for Z2M 2.14.2 / converters 26.115.1; preparation, filtering and upgrade instructions are in the [runtime README](plugins/codex-home/README.md). Each light needs the `^codex_home_read_.*$` cache filter to prevent unbounded dynamic-property accumulation, JSON output, and the upstream generic-read publication path enabled (`optimistic: true` or its default). Ordinary optimistic state is still not trusted. Filtered or unsupported reads fail closed, not via fallback to ordinary state. Read-only preflight does not itself authorize a control test.

The result verifies a device switch bit read, not actual illumination, exclusive control causality or exactly-once physical execution. Nonces prevent accidental cached-response confusion, not attacks by trusted MQTT publishers or a compromised gateway. Retained availability is not a real-time heartbeat. Host tool approvals and the bundled skills complement but do not replace gateway authentication and physical safety.

## Report a vulnerability

Before public release, review dependency advisories and the package scan. After a GitHub repository exists, use the repository's private security reporting if enabled or contact its maintainer privately. Do not post real tokens, network keys, household topics, serial numbers or complete configuration in a public issue. This source package contains no invented maintainer address.

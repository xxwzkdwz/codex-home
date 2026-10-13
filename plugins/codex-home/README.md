# Codex Home runtime

[中文](#中文) · [English](#english)

## 中文

独立的 Codex 智能灯插件，当前只支持已登记 Zigbee2MQTT 灯的 `ON/OFF`。不需要独立的家庭控制主程序、Python、Home Assistant Server 或额外模型 API Key；已有 Home Assistant 的用户可以复用自己的 Zigbee2MQTT。仍需可用的 Codex 会话和自己的 MQTT/Zigbee2MQTT 网关。

### 本机配置

需要 Node.js 22+。若缺少运行依赖，在**实际安装的插件目录**运行：

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
```

从空白配置开始时，在该目录运行：

```sh
node src/cli.mjs init
```

命令打印本机配置路径，不打印凭据。默认路径：

- macOS：`~/Library/Application Support/Codex Home/config.json`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/codex-home/config.json`
- Windows：`%APPDATA%/Codex Home/config.json`

环境变量 `CODEX_HOME_LIGHTS_CONFIG` 可指定配置文件；CLI 也支持 `--config <路径>`。CLI 的 `--config` 优先于该环境变量。MCP 工具使用其进程环境中的配置路径，配置内容的变更在下一次工具调用加载。

也可以**代替 init**，导入自己明确选定的本机设备注册表：

```sh
node src/cli.mjs import-registry /absolute/path/to/your/devices.json
```

原表必须是仅含 `version: 1` 和 `devices` 数组的 JSON，数组中的每个设备符合下方字段要求。例如，下面是一个停用的合成设备：

```json
{
  "version": 1,
  "devices": [
    {
      "device_id": "light.demo",
      "room_id": "demo_room",
      "name": "示例灯",
      "aliases": ["测试灯"],
      "kind": "light",
      "mqtt_topic": "demo-light",
      "capabilities": ["state"],
      "enabled": false,
      "require_availability": true,
      "state_confirmation": "unverified"
    }
  ]
}
```

导入只复制设备白名单，为 MQTT 使用默认设置；不会自动搬迁连接凭据，不修改原表，不读取或复制 Zigbee 网络密钥。`init` 和 `import-registry` 都不覆盖已有配置。若已运行过 init，可编辑现有配置，或用 `--config <新文件路径>` 选择不存在的目的文件；MCP 也必须使用你最终选定的配置路径。不要将原表或生成的私人配置加入仓库。

在自己的编辑器中参照 [合成配置示例](examples/config.example.json) 编辑配置。示例设备默认禁用。只登记你确认用于照明的单个设备，不填 groups 或用于电器的智能插座。

| 字段 | 含义 |
| --- | --- |
| `version` | 固定 `1` |
| `mqtt.url` | 默认 `mqtt://127.0.0.1:1883`；仅支持 `mqtt` / `mqtts`，不接受内嵌用户名密码、query、fragment 或非根 URL 路径 |
| `mqtt.base_topic` | 默认 `zigbee2mqtt`，支持安全的多级 topic |
| `mqtt.timeout_ms` | 单次操作总超时，1000–30000 毫秒，默认 8000 |
| `mqtt.username_env` / `password_env` | 从你在 Codex 启动环境中设置的环境变量读取凭据 |
| `mqtt.password_file` | 或从配置目录相对路径/绝对路径的私密文件读密码，不能同时设置 `password_env` |
| `mqtt.ca_file` | 自签证书的受信任 CA 文件；支持配置目录相对路径或绝对路径，不关闭 TLS 校验 |
| `mqtt.allow_insecure_lan` | 默认为 false；仅在主人明确接受可信局域网的明文风险后设为 true。跨主机优先使用有认证的 `mqtts` |
| `devices[].device_id` / `room_id` | 必填的稳定小写英文 ID，以字母或数字开头，后续允许字母、数字、点、下划线和连字符 |
| `name` / `aliases` | `name` 必填，`aliases` 默认空数组；展示名称及别名可用中文，重名必须用精确 ID 消歧 |
| `kind` / `capabilities` | `kind` 必须为 `light`；`capabilities` 仅支持 `["state"]`，缺省时采用该值 |
| `mqtt_topic` | 必填的单个 Zigbee2MQTT friendly_name，不含 base_topic 或端点后缀；不允许通配符或 `bridge/get/set/availability` 保留段 |
| `enabled` | 默认 true；停用后不会列出或控制，仓库示例特意设为 false |
| `require_availability` | 默认 true，要求 Zigbee2MQTT 已启用该设备的 availability；若设备没有该功能，由主人明确设 false，仍检查 bridge 状态，不放宽确认要求 |
| `state_confirmation` | 默认 `unverified`，只读、拒绝开关；准备好下方协议后显式设 `correlated_read`，使用唯一标记的设备读取确认 |

Topic 每个 `/` 分段以英文字母、数字、下划线或连字符开头，后续可另含点；设备 ID 和设备 topic 各自必须唯一。精确 ID 优先于名称和别名，停用的 ID 不会回落到另一盏灯的同名别名。配置不接受未列出的额外字段。配置上限为 65,536 UTF-8 字节；最多 256 个设备还受该字节限制，格式化和默认字段展开后超限也会拒绝，且不创建或覆盖目标文件。

macOS/Linux 的配置、导入注册表、密码和自定义 CA 文件应为当前用户拥有的普通文件，权限 0600；可对**选定文件**执行 `chmod 600 <文件>`。Windows 上请用文件 ACL 限制为自己的账号。不要把真实密码放命令行参数或聊天里，也不要公开 MQTT broker。安装和只读检查不授权开关灯。

### 检查

```sh
node src/cli.mjs check
node src/cli.mjs list
node src/cli.mjs status light.demo
```

将 `light.demo` 换成你已启用的准确设备 ID。`check` 只读 bridge 状态；`list` 只读本机白名单；`status` 不改变灯：默认模式发 `/get`，关联模式使用 `/set` topic 包装固定的只读 ZCL 请求。CLI 不提供开关命令；控制通过 Codex 的 `home_set_state`，受宿主授权规则约束。明确的 ON/OFF 请求已经授权该次普通动作，无需再加口头确认。

### 0.1.2 状态确认与升级

普通 MQTT `state` 可能是缓存或网关推测；即使不是 retained 消息，也不能证明灯的当前状态。因此旧配置缺省为 `unverified`，读取结果标为 `unverified_gateway_report`，**不能开关灯，也不能解除未知结果保护**。这是一项有意的安全兼容性变化；安装器不会改写你的配置或网关。不要只为解除错误而改开关。

`correlated_read` 只适用于**默认端点支持标准 `genOnOff/onOff` 的单通道灯**，不支持群组、多通道、端点后缀或只靠厂商私有数据点模拟 state 的设备。仅有 `state` GET/SET 能力不足以认定兼容。源码核对范围是 Zigbee2MQTT **2.14.2** / converters **26.115.1**；其他版本应先核对兼容性。新协议仍需你自己的只读预检与授权后的真灯验收。

主人确认兼容性和变更范围后，在该灯的 Zigbee2MQTT 设置中合并（不是覆盖原列表）：

```yaml
# 仅为单灯设备条目的选项片段，不是完整网关配置。
optimistic: true
filtered_cache:
  - '^codex_home_read_.*$'
```

`optimistic: true` 是上游默认值，也是通用 read 结果能发布的必要条件；插件**不信任普通推测 state**。缓存过滤防止每次读取的随机字段累积。MQTT 输出须含 JSON（`json` 或 `attribute_and_json`）；不要在 `filtered_attributes` / `filtered_optimistic` 中屏蔽 `codex_home_read_` 字段，不要过滤触发后续读取的普通 `state`。不要自动修改、重启已有网关；保留原配置与配对数据。首次配置可参考仓库的双语 Mac 网关指南。

准备好后将私人插件配置中这盏灯的 `state_confirmation` 设为 `correlated_read`，先运行上面的 `status`。只有返回 `confirmation: correlated_device_read`、`state_freshness_verified: true` 和 `request_outcome: confirmed` 才通过该只读预检。若超时，检查版本、默认端点、发布过滤和设备支持；不要退回信任普通 state 或重发开关动作。

协议向该灯 `/set` 发送固定 `read`：cluster 为 `genOnOff`，attributes 为 `["onOff"]`，`state_property` 是每次新生成的 `codex_home_read_<随机标记>`。只有对应标记下的设备读取值 `0/1` 或布尔值能确认。开关时仅发送一次 ON/OFF，等普通匹配 state 作为读取时机信号，再读取一次；读值不符返回 `STATE_MISMATCH/unknown`，无回复则超时，不重试。源码依据：[上游 read converter](https://github.com/Koenkk/zigbee-herdsman-converters/blob/v26.115.1/src/converters/toZigbee.ts)、[Z2M 发布流程](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/publish.ts)。

桥接离线或 USB 协调器未识别时，先检查已有网关与线缆，不要清库/重新配网。`request_outcome: unknown` 表示命令可能已经生效，先读状态，不重发或擅自恢复原状态；新的控制应对应主人的下一步意图。

### 数据与边界

MCP 工具返回设备名称/别名、ID、能力、状态、时间及固定错误等展示数据，不返回 MQTT topic、地址或凭据。Codex 会接收这些工具结果并按其数据政策处理；不能宣传为所有数据都不离开电脑。插件本身不附加遥测、托管云服务、模型请求或后台计划。

`correlated_device_read` 表示这次关联读取的设备开关位符合结果，不是物理光照传感器，也不证明唯一控制因果或恰好一次物理执行。只有成功的关联 status 能解除未知结果保护。锁定和未知结果保护仅限一个 MCP 进程；多个 Codex 会话/其他控制器仍可同时影响设备。网关和 MQTT 发布者属于信任边界，标记不是抵御恶意网关的认证机制。

不支持门锁、加热、燃气、电机、摄像头、批量群控、亮度/色温、任意 MQTT、配网、OTA 或固件升级。安装插件不等于配好了 Zigbee 网关；它不兼容所有品牌的私有云接口。

## English

Codex Home is a standalone Codex plugin for `ON/OFF` control of registered Zigbee2MQTT lights. It does not require a separate home-control application, Python, Home Assistant Server, or an additional model API key. Existing Home Assistant users can reuse their Zigbee2MQTT gateway. A working Codex session and your own MQTT/Zigbee2MQTT gateway are still required.

### Local configuration

Node.js 22+ is required. If runtime dependencies are missing, run this in the **actual installed plugin directory**:

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
```

To start with an empty configuration, run in that directory:

```sh
node src/cli.mjs init
```

The command prints the local configuration path, not credentials. Default paths:

- macOS: `~/Library/Application Support/Codex Home/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/codex-home/config.json`
- Windows: `%APPDATA%/Codex Home/config.json`

Set `CODEX_HOME_LIGHTS_CONFIG` to select a configuration file. The CLI also accepts `--config <path>`, which takes precedence over that environment variable. MCP tools use the path selected in their process environment and reload the file contents on the next tool call.

**Instead of init**, you can import a local device registry you explicitly select:

```sh
node src/cli.mjs import-registry /absolute/path/to/your/devices.json
```

The source must be a JSON object containing only `version: 1` and a `devices` array. Every device must follow the fields below. This example contains one disabled synthetic device:

```json
{
  "version": 1,
  "devices": [
    {
      "device_id": "light.demo",
      "room_id": "demo_room",
      "name": "Demo light",
      "aliases": ["Test light"],
      "kind": "light",
      "mqtt_topic": "demo-light",
      "capabilities": ["state"],
      "enabled": false,
      "require_availability": true,
      "state_confirmation": "unverified"
    }
  ]
}
```

Import copies only the device allowlist and uses default MQTT settings. It does not migrate connection credentials, modify the source registry, or read or copy Zigbee network keys. Neither `init` nor `import-registry` overwrites an existing configuration. If you already ran init, edit the existing configuration or choose a new, nonexistent destination with `--config <new-file-path>`; MCP must also use your final selected configuration path. Keep the registry and generated private configuration out of the repository.

Edit your configuration locally using the [synthetic configuration example](examples/config.example.json). Its device is disabled by default. Register only individual devices you know are used for lighting, not groups or smart plugs powering appliances.

| Field | Meaning |
| --- | --- |
| `version` | Must be `1` |
| `mqtt.url` | Defaults to `mqtt://127.0.0.1:1883`; supports only `mqtt` / `mqtts`, without embedded credentials, a query, a fragment, or a non-root URL path |
| `mqtt.base_topic` | Defaults to `zigbee2mqtt`; supports safe topic segments |
| `mqtt.timeout_ms` | Total operation timeout: 1000–30000 milliseconds, default 8000 |
| `mqtt.username_env` / `password_env` | Read credentials from environment variables available when Codex starts |
| `mqtt.password_file` | Alternatively, read a private password file using an absolute path or a path relative to the configuration directory; cannot be combined with `password_env` |
| `mqtt.ca_file` | Trusted CA file for a self-signed certificate, using an absolute path or a path relative to the configuration directory; TLS verification stays enabled |
| `mqtt.allow_insecure_lan` | Defaults to false; enable only after the owner explicitly accepts plaintext risk on a trusted LAN. Prefer authenticated `mqtts` across hosts |
| `devices[].device_id` / `room_id` | Required stable lowercase IDs, starting with a letter or digit and followed by letters, digits, dots, underscores, or hyphens |
| `name` / `aliases` | `name` is required; `aliases` defaults to an empty array. Display names and aliases may use non-English text; use an exact ID to resolve duplicate names |
| `kind` / `capabilities` | `kind` must be `light`; the only supported `capabilities` value is `["state"]`, also the default |
| `mqtt_topic` | Required friendly_name of one Zigbee2MQTT device, without base_topic or an endpoint suffix; no wildcards or reserved `bridge/get/set/availability` segments |
| `enabled` | Defaults to true; disabled devices cannot be listed or controlled. The repository example deliberately sets this to false |
| `require_availability` | Defaults to true and requires availability for that device in Zigbee2MQTT. If unavailable, the owner can explicitly set false; bridge checks remain and confirmation requirements are not relaxed |
| `state_confirmation` | Defaults to `unverified`: read-only, switching rejected. Explicitly select `correlated_read` after preparing the protocol below to confirm via uniquely tagged device reads |

Each `/`-separated topic segment starts with an ASCII letter, digit, underscore, or hyphen; subsequent characters may also include dots. Device IDs must be unique, as must device topics. Exact IDs take precedence over names and aliases; a disabled ID never falls through to another light's matching alias. Unlisted extra configuration fields are rejected. Configuration is limited to 65,536 UTF-8 bytes; the maximum 256 devices are also subject to this byte limit. Oversized formatted/default-expanded output is rejected without creating or overwriting the destination.

On macOS/Linux, configuration, imported registry, password, and custom CA files should be regular files owned by the current user with mode 0600. Apply `chmod 600 <file>` only to the **selected file**. On Windows, restrict file ACLs to your account. Never put real passwords in command-line arguments or chat, and do not expose the MQTT broker publicly. Installation and read-only checks do not authorize switching lights.

### Checks

```sh
node src/cli.mjs check
node src/cli.mjs list
node src/cli.mjs status light.demo
```

Replace `light.demo` with the exact ID of an enabled device. `check` reads bridge state and `list` reads the local allowlist. `status` does not switch the light: the default mode uses `/get`, while correlated mode wraps a fixed read-only ZCL request in the `/set` topic. The CLI has no switching command. Control uses Codex's `home_set_state` and follows the host's approval policy. An explicit ON/OFF request already authorizes that ordinary action; no extra verbal confirmation is needed.

### 0.1.2 confirmation and migration

An ordinary MQTT `state` can come from cache or gateway optimism, even in a non-retained message. Existing configurations therefore default to `unverified`; reads return `unverified_gateway_report` and **cannot enable switching or clear an unknown outcome**. This is an intentional safety-related compatibility change. The installer does not rewrite your configuration or gateway. Do not change the mode merely to bypass an error.

`correlated_read` supports only **single-channel lights whose default endpoint implements standard `genOnOff/onOff`**. Groups, multiple channels, endpoint suffixes, and vendor-private data points that only emulate state are unsupported. A `state` GET/SET expose alone does not prove compatibility. Source review covers Zigbee2MQTT **2.14.2** / converters **26.115.1**; check compatibility before using other versions. This new protocol still needs your own read-only preflight and subsequently authorized physical acceptance.

After the owner confirms compatibility and the scope of changes, merge these options into the light's Zigbee2MQTT entry, preserving any existing list:

```yaml
# Options for one light only, not a complete gateway configuration.
optimistic: true
filtered_cache:
  - '^codex_home_read_.*$'
```

`optimistic: true` is the upstream default and is required for publishing the generic read result; the plugin **does not trust ordinary optimistic state**. Cache filtering prevents random read properties accumulating. MQTT output must include JSON (`json` or `attribute_and_json`). Do not filter `codex_home_read_` properties with `filtered_attributes` / `filtered_optimistic`, or filter the ordinary `state` that triggers the subsequent read. Do not automatically reconfigure or restart an existing gateway; preserve its settings and pairing data. First-time setup can use the repository's bilingual Mac gateway guide.

Once prepared, set this light's `state_confirmation` to `correlated_read` in the private plugin configuration, then run `status` above. Only `confirmation: correlated_device_read`, `state_freshness_verified: true`, and `request_outcome: confirmed` pass the read-only preflight. On timeout, check versions, the default endpoint, publishing filters and device support. Never fall back to trusting ordinary state or replay a switching action.

The fixed read request sent to the light's `/set` uses cluster `genOnOff`, attributes `["onOff"]`, and a new `state_property` of `codex_home_read_<random-tag>` each time. Only `0/1` or boolean device read values under that exact property confirm the result. Control sends ON/OFF once, waits for an ordinary matching state as a read-timing hint, and reads once. A mismatch returns `STATE_MISMATCH/unknown`; no response times out. Neither is retried. Sources: [upstream read converter](https://github.com/Koenkk/zigbee-herdsman-converters/blob/v26.115.1/src/converters/toZigbee.ts), [Z2M publishing flow](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/publish.ts).

If the bridge is offline or a USB coordinator is missing, inspect the existing gateway and cable first; do not clear the database or re-pair the network. `request_outcome: unknown` means the command may already have taken effect. Read the state first; do not replay the command or restore an earlier state automatically. Any new control should follow the owner's intended next action.

### Data and boundaries

MCP tools return display data such as device names/aliases, IDs, capabilities, states, timestamps, and fixed errors. They do not return MQTT topics, addresses, or credentials. Codex receives those results under its data policies, so do not claim that all data stays on the computer. The plugin adds no telemetry, hosted cloud service, model requests, or background schedules.

`correlated_device_read` means this uniquely tagged read returned the reported device switch state. It is not an optical sensor, proof of command causality, or an exactly-once physical-execution guarantee. Only a successful correlated status read clears an unknown outcome. Locks and unknown-result guards apply only within one MCP process; other Codex sessions or controllers may affect the device concurrently. The gateway and MQTT publishers remain trusted: the tag does not authenticate against a malicious gateway.

Locks, heating, gas, motors, cameras, group control, brightness/color temperature, arbitrary MQTT, pairing, OTA, and firmware upgrades are unsupported. Installing the plugin does not set up a Zigbee gateway, and it does not support every vendor's private cloud interface.

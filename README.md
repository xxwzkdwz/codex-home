# Codex Home

[简体中文](#zh-cn) · [English](#en)

<a id="zh-cn"></a>

## 简体中文

**在 Codex 里说句话，控制你自己的智能灯。** 本地运行、明确登记设备、按你的指令操作。

> v0.1.1：通过你自己的 **Zigbee2MQTT + MQTT 网关** 控制已登记灯具的开关。不是所有品牌通用的智能家居网关，也不是官方 OpenAI 插件。MIT 开源。

[买什么设备](HARDWARE.md) · [安装和使用](#安装和使用) · [详细配置](plugins/codex-home/README.md) · [安全说明](SECURITY.md)

```text
你的自然语言 → Codex → Codex Home 本地 MCP → MQTT → Zigbee2MQTT → 灯
```

可以说：“列出我家的灯”“查询示例灯的状态”“把示例灯关掉”。设备名由你在本机配置；仓库只有禁用的合成示例，不含作者家的设备、房间、账号或密钥。

## 先看适不适合你

- **已有 Zigbee2MQTT 的用户：**复用现有网关和已配对的兼容灯，不用再买一套，也不要重置现有网络。
- **第一次尝试：**建议先用一只兼容 Zigbee 灯泡、一只受支持的 Zigbee USB 协调器和一台运行网关的电脑，做单灯测试。采购前读 [硬件清单及准确型号](HARDWARE.md)。
- **只有普通灯或 Wi-Fi / 蓝牙 / Matter 灯：**不能仅靠这个插件直接接入。普通灯不能凭空变智能；当前没有这些协议或厂商云的接入功能。
- **只有厂商 App 或封闭网关：**不等于已经具备 Zigbee2MQTT。迁移设备可能需要重新配对、改变原生态，请先核对，不要为了试插件清空已有家庭配置。
- **不用额外模型 API Key：**使用当前 Codex 会话的模型；仍需要你自己的 Codex 使用权限，不能据此理解为 Codex 免费。

最低硬件是已有电脑、一个兼容 Zigbee 协调器、一只兼容灯泡和匹配的成品灯具；建议使用 USB 延长线。项目已使用 **SONOFF Dongle-PMG24** 完成网关链路验证；[硬件文档](HARDWARE.md)中的 IKEA `LED2201G8`、`LED2109G6` 只是 Zigbee2MQTT 目录候选，未在本项目逐一真机验证，不保证当地库存。购买前核对完整型号、电压、灯头和灯具要求。无需为首次试用拆装墙壁开关；任何市电接线都应交给合格电工。

控制时 Codex 所在电脑和 MQTT / Zigbee2MQTT 主机都要运行，灯具要通电。它不是电脑关机后仍可工作的云端助手。网关可以与 Codex 同机，也可以在你自己的树莓派、NAS 或另一台电脑上；后者需要安全的网络连接。

## 安装和使用

### 1. 先让网关能够控制灯

如果 Zigbee2MQTT 前端已经能正常开关目标灯，跳到第 2 步。

新用户先按 [Zigbee2MQTT 官方入门](https://www.zigbee2mqtt.io/guide/getting-started/) 安装 MQTT broker（如 Mosquitto）和 Zigbee2MQTT，选择实际协调器和串口。插入 USB 协调器不代表网关已经安装。不要照抄其他电脑的串口路径，也不要让两个服务同时占用同一协调器。

按目标型号的说明及 [官方配对指南](https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html) 配对**你准备接入的那只灯**，完成后关闭允许加入。先在 Zigbee2MQTT 前端实际开关一次，确认灯有响应，再接入本插件。已在别的网络配对的灯不要未经确认就重置。

Codex Home 要求该灯的 `state` 支持读取和写入，状态以 JSON 的 `state: ON/OFF` 回报；设备的 Exposes 页面应支持 state 的 `/get` 与 `/set`。优先为该灯启用 [Device Availability](https://www.zigbee2mqtt.io/guide/configuration/device-availability.html)。本插件不负责安装网关、配网或刷固件。

### 2. 安装插件

准备好：

- **macOS（已实际安装验证）或 Linux。** 当前安装脚本未适配 Windows 的 `.cmd` 启动方式，Windows 用户先不要按这套命令购买设备或承诺可用；下文 Windows 配置路径只是运行时格式说明，不代表 Windows 安装已经支持。
- 支持 `codex plugin add` 和 marketplace 命令的 **Codex CLI**。可以在 Codex 桌面端使用插件，但下面的安装脚本仍需要 CLI 在 PATH 中；没有这个命令时先完成官方 CLI 安装/更新。
- [Node.js](https://nodejs.org/en/download) 22 或更新版本，以及随附的 npm。
- Git；或从本仓库的 Code → Download ZIP 下载源码后解压。

使用 Git 的安装命令：

```sh
git clone https://github.com/xxwzkdwz/codex-home.git
cd codex-home
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

ZIP 用户在解压后的**仓库根目录**（有 `scripts` 和 `plugins` 的目录）运行后两条命令即可，不需要先有 npm 的全局包。

安装器会检查发布文件，通过 Codex 正式命令注册本地 marketplace `codex-home-local`、安装 `codex-home@codex-home-local`，并在**实际插件缓存**中安装锁定的 npm 依赖。安装会访问 npm registry；不会配置设备或开关灯，也不会覆盖整个 Codex 配置。

安装成功后**新建一个 Codex 聊天**，旧聊天不保证热加载工具。保持克隆目录可用，本地 marketplace 指向它。只执行 marketplace add 并不保证运行依赖已经准备好，因此初次使用推荐上面的安装器。[官方 marketplace 文档](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)

### 3. 配置你自己的灯

在新聊天中说：

> 使用 Codex Home，帮我连接我自己的 Zigbee2MQTT 网关。先做只读检查，不要开关灯。

插件的 setup 技能会指导你在实际插件目录运行 `node src/cli.mjs init`，创建本机私有配置。已有文件不会被覆盖。请在自己电脑的编辑器中填写连接信息，**不要把密码、网络密钥或整个网关配置贴到聊天和 Issue 中**。

默认配置位置：

- macOS：`~/Library/Application Support/Codex Home/config.json`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/codex-home/config.json`
- Windows：`%APPDATA%/Codex Home/config.json`

`CODEX_HOME_LIGHTS_CONFIG` 可指定其他配置文件；它必须设置在实际启动插件的 Codex 环境中。这是本插件的专用变量，**不是 Codex 自身的 `CODEX_HOME`**，不要替换后者。CLI 另支持 `--config /absolute/path/to/config.json`，但这个 CLI 参数不会替你配置 MCP 服务器的环境。

如果已有**符合本项目 version 1 格式**的设备注册表，可以不执行 `init`，而是在实际插件目录使用通用导入命令：

```sh
node src/cli.mjs import-registry /absolute/path/to/your/devices.json
```

导入只复制设备白名单，不导入网络密钥、不修改原文件，也不会覆盖已有目标配置；它不是任意网关数据库的导入器。若已经 `init`，请编辑已有配置，或通过 `--config` 明确选择一个新目标文件，不要删除正在使用的配置。

`import-registry` 只接受包含 `version` 与 `devices` 的注册表，**不要把含 `mqtt` 等字段的完整 `config.json` 当作注册表导入**。已有兼容的完整配置应保留原文件，通过 `CODEX_HOME_LIGHTS_CONFIG` 明确选用。

在 [合成配置示例](plugins/codex-home/examples/config.example.json) 基础上，只填自己确认用于照明的设备。关键项如下：

| 项目 | 如何填写 |
| --- | --- |
| `mqtt.url` | 同机默认 `mqtt://127.0.0.1:1883`；另一台主机不能仍填这个回环地址。跨主机优先配置有认证的 `mqtts`，详见配置文档 |
| `mqtt.base_topic` | 与自己的 Zigbee2MQTT 设置一致；默认 `zigbee2mqtt` |
| `device_id` | 自定义稳定 ID，例如 `light.demo` |
| `name` / `aliases` | 你对 Codex 说的名称或别名，例如“示例灯” |
| `mqtt_topic` | 该**单个设备**在 Zigbee2MQTT 中的准确 friendly_name，不包含前面的 base topic；不是组名 |
| `enabled` | 示例默认 false；仅核对自己的设备后设为 true |
| `require_availability` | 默认 true，需要在 Zigbee2MQTT 启用设备 availability；确实无法提供时，由主人理解限制后明确设 false，仍检查 bridge 并要求新鲜 state |

目前 topic 路径只接受英文字母、数字、点、下划线、连字符及合法 `/` 分段；中文可用于 `name` 和 `aliases`。不要未经核对改已有 friendly_name，它可能被其他自动化引用。完整字段、凭据和文件权限见 [详细配置](plugins/codex-home/README.md)。macOS/Linux 私有文件权限应为 0600，Windows 应限制为自己的账号。

在实际插件目录还可以运行以下只读诊断；CLI 故意不提供开关灯命令：

```sh
node src/cli.mjs check
node src/cli.mjs list
node src/cli.mjs status light.demo
```

将 `light.demo` 换成你登记的 ID。`check` 读取网关状态，`list` 读取本机白名单，`status` 向单个设备发出状态查询，不改变灯。

### 4. 先读状态，再按你的指令控制

依次对 Codex 说（名称替换成自己登记的灯）：

```text
列出 Codex Home 已登记的灯。
查询示例灯当前是开还是关。
把示例灯打开，保持开启。
把示例灯关闭。
```

只有明确开关指令才会控制设备。安装、配网说明和只读检查不意味着允许自动闪灯。首次测试请人在现场观察；工具的 `confirmed` 表示收到匹配的新鲜网关状态，不是独立光照测量。若回执不确定，先查状态，不要让模型不断重试。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `codex` 不存在或没有 plugin 子命令 | 核对 CLI 安装和版本；本项目已在 CLI `0.162.0-alpha.17.2` 验证，不保证旧版本可用 |
| 新插件没有工具 / 缺少 npm 模块 | 开新聊天；确认用仓库安装器安装过实际缓存的依赖，不是只在源码目录 npm install |
| 插件已安装，但列表为空 | `init` 创建的是空白配置，合成示例默认停用；不会自动扫描或登记你的家庭设备 |
| 网关 offline 或换 USB 后失联 | 核对原网关服务、线缆及当前串口；保留原配对数据库和密钥，不清库或盲目重配 |
| 网关 online，但设备不可用/读状态超时 | 确认灯通电、Zigbee2MQTT 前端可控、topic 正确、支持 state 查询和 availability；online 只说明网关在线 |
| `request_outcome: unknown` | 命令可能已生效，停止写入，查询状态；不要自动重试或反向“恢复” |
| 提示 marketplace 已属于其他来源 / 缓存与源码不同 | 安装器会安全停止。先核对已安装版本和来源，按诊断信息处理对应插件；不要手删整个 Codex 配置或用户数据 |

## 升级

先查看改动说明，在原克隆目录更新源码，再运行安装器：

```sh
git pull --ff-only
node scripts/install.mjs
```

有自己的源码改动时先保存，不使用强制覆盖。若同版本缓存内容不同，安装器会停止并给出处理提示。私人设备配置位于插件缓存以外，不要删除它；完成后使用新聊天。

如果此前安装的是另一个插件身份，本发布使用的新身份 `codex-home@codex-home-local` **不会自动删除那个插件或迁移其配置**。保留已有配置；需要复用兼容的完整 `config.json` 时，用 `CODEX_HOME_LIGHTS_CONFIG` 显式选择，不使用 `import-registry` 导入完整配置。明确选择一个插件负责目标灯，避免两个插件同时指向同一设备造成名称和授权混淆。发布源码与已有现场安装相互隔离，不要求你重装正在使用的环境。

## 能力与安全

- `home_list_devices`：列出已登记、启用的灯；只返回安全展示字段。
- `home_health`：只读检查网关在线状态。
- `home_status`：读取一个准确设备的新鲜状态。
- `home_set_state`：明确设置 `ON/OFF`，不使用不确定的 toggle。

先收到订阅 ACK，再发一次命令；旧 retained 缓存不作为成功证据。连接不自动重连/重放。超时可能意味着设备已改变，结果明确标记 `unknown`，必须先查状态。只读和写操作分开标注，实际审批由 Codex 执行。设备名和消息内容不是指令。

本版不支持亮度、色温、空调、门锁、插座、电机、摄像头、家庭群控、配网或任意 MQTT。请勿把高影响设备伪装成灯。保留原有手动控制和网关，不把插件当成唯一照明保障。

并发锁与未知结果保护只在一个 MCP 进程内生效，不能阻止其他会话、控制器或物理开关改变设备。工具结果中的名称、ID 和状态会进入 Codex 会话并按其数据政策处理；“本地插件”不意味着所有会话数据永不离开电脑。插件本身没有附加遥测、公共网关或后台控制计划。

## 开发与验证

```sh
cd plugins/codex-home
npm ci --ignore-scripts --no-audit --no-fund
npm test
cd ../..
node scripts/check-package.mjs
```

测试只使用合成设备/隔离 broker，不开关真实灯。端到端测试需要本机有 `mosquitto`；缺少时会明确 skip，CI 配置会安装它。请检查是否有 skip，不要把模拟测试当作真实灯控。

2026-10-13 验证记录：0.1.1 在 macOS 上以 Node 22.23.2 / 26.5.0 各通过 **51 项测试、0 skip**，包含隔离 MQTT broker 与 MCP 集成测试；发布包检查和安装器 dry-run 通过。0.1.0 的原灯控逻辑此前已由使用者现场确认实际亮灭，协调器为 SONOFF Dongle-PMG24。**0.1.1 改名包只做隔离回归，不为发布而重新操作真实灯，也未重装已有现场环境。** 这不表示目录中的候选灯泡已逐一真机验收；Linux 的现场安装与硬件验收尚未完成，Windows 安装器尚未适配。

## 发布 GitHub

本项目使用 [MIT 许可](LICENSE)。只发布项目源码，不要上传个人配置、Zigbee2MQTT data、协调器备份、日志、node_modules 或任何密钥。发布前运行包检查并审阅 `git status`；检查器不是任意秘密都能检出的保证。提交问题时只提供脱敏错误码、软件版本和非私密型号。

GitHub 源码可供别人克隆安装；这不等于进入 OpenAI 官方公共插件目录。官方公共目录有单独审核流程，本版是本地 stdio MCP 插件，不部署公共网关或公开家庭 MQTT。

实现依据：[OpenAI 插件打包规范](https://developers.openai.com/plugins/build/plugins)、[Zigbee2MQTT MQTT 协议](https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html)、[MQTT.js](https://github.com/mqttjs/MQTT.js)、[MCP server SDK](https://github.com/modelcontextprotocol/typescript-sdk)。

<a id="en"></a>

## English

**Control your own lights by asking Codex.** Codex Home runs locally, operates only on explicitly configured devices, and follows your instructions.

> v0.1.1 controls individual allowlisted lights through **your own Zigbee2MQTT + MQTT gateway**. It is not a universal smart-home gateway or an official OpenAI plugin. MIT licensed.

[Hardware guide (Chinese)](HARDWARE.md) · [Installation](#installation-and-use) · [Detailed configuration](plugins/codex-home/README.md#english) · [Security](SECURITY.md) · [简体中文](#zh-cn)

```text
Your request → Codex → local Codex Home MCP → MQTT → Zigbee2MQTT → light
```

For example: “List my configured lights,” “Check the demo light,” or “Turn the demo light off.” You choose the names in your local configuration. Repository examples are synthetic and disabled; no household devices, room names, accounts, or credentials are included.

### Is this a fit for your setup?

- **Already using Zigbee2MQTT?** Reuse your existing gateway and paired compatible lights. Do not reset a working network just to try this plugin.
- **Starting from scratch?** Begin with one compatible Zigbee bulb, one supported Zigbee coordinator, and a host computer. Test a single light before expanding.
- **Only ordinary, Wi-Fi, Bluetooth, Matter, or Thread lights?** This plugin does not directly integrate those devices or their vendor clouds. It cannot make an ordinary bulb smart by itself.
- **Only a vendor app or closed hub?** That is not the same as an existing Zigbee2MQTT setup. Moving a device may require re-pairing and affect its original ecosystem. Check before resetting anything.
- **No additional model API key is required.** The model comes from your Codex session. You still need your own Codex access; this does not make Codex usage free.

The Codex computer and MQTT/Zigbee2MQTT host must be running when you issue a command, and the light must have power. This is not an always-on cloud assistant. The gateway can run on the same computer or on your own Raspberry Pi, NAS, or another host with a secure network connection.

### Minimum hardware

| Item | Minimum | What to check |
| --- | --- | --- |
| Computer | Reuse one you own | Must run the supported Codex CLI, Node.js 22+, and the plugin. The gateway can run on this computer too. |
| Zigbee coordinator | One supported adapter | **SONOFF Dongle-PMG24** was used for the project's hardware validation. Check the complete model, not only the product-family name. |
| Zigbee bulb | One compatible bulb | **IKEA LED2201G8** and **LED2109G6** are exact-model candidates listed by Zigbee2MQTT, not individually hardware-tested combinations in this project. Availability in your region has not been confirmed. |
| Finished light fixture | One suitable lamp | Match the bulb's regional voltage, base, dimensions, and the fixture's rating. A tabletop lamp avoids any wall-wiring modification. |
| USB extension or data adapter | As needed | An extension can reduce interference. Check the coordinator package before buying another; an appropriate USB-C data adapter may be needed. |

Candidate compatibility pages: [LED2201G8](https://www.zigbee2mqtt.io/devices/LED2201G8.html), [LED2109G6](https://www.zigbee2mqtt.io/devices/LED2109G6.html). A listing is not a guarantee for every regional variant or firmware. Do not substitute a similarly named Wi-Fi or Matter product. See the [hardware guide](HARDWARE.md) for manufacturer links and buying checks.

For Dongle-PMG24, use compatible **Zigbee coordinator/NCP firmware** with `adapter: ember`; do not enable `rtscts: true`. It does not use router, Thread, or multiprotocol firmware for this setup. Match firmware and baud rate to your actual adapter and Zigbee2MQTT version; do not flash working hardware merely to install the plugin. [Zigbee2MQTT Ember adapter guide](https://www.zigbee2mqtt.io/guide/adapters/emberznet.html)

Do not modify mains wiring for a first test. Any relay installation, wall-switch wiring, or electrical work must be handled by a qualified electrician. Keep manual controls available.

### Installation and use

#### 1. Get the gateway working first

If the Zigbee2MQTT frontend already controls the intended light correctly, proceed to step 2.

Otherwise, follow the [official Zigbee2MQTT getting-started guide](https://www.zigbee2mqtt.io/guide/getting-started/) to install an MQTT broker, such as Mosquitto, and Zigbee2MQTT. Select your actual coordinator and serial path. Plugging in a USB adapter alone does not install the gateway. Do not copy someone else's serial path or let two services use one coordinator simultaneously.

Pair only the intended light using its exact-model instructions and the [official pairing guide](https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html), then close permit-join. With the owner's permission, verify a physical on/off change in the Zigbee2MQTT frontend before adding the plugin. Do not reset devices already used by another network without checking the consequences.

The light must support reading and writing `state` and report JSON with `state: ON/OFF`; its Exposes documentation should allow both state `/get` and `/set`. Prefer enabling [Device Availability](https://www.zigbee2mqtt.io/guide/configuration/device-availability.html) for that light. This plugin does not install the gateway, pair devices, or flash firmware.

#### 2. Install the plugin

Requirements:

- **macOS or Linux.** Installation and hardware acceptance have been performed on macOS. Linux field installation and hardware acceptance are not yet complete. The installer is **not adapted for Windows `.cmd` launching**; Windows runtime paths below are not a claim of supported Windows installation.
- A **Codex CLI** in `PATH` that supports `codex plugin add` and marketplace commands. The plugin can be used from Codex desktop, but this installer still requires the CLI. Install or update the CLI first if those commands are missing.
- [Node.js](https://nodejs.org/en/download) 22 or newer, with npm.
- Git, or a source ZIP downloaded using this repository's **Code → Download ZIP** menu.

With Git:

```sh
git clone https://github.com/xxwzkdwz/codex-home.git
cd codex-home
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

For a ZIP download, extract it and run the last two commands from the **repository root**, the directory containing `scripts` and `plugins`. You do not need a globally installed npm package.

The installer checks release files, registers the local marketplace `codex-home-local`, installs **`codex-home@codex-home-local`** using Codex's official commands, and installs locked npm dependencies in the **actual plugin cache**. Installation contacts the npm registry. It does not configure devices, control lights, or rewrite your entire Codex configuration.

After installation, **start a new Codex chat**; existing chats may not load newly installed tools. Keep your checkout available because the local marketplace points to it. Registering a marketplace alone does not guarantee that the runtime dependencies have been installed. [Official marketplace documentation](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)

#### 3. Configure your own gateway and light

In the new chat, ask:

> Use Codex Home to connect to my own Zigbee2MQTT gateway. Start with read-only checks; do not switch any lights.

The setup skill guides you to run `node src/cli.mjs init` in the **actual installed plugin directory**. This creates a private local configuration and never overwrites an existing file. Edit connection details locally. **Do not paste passwords, Zigbee network keys, or entire gateway configurations into chats or issues.**

Default configuration paths:

- macOS: `~/Library/Application Support/Codex Home/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/codex-home/config.json`
- Windows: `%APPDATA%/Codex Home/config.json` — runtime path only; the installer is not yet adapted for Windows.

Set **`CODEX_HOME_LIGHTS_CONFIG`** in the environment used to launch the plugin if you need a different configuration file. This dedicated plugin variable is **not Codex's own `CODEX_HOME`**; do not replace the latter. CLI diagnostics also accept `--config /absolute/path/to/config.json`; that CLI option does not configure the MCP server's environment for you.

If you already own a registry matching this project's **version 1 device-registry format**, you may use the generic import command instead of `init`:

```sh
node src/cli.mjs import-registry /absolute/path/to/your/devices.json
```

It copies only the device allowlist, does not import Zigbee network keys or modify the source, and refuses to overwrite an existing target. It is not an importer for arbitrary gateway databases. If you already ran `init`, edit that configuration or choose a new destination with `--config`; do not delete a working configuration.

`import-registry` accepts a registry containing only `version` and `devices`. **Do not import a complete `config.json` containing `mqtt` or other settings as a registry.** Preserve an existing compatible full configuration and explicitly select it with `CODEX_HOME_LIGHTS_CONFIG` instead.

Use the [synthetic example](plugins/codex-home/examples/config.example.json) as a format reference:

| Setting | Meaning |
| --- | --- |
| `mqtt.url` | Defaults to `mqtt://127.0.0.1:1883` for a broker on the same host. For another host, use its actual address and prefer authenticated `mqtts`. |
| `mqtt.base_topic` | Match your Zigbee2MQTT base topic; default is `zigbee2mqtt`. |
| `device_id` / `room_id` | Your stable lowercase IDs; use letters, digits, dots, underscores, or hyphens, e.g. `light.demo`. |
| `name` / `aliases` | Names you use in Codex, such as “Demo light.” Use an exact ID if names are ambiguous. |
| `kind` / `capabilities` | `light` and `["state"]`; do not register appliances as lights. |
| `mqtt_topic` | The exact Zigbee2MQTT friendly name of **one device**, excluding the base topic. Not a group. |
| `enabled` | Repository examples use false. Set true only after confirming the intended device. |
| `require_availability` | Defaults to true and needs device availability in Zigbee2MQTT. Only deliberately set false if it cannot be provided; bridge checks and fresh state confirmation still apply. |

Topic segments accept ASCII letters, digits, dots, underscores, hyphens, and valid `/` separators, not wildcard subscriptions or reserved control segments. Human-readable names can use other languages. Do not rename an existing friendly name without checking other automations that reference it.

For broker credentials, configure `mqtt.username_env` and `mqtt.password_env` as **environment-variable names**, not literal credentials. Alternatively, use `mqtt.password_file`; it cannot be combined with `password_env`. `mqtt.ca_file` supplies a trusted CA for a private certificate. URLs cannot contain usernames or passwords, TLS verification is not disabled, and plaintext MQTT to a non-loopback host requires an explicit `allow_insecure_lan: true` decision for a trusted LAN. Do not expose your broker publicly.

Configuration, password, and custom CA files must be owned by the current user with mode `0600` on macOS/Linux. Restrict Windows file ACLs to your account if testing the runtime there. See [detailed configuration](plugins/codex-home/README.md) for all fields and limits.

Read-only diagnostics, run from the installed plugin directory:

```sh
node src/cli.mjs check
node src/cli.mjs list
node src/cli.mjs status light.demo
```

Replace `light.demo` with your configured ID. `check` reads bridge availability, `list` reads the local allowlist, and `status` requests one device's state without changing it. The CLI intentionally has no light-switch command.

#### 4. Read first, then explicitly request control

For example, using your configured name:

```text
List the lights registered in Codex Home.
Check whether Demo light is on or off.
Turn Demo light on and leave it on.
Turn Demo light off.
```

Installing, configuring, or checking the plugin is not permission to flash a light. Stay nearby for the first control test. A `confirmed` result means the gateway sent a matching fresh state report, not that a separate light sensor proved physical illumination. If the outcome is unknown, read state instead of repeatedly issuing commands.

### Troubleshooting

| Symptom | Next step |
| --- | --- |
| `codex` is missing or has no plugin command | Check the CLI installation and version. CLI `0.162.0-alpha.17.2` was used for project validation; older versions may not work. |
| Installed plugin has no tools or missing npm modules | Open a new chat and use the repository installer to prepare dependencies in the actual cache, not only the source checkout. |
| Device list is empty | `init` creates an empty configuration and sample devices are disabled. Nothing is automatically discovered or enrolled. |
| Gateway is offline or disappeared after a USB change | Check existing services, cables, and the actual serial path. Preserve pairing databases and keys; do not reset the network. |
| Gateway is online but a light is unavailable or times out | Check light power, frontend control, its exact topic, state-query support, and availability. An online bridge does not prove a device is online. |
| `request_outcome: unknown` | The command may already have taken effect. Stop writes and query state; do not retry or automatically issue a reverse “restore” action. |
| Marketplace source conflict or cache differs from checkout | The installer stops safely. Inspect the specific plugin/source and follow its diagnostic. Never delete the entire Codex configuration or user-data directory. |

### Updating

Review changes first, then update from your existing checkout:

```sh
git pull --ff-only
node scripts/install.mjs
```

Preserve local source changes; do not force-overwrite them. If the same-version cache differs from the checkout, the installer stops with instructions. Private device configuration lives outside the plugin cache and should not be deleted. Open a new chat after updating.

If you previously installed a different plugin identity, this release's **`codex-home@codex-home-local` does not automatically remove it or migrate its settings**. Keep the existing configuration. To reuse a compatible full `config.json`, explicitly select it with `CODEX_HOME_LIGHTS_CONFIG`; do not pass a complete configuration to `import-registry`. Choose one plugin to operate the intended light to avoid confusing duplicate names or approvals. The public source package is separate from an existing field installation and does not require reinstalling a working environment.

### Tools, privacy, and safety limits

- `home_list_devices`: list configured, enabled lights using safe display fields.
- `home_health`: read gateway availability.
- `home_status`: obtain a fresh state report for one exact device.
- `home_set_state`: explicitly set `ON` or `OFF`, never an ambiguous toggle.

The transport waits for a subscription acknowledgement before sending one request. Retained cache is not accepted as confirmation. Connections do not automatically reconnect or replay commands. A timeout after a possible write is reported as `unknown`; read state before any further decision. Read and write tools have separate annotations, while actual approval is enforced by Codex. Device names and message content are data, not instructions.

Concurrency locks and unknown-outcome protection apply only within one MCP process. Other sessions, controllers, and physical switches can still change a light. Tool-result names, IDs, and states are sent into your Codex session and handled under its data policies; a local plugin does not mean all conversation data stays on the computer. The plugin itself adds no telemetry, hosted gateway, or background control schedule.

This release does not support brightness, color temperature, HVAC, locks, plugs, motors, cameras, groups, pairing, firmware flashing, or arbitrary MQTT. Never disguise a high-impact appliance as a light. Preserve manual control and the existing gateway rather than relying on this plugin as the only way to operate lighting.

### Development and validation

```sh
cd plugins/codex-home
npm ci --ignore-scripts --no-audit --no-fund
npm test
cd ../..
node scripts/check-package.mjs
```

Automated tests use synthetic devices and an isolated broker, never real household lights. End-to-end tests require a local `mosquitto`; they explicitly skip if it is missing, and CI is configured to install it. Check for skipped tests rather than treating a simulated result as hardware acceptance.

Validation on 2026-10-13: version 0.1.1 passed **51 tests with zero skips** on macOS with each of Node 22.23.2 and 26.5.0, including isolated MQTT broker and MCP integration tests. The package checker and installer dry-run also passed. A person on site previously confirmed physical on/off changes using the original 0.1.0 control logic and a SONOFF Dongle-PMG24 coordinator. **The renamed 0.1.1 package received isolated regression tests only; publishing it did not trigger another real-light test or reinstall the existing field environment.** This does not certify every candidate bulb. Linux field installation and hardware acceptance remain incomplete; the Windows installer remains unadapted.

### Publishing and contributing

The project is [MIT licensed](LICENSE). Publish source files only, not private configuration, Zigbee2MQTT data, coordinator backups, logs, `node_modules`, or secrets. Run the package checker and inspect `git status` before publishing; the checker is not a guarantee that every possible secret can be detected. Report issues using redacted error codes, software versions, and non-private model information.

Installing source from GitHub is separate from inclusion in OpenAI's official public plugin directory, which has its own review process. This project is a local stdio MCP plugin; it does not deploy a public gateway or expose household MQTT.

Implementation references: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Zigbee2MQTT MQTT protocol](https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html), [MQTT.js](https://github.com/mqttjs/MQTT.js), [MCP server SDK](https://github.com/modelcontextprotocol/typescript-sdk).

# VICO Home

**在 Codex 里说句话，控制你自己的智能灯。** 从 VICO 的本地灯控功能独立出来，无需运行 VICO 主程序。

> v0.1.0：通过你自己的 **Zigbee2MQTT + MQTT 网关** 控制已登记灯具的开关。不是所有品牌通用的智能家居网关，也不是官方 OpenAI 插件。MIT 开源。

[买什么设备](HARDWARE.md) · [安装和使用](#安装和使用) · [详细配置](plugins/vico-home/README.md) · [安全说明](SECURITY.md)

```text
你的自然语言 → Codex → VICO Home 本地 MCP → MQTT → Zigbee2MQTT → 灯
```

可以说：“列出我家的灯”“查询示例灯的状态”“把示例灯关掉”。设备名由你在本机配置；仓库只有禁用的合成示例，不含作者家的设备、房间、账号或密钥。

## 先看适不适合你

- **已有 Zigbee2MQTT 的用户：**复用现有网关和已配对的兼容灯，不用再买一套，也不要重置现有网络。
- **第一次尝试：**建议先用一只兼容 Zigbee 灯泡、一只受支持的 Zigbee USB 协调器和一台运行网关的电脑，做单灯测试。采购前读 [硬件清单及准确型号](HARDWARE.md)。
- **只有普通灯或 Wi-Fi / 蓝牙 / Matter 灯：**不能仅靠这个插件直接接入。普通灯不能凭空变智能；当前没有这些协议或厂商云的接入功能。
- **只有厂商 App 或封闭网关：**不等于已经具备 Zigbee2MQTT。迁移设备可能需要重新配对、改变原生态，请先核对，不要为了试插件清空已有家庭配置。
- **不用额外模型 API Key：**使用当前 Codex 会话的模型；仍需要你自己的 Codex 使用权限，不能据此理解为 Codex 免费。

控制时 Codex 所在电脑和 MQTT / Zigbee2MQTT 主机都要运行，灯具要通电。它不是电脑关机后仍可工作的云端助手。网关可以与 Codex 同机，也可以在你自己的树莓派、NAS 或另一台电脑上；后者需要安全的网络连接。

## 安装和使用

### 1. 先让网关能够控制灯

如果 Zigbee2MQTT 前端已经能正常开关目标灯，跳到第 2 步。

新用户先按 [Zigbee2MQTT 官方入门](https://www.zigbee2mqtt.io/guide/getting-started/) 安装 MQTT broker（如 Mosquitto）和 Zigbee2MQTT，选择实际协调器和串口。插入 USB 协调器不代表网关已经安装。不要照抄其他电脑的串口路径，也不要让两个服务同时占用同一协调器。

按目标型号的说明及 [官方配对指南](https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html) 配对**你准备接入的那只灯**，完成后关闭允许加入。先在 Zigbee2MQTT 前端实际开关一次，确认灯有响应，再接入本插件。已在别的网络配对的灯不要未经确认就重置。

VICO Home 要求该灯的 `state` 支持读取和写入，状态以 JSON 的 `state: ON/OFF` 回报；设备的 Exposes 页面应支持 state 的 `/get` 与 `/set`。优先为该灯启用 [Device Availability](https://www.zigbee2mqtt.io/guide/configuration/device-availability.html)。本插件不负责安装网关、配网或刷固件。

### 2. 安装插件

准备好：

- **macOS（已实际安装验证）或 Linux。** 当前安装脚本未适配 Windows 的 `.cmd` 启动方式，Windows 用户先不要按这套命令购买设备或承诺可用；下文 Windows 配置路径只是运行时格式说明，不代表 Windows 安装已经支持。
- 支持 `codex plugin add` 和 marketplace 命令的 **Codex CLI**。可以在 Codex 桌面端使用插件，但下面的安装脚本仍需要 CLI 在 PATH 中；没有这个命令时先完成官方 CLI 安装/更新。
- [Node.js](https://nodejs.org/en/download) 22 或更新版本，以及随附的 npm。
- Git；或从本仓库的 Code → Download ZIP 下载源码后解压。

使用 Git 的安装命令：

```sh
git clone https://github.com/xxwzkdwz/vico-home.git
cd vico-home
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

ZIP 用户在解压后的**仓库根目录**（有 `scripts` 和 `plugins` 的目录）运行后两条命令即可，不需要先有 npm 的全局包。

安装器会检查发布文件，通过 Codex 正式命令注册本地 marketplace `vico-home-local`、安装 `vico-home`，并在**实际插件缓存**中安装锁定的 npm 依赖。安装会访问 npm registry；不会配置设备或开关灯，也不会覆盖整个 Codex 配置。

安装成功后**新建一个 Codex 聊天**，旧聊天不保证热加载工具。保持克隆目录可用，本地 marketplace 指向它。只执行 marketplace add 并不保证运行依赖已经准备好，因此初次使用推荐上面的安装器。[官方 marketplace 文档](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)

### 3. 配置你自己的灯

在新聊天中说：

> 使用 VICO Home，帮我连接我自己的 Zigbee2MQTT 网关。先做只读检查，不要开关灯。

插件的 setup 技能会指导你在实际插件目录运行 `node src/cli.mjs init`，创建本机私有配置。已有文件不会被覆盖。请在自己电脑的编辑器中填写连接信息，**不要把密码、网络密钥或整个网关配置贴到聊天和 Issue 中**。

默认配置位置：

- macOS：`~/Library/Application Support/VICO Home/config.json`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/vico-home/config.json`
- Windows：`%APPDATA%/VICO Home/config.json`

在 [合成配置示例](plugins/vico-home/examples/config.example.json) 基础上，只填自己确认用于照明的设备。关键项如下：

| 项目 | 如何填写 |
| --- | --- |
| `mqtt.url` | 同机默认 `mqtt://127.0.0.1:1883`；另一台主机不能仍填这个回环地址。跨主机优先配置有认证的 `mqtts`，详见配置文档 |
| `mqtt.base_topic` | 与自己的 Zigbee2MQTT 设置一致；默认 `zigbee2mqtt` |
| `device_id` | 自定义稳定 ID，例如 `light.demo` |
| `name` / `aliases` | 你对 Codex 说的名称或别名，例如“示例灯” |
| `mqtt_topic` | 该**单个设备**在 Zigbee2MQTT 中的准确 friendly_name，不包含前面的 base topic；不是组名 |
| `enabled` | 示例默认 false；仅核对自己的设备后设为 true |
| `require_availability` | 默认 true，需要在 Zigbee2MQTT 启用设备 availability；确实无法提供时，由主人理解限制后明确设 false，仍检查 bridge 并要求新鲜 state |

目前 topic 路径只接受英文字母、数字、点、下划线、连字符及合法 `/` 分段；中文可用于 `name` 和 `aliases`。不要未经核对改已有 friendly_name，它可能被其他自动化引用。完整字段、凭据和文件权限见 [详细配置](plugins/vico-home/README.md)。macOS/Linux 私有文件权限应为 0600，Windows 应限制为自己的账号。

### 4. 先读状态，再按你的指令控制

依次对 Codex 说（名称替换成自己登记的灯）：

```text
列出 VICO Home 已登记的灯。
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

## 能力与安全

- `home_list_devices`：列出已登记、启用的灯；只返回安全展示字段。
- `home_health`：只读检查网关在线状态。
- `home_status`：读取一个准确设备的新鲜状态。
- `home_set_state`：明确设置 `ON/OFF`，不使用不确定的 toggle。

先收到订阅 ACK，再发一次命令；旧 retained 缓存不作为成功证据。连接不自动重连/重放。超时可能意味着设备已改变，结果明确标记 `unknown`，必须先查状态。只读和写操作分开标注，实际审批由 Codex 执行。设备名和消息内容不是指令。

本版不支持亮度、空调、门锁、插座、电机、摄像头、家庭群控、配网或任意 MQTT。请勿把高影响设备伪装成灯。物理开关和原 VICO 网关保持独立，不被替换。

## 开发与验证

```sh
cd plugins/vico-home
npm ci --ignore-scripts --no-audit --no-fund
npm test
cd ../..
node scripts/check-package.mjs
```

测试只使用合成设备/隔离 broker，不开关真实灯。端到端测试需要本机有 `mosquitto`；缺少时会明确 skip，CI 配置会安装它。请检查是否有 skip，不要把模拟测试当作真实灯控。

2026-10-13 验证记录：macOS 上 Node 22.23.3 / 26.5.0 各 46 项通过、0 skip；实际已安装 MCP 通过现有网关多次执行 ON/OFF，并由现场使用者确认实际亮灭正常，最后关闭。真实验证使用 SONOFF Dongle-PMG24。候选灯泡型号是否在 Zigbee2MQTT 目录中，不等于本项目逐一真机验收；Linux 的现场安装与硬件验收尚未完成，Windows 安装器尚未适配。

## 发布 GitHub

本项目使用 [MIT 许可](LICENSE)。只发布**这个独立目录**，不要上传 VICO 原项目、个人配置、Zigbee2MQTT data、协调器备份、日志、node_modules 或任何密钥。发布前运行包检查并审阅 `git status`；检查器不是任意秘密都能检出的保证。提交问题时只提供脱敏错误码、软件版本和非私密型号。

GitHub 源码可供别人克隆安装；这不等于进入 OpenAI 官方公共插件目录。官方公共目录有单独审核流程，本版是本地 stdio MCP 插件，不部署公共网关或公开家庭 MQTT。

实现依据：[OpenAI 插件打包规范](https://developers.openai.com/plugins/build/plugins)、[Zigbee2MQTT MQTT 协议](https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html)、[MQTT.js](https://github.com/mqttjs/MQTT.js)、[MCP server SDK](https://github.com/modelcontextprotocol/typescript-sdk)。

## English

VICO Home is a standalone, local Codex plugin for allowlisted Zigbee2MQTT lights: listing, gateway health, fresh state reads and owner-requested ON/OFF. You need a compatible coordinator, a paired light, your own MQTT/Zigbee2MQTT gateway, Node.js 22+ and a Codex CLI supporting plugins. The installer targets macOS/Linux; actual installation and hardware acceptance were performed on macOS. The installer is not yet adapted for Windows. No VICO Core or additional model API key is required. Clone this repository, run `node scripts/install.mjs`, start a new Codex chat and ask to set up VICO Home. Configure only your own devices locally. Unknown actions are never automatically replayed. See [hardware choices](HARDWARE.md) and [configuration](plugins/vico-home/README.md). MIT licensed; not an official OpenAI plugin.

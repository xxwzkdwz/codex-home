# macOS 原生网关路线 / Native macOS gateway route

[简体中文](#zh-cn) · [English](#en) · [README](../README.md)

<a id="zh-cn"></a>

## 简体中文

适用 Codex Home 0.1.2；资料核对：2026-10-13。**这是手工准备路线，不是一键安装器，也不是全新 Mac 的真机验收记录。** 本轮只做官方资料、代码片段与配置的静态核对，没有安装服务、配对或控制真实设备。每一步都应由设备主人检查后执行；遇到错误停在该步，不要跳过或重建网络。

### 0. 有网关就复用，不要再建一套

如果已有 Zigbee2MQTT 能控制目标灯，直接回 [插件配置](../README.md#3-配置你自己的灯)。特别是已有 Home Assistant/Zigbee2MQTT、后台服务或已配对的协调器，**不要执行以下新网络步骤**。先确认原服务位置，保留它的整个 data 目录、网络密钥和协调器备份；不要生成另一份网络配置来“修复”串口错误。

这条入门路线让三层都在同一台、由你管理且可信的 Mac 上运行：

| 层 | 作用 | 本文选择 |
| --- | --- | --- |
| MQTT broker | 在插件和网关之间传递消息，不直接使用 USB | Mosquitto，只监听 `127.0.0.1:1883` |
| Zigbee2MQTT | 连接 broker，并独占协调器串口 | 独立源码目录，原生 Node.js 进程 |
| USB 协调器 | Zigbee 无线网络接口，不是独立网关主机 | 已核对完整型号的 Dongle-PMG24，Zigbee NCP 固件 |

不是 Docker/虚拟机教程，不假定 USB 会自动穿透虚拟机。它也不是长期后台服务方案：初次测试保留两个终端，关窗口、Mac 睡眠或断电都可能中断网关。全屋部署前再单独配置、验证服务管理和恢复行为。

### 1. 先检查，不安装、不停止别人的服务

在终端做只读检查：

```sh
sw_vers
command -v node npm git brew
node --version
lsof -nP -iTCP:1883 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

缺少命令时报错是诊断结果，不必继续粘贴后面的安装命令。端口有占用时先确认所属服务；不要杀进程或把旧配置清空。无端口输出也不证明不存在远程网关或尚未启动的旧服务。装有 Homebrew 时可额外执行 `brew services list` 检查已登记服务。

本路线选择 **Node.js 24 LTS**（自带 npm）及 Git。已有兼容版本就保留；没有时由主人按 [Node.js 官方下载](https://nodejs.org/en/download)和 [Apple 命令行工具说明](https://developer.apple.com/xcode/resources/)准备，不用 `sudo npm`。Zigbee2MQTT **2.14.2** 的[版本清单](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/package.json)指定 `pnpm@11.26.0`，支持 Node 24；本文锁定该标签而非不断变化的 master。更换版本时重新核对它自己的 engines/packageManager，不能仅凭插件的 Node 22+ 要求选择网关运行时。

### 2. 新建私有目录和本机 broker

仅当你确定此前没有要复用的网关，且下列目录**尚不存在**时运行；若提示已存在，停下并检查，不删除：

```sh
mkdir -m 700 "$HOME/Library/Application Support/Codex Home Gateway"
```

以下命令会安装软件，**不是只读检查**。只有缺少 Mosquitto 时，由主人检查 [Homebrew 官方安装说明](https://brew.sh/)和 [Mosquitto 公式](https://formulae.brew.sh/formula/mosquitto)后选择执行；不要重装已正常工作的 broker：

```sh
brew install mosquitto
```

在本机编辑器中新建 `~/Library/Application Support/Codex Home Gateway/mosquitto.conf`，只放以下内容，不编辑 Homebrew 或已有网关的配置：

```conf
listener 1883 127.0.0.1
allow_anonymous true
persistence false
```

这是**仅本机、单用户可信电脑**的初次测试设置；本机其他进程也能连接，不是用户级访问控制。不要将地址改成 `0.0.0.0`、做端口映射或暴露公网。共享电脑、跨主机和长期部署应先按 [Mosquitto 文档](https://mosquitto.org/man/mosquitto-conf-5.html)配置认证、最小权限和必要的 TLS，再配置插件凭据。

选定文件后收紧权限，并在终端 A 前台启动你新建的 broker：

```sh
chmod 600 "$HOME/Library/Application Support/Codex Home Gateway/mosquitto.conf"
"$(brew --prefix mosquitto)/sbin/mosquitto" -c "$HOME/Library/Application Support/Codex Home Gateway/mosquitto.conf"
```

另一个终端用 `lsof -nP -iTCP:1883 -sTCP:LISTEN` 确认只监听 `127.0.0.1`。端口占用则停下；不要再运行 `brew services start mosquitto` 产生第二实例。本例不持久化 broker 缓存，broker 重启后应重启**这次新建的** Zigbee2MQTT 让它重新发布网关/设备在线信息。

### 3. 获取固定版本 Zigbee2MQTT

在终端 B 中运行。clone 的目的目录必须不存在；以下步骤下载源码及 npm 依赖，不会自动安装系统后台服务：

```sh
cd "$HOME/Library/Application Support/Codex Home Gateway"
git clone --branch 2.14.2 --depth 1 https://github.com/Koenkk/zigbee2mqtt.git zigbee2mqtt
cd zigbee2mqtt
node --version
npx --yes pnpm@11.26.0 install --frozen-lockfile
```

确认 Node 为你选择的 24.x。不要把 Codex Home 插件目录当作 Zigbee2MQTT 目录；二者锁文件、配置和依赖独立。若安装报原生构建工具缺失，先处理 Apple Command Line Tools；不要使用关闭校验、删除锁文件或强行忽略 engines 的办法继续。安装方式参考 [Zigbee2MQTT 原生安装](https://www.zigbee2mqtt.io/guide/installation/01_linux.html)，**其中的 apt/systemd/Linux 串口命令不适用于 macOS**。

### 4. 确认串口，在新网络中配置协调器

通过延长线连接协调器，按 [SONOFF macOS 连接指南](https://dongle.sonoff.tech/guide/dongle-pmg24/connecting_to_the_operating_system/)检查驱动与设备识别。可读地列出串口：

```sh
ls /dev/cu.*
```

把插拔前后差异与系统信息中的完整产品型号对照，不能随意选 Bluetooth 串口。确认它没有被其他 Zigbee2MQTT/ZHA/串口工具占用。使用正确的 Zigbee Coordinator/NCP 固件；**PMG24 使用 `adapter: ember`、`rtscts: false`**，波特率按实际固件核对，不为了试插件刷固件。[Ember 官方说明](https://www.zigbee2mqtt.io/guide/adapters/emberznet.html)

仅在**全新协调器/全新网络**中，在编辑器里新建这次 clone 下的 `data/configuration.yaml`。使用下列示例，必须先替换串口；`baudrate: 115200` 只是需要核对的起始值，固件若不同则改为对应值。若该文件已经存在，或协调器已有网络，立即停止，不覆盖：

```yaml
version: 5
mqtt:
  server: mqtt://127.0.0.1:1883
  base_topic: zigbee2mqtt
serial:
  port: /dev/cu.REPLACE_WITH_YOUR_ADAPTER
  adapter: ember
  baudrate: 115200
  rtscts: false
frontend:
  enabled: true
  host: 127.0.0.1
  port: 8080
homeassistant:
  enabled: false
advanced:
  network_key: GENERATE
  pan_id: GENERATE
  ext_pan_id: GENERATE
```

示例依据该版本的[默认配置](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/data/configuration.example.yaml)、[前端绑定配置](https://www.zigbee2mqtt.io/guide/configuration/frontend.html)和[网络配置](https://www.zigbee2mqtt.io/guide/configuration/zigbee-network.html)。`GENERATE` 用于首次生成新网络，**不是维修现有网络的选项**。生成后保留写回的实际值，不重复替换；network key、data 目录和协调器备份都不能发聊天、Issue 或 GitHub。

仍在新 clone 的根目录，从终端 B 启动：

```sh
chmod 600 data/configuration.yaml
npx --yes pnpm@11.26.0 start
```

看到 MQTT 已连接、协调器已启动后，打开 [本机前端](http://127.0.0.1:8080)。另一个终端用 `lsof -nP -iTCP:8080 -sTCP:LISTEN` 确认前端也只监听本机。启动失败先检查错误对应的端口、驱动、固件/波特率；不要删除 data 或重建网络。分享错误时只提供脱敏错误码和版本，不粘整段日志。

### 5. 只配一盏灯，启用该灯 availability

使用匹配的成品台灯和精确型号 Zigbee 灯泡，**不接普通调光器、不拆市电线路**。只在主人要配对这只灯时打开 Permit join，按该型号说明配对，完成后立即关闭；不要重置其他已工作的灯。[配对说明](https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html)

先在 Zigbee2MQTT 中确认该灯的 state 可读写，按主人明确指令进行一次现场开关验收。为这只灯启用 availability；前端可配置时优先在该设备设置里开启。手工编辑时先停止本次新建的 Zigbee2MQTT 并保存本机备份，**只在现有设备条目内添加 `availability: true`**，不要替换整个文件或另造设备地址：

```yaml
devices:
  'REPLACE_WITH_EXISTING_DEVICE_IEEE_ADDRESS':
    friendly_name: demo-light
    availability: true
```

上面是结构说明，不是可原样粘贴的地址。保留已有其他设备字段/条目；已有 friendly_name 被其他自动化引用时不要改名。只有目标灯启用的方式见 [官方 availability 文档](https://www.zigbee2mqtt.io/guide/configuration/device-availability.html)。重启同一个实例后确认设备在线；不要用插件 `require_availability: false` 掩盖尚未配置的问题。

<a id="reporting-zh"></a>

#### 同一只灯的关联读取前提

availability 只说明在线判定。普通 state 可能包含缓存、乐观状态或群组推测，非 retained 消息也不能独立确认设备执行。Codex Home 0.1.2 默认 `state_confirmation: "unverified"`，只读 `/get` 回报不能解除未知结果保护；控制返回 `STATE_CONFIRMATION_REQUIRED` / `not_sent`。

关联读取仅适用于支持默认端点 `genOnOff/onOff` 的单通道灯；不支持群组、多通道和自定义端点。在主人选择的维护时机，按运行版本的[单设备选项](https://www.zigbee2mqtt.io/guide/configuration/devices-groups.html)核对目标灯设置。下面仍是**现有单设备条目的局部示意**：

```yaml
devices:
  'REPLACE_WITH_EXISTING_DEVICE_IEEE_ADDRESS':
    friendly_name: demo-light
    availability: true
    optimistic: true
    filtered_cache:
      - '^codex_home_read_.*$'
```

已有 `filtered_cache` 时合并该规则，避免随机读取字段在缓存中不断累积，同时保留原规则。`optimistic: true` 是默认值；**不要改为 false**，因为上游也通过这一通道发布通用读取的实际结果，关闭会导致超时。`filtered_attributes` / `filtered_optimistic` 不能过滤 `codex_home_read_...` 字段；网关 `mqtt.output` 必须为 `json`（默认）或 `attribute_and_json`。不覆盖其他设备或字段，不全局关闭 `cache_state`，不删除状态文件、配对数据库或密钥。插件不接受普通 state 作为确认，因此无需为了本插件清除旧 state 缓存。

主人核对后，按下一节安装并配置插件，在**插件自己的 JSON**中为该灯选择 `state_confirmation: "correlated_read"`（不是 Zigbee2MQTT YAML 字段）。然后在实际插件目录先运行 `node src/cli.mjs status light.demo`，ID 替换为自己的登记。虽然通过 MQTT `/set` 包装，负载只允许固定的 **read genOnOff/onOff**，不会开关；每次附带新的 `codex_home_read_<32hex>` 随机字段，只接受这个字段对应的 ZCL 实际读取结果，不接受普通 state。MQTT 权限须允许这个读取所需的 `/set` topic。没有关联读回就停下；不要用开关动作诊断，不自动更改网关，不把 setup 当开关授权。

控制模式只发一次 ON/OFF，普通匹配 state 只触发一次关联读取，读回错误值为 `STATE_MISMATCH` / `unknown`，超时为 `unknown`，均不重发。`confirmed` 表示当前设备开关位的关联读回满足条件，不是光照测量，也不证明命令唯一因果。依据为 [Zigbee2MQTT 2.14.2](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/publish.ts)及 [converter 26.115.1](https://github.com/Koenkk/zigbee-herdsman-converters/blob/v26.115.1/src/converters/toZigbee.ts) 的源码核对；**新协议仅做隔离模拟验证，尚未真灯验收**，旧版本的物理开关成功不能替代它。现场首次控制仍需主人明确指令和观察。

### 6. 最后接入插件，保留人工控制

回 [Codex Home 安装与配置](../README.md#安装和使用)：本机 broker 填 `mqtt://127.0.0.1:1883`，base topic 与上文相同，设备 mqtt_topic 填自己那只灯的准确 friendly_name。先 `check` / `list` / `status`，满足关联读取前提后由主人明确提出开/关。插件配置与 Zigbee2MQTT 的 YAML 完全不同，不能互相覆盖或直接当注册表导入。

退出本次试用时，在各自前台终端按 Ctrl-C；这会中断这些服务，不会自动关灯，也不应删除网络数据。之后要继续使用，就启动同一套配置和同一个实例。保留物理开关；长期使用前另行验证自动启动、睡眠唤醒、断电恢复及本机访问控制。

<a id="en"></a>

## English

For Codex Home 0.1.2; sources checked on 2026-10-13. **This is a manual setup route, not a one-click installer or a clean-Mac hardware acceptance record.** The work behind this document was limited to official-source and static checks; it did not install services, pair devices, or switch real lights. The owner should review each step and stop on an error.

### 0. Reuse a working gateway first

If your existing Zigbee2MQTT already controls the intended light, go directly to [plugin configuration](../README.md#3-configure-your-own-gateway-and-light). **Do not follow the new-network steps below** for an already paired coordinator, an existing Zigbee2MQTT/Home Assistant deployment, or a background gateway. Find the original service and preserve its entire data directory, network keys, and coordinator backup.

This route uses one trusted, owner-managed Mac: **Mosquitto** carries MQTT messages on loopback, **Zigbee2MQTT** connects to it and exclusively owns the serial port, and the **USB coordinator** provides Zigbee radio access. USB power alone is not a gateway. This is native Node.js, not a Docker/VM USB-passthrough guide, and not an always-running service setup. Keep both foreground terminals open during the first test; sleeping or powering off the Mac can interrupt the gateway.

### 1. Check the existing environment

Run the read-only commands in [step 1 above](#1-先检查不安装不停止别人的服务): OS and command versions, and listeners on ports 1883/8080. Missing tools are a reason to stop and prepare them, not to paste every remaining command. Investigate occupied ports without killing services. An unused port does not rule out an old, stopped, or remote gateway. If installed, `brew services list` helps identify registered Homebrew services.

Choose **Node.js 24 LTS** with npm and Git, using [Node.js downloads](https://nodejs.org/en/download) and [Apple command-line tools](https://developer.apple.com/xcode/resources/) if needed. Keep compatible existing installations. This guide pins [Zigbee2MQTT 2.14.2](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/package.json), whose package manager is `pnpm@11.26.0` and whose Node range includes 24. Recheck both requirements before choosing a different release; the plugin's Node 22+ requirement does not describe all gateway versions. Do not use `sudo npm`.

### 2. Prepare a separate loopback-only broker

Only for a new environment, create the new private directory using the `mkdir` command in [step 2 above](#2-新建私有目录和本机-broker). It deliberately fails if the directory exists: inspect rather than delete it. If Mosquitto is absent, the owner may install it with `brew install mosquitto` after reviewing [Homebrew](https://brew.sh/) and the [official formula](https://formulae.brew.sh/formula/mosquitto). This is a software installation, not a read-only check.

Create `~/Library/Application Support/Codex Home Gateway/mosquitto.conf` in a local editor using the shared `conf` block above. It listens only on `127.0.0.1:1883`, allows local anonymous connections, and disables persistence for the initial test. **Any local process can connect.** Do not expose it to your LAN or the Internet. Shared computers, cross-host access, and longer-term deployments require separately configured authentication, least-privilege access, and TLS where appropriate; see the [Mosquitto manual](https://mosquitto.org/man/mosquitto-conf-5.html).

Use the matching `chmod` and foreground `mosquitto -c` commands above in terminal A. Confirm the listener is loopback-only with `lsof`. Do not also run `brew services start mosquitto` or launch a duplicate broker. If this nonpersistent broker is restarted, restart **this newly created** Zigbee2MQTT instance so it republishes availability.

### 3. Download the pinned gateway source

Run the exact clone/install block in [step 3 above](#3-获取固定版本-zigbee2mqtt) in terminal B. Verify Node 24.x first. It creates a separate `zigbee2mqtt` checkout and downloads dependencies using `npx --yes pnpm@11.26.0 install --frozen-lockfile`. Do not run these commands inside the Codex Home plugin directory. Resolve missing Apple build tools if installation fails; do not remove the lockfile or bypass engine checks. The upstream [native installation guide](https://www.zigbee2mqtt.io/guide/installation/01_linux.html) describes the sequence, but its apt/systemd/Linux serial commands are not macOS instructions.

### 4. Identify the coordinator and create only a new network

Connect the adapter using the extension cable. Follow [SONOFF's macOS driver/identification guide](https://dongle.sonoff.tech/guide/dongle-pmg24/connecting_to_the_operating_system/), compare `ls /dev/cu.*` before/after connection, and confirm the full product identity in System Information. Do not choose a Bluetooth port or compete with another Zigbee2MQTT/ZHA/serial process.

For **Dongle-PMG24**, use Zigbee Coordinator/NCP firmware, `adapter: ember`, and `rtscts: false`; baud rate must match its actual firmware. Do not flash working hardware just to install this plugin. [Official Ember guidance](https://www.zigbee2mqtt.io/guide/adapters/emberznet.html)

For a **new coordinator/network only**, create `data/configuration.yaml` inside this checkout using the complete YAML example in [step 4 above](#4-确认串口在新网络中配置协调器). Replace the placeholder serial port before starting. The shown `115200` baud rate must be checked against your firmware. Stop if the file or an existing network already exists; never overwrite it. The example binds the frontend to loopback and uses `GENERATE` for the initial network identifiers/key, following the [release's example](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/data/configuration.example.yaml), [frontend settings](https://www.zigbee2mqtt.io/guide/configuration/frontend.html), and [network settings](https://www.zigbee2mqtt.io/guide/configuration/zigbee-network.html). **GENERATE is not a repair setting for an existing network.** Preserve the generated values and keep all keys/data/backups private.

Still in the new checkout, use `chmod 600 data/configuration.yaml` and `npx --yes pnpm@11.26.0 start` in terminal B. After MQTT and the coordinator are ready, open [the loopback frontend](http://127.0.0.1:8080) and verify its listener with `lsof`. A startup failure calls for diagnosis, not deleting data or recreating the network. Share only redacted error codes and versions, not full logs.

### 5. Pair one light and enable its availability

Use a matching finished lamp **without a standard dimmer**; do not modify mains wiring. Enable Permit join only while the owner is pairing that exact light and close it afterwards. Do not reset other working devices. Follow the model-specific and [official pairing instructions](https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html), then verify state read/write support and an owner-authorized physical on/off test in the frontend.

Enable availability for that individual light in its frontend settings. For a manual edit, stop only this new gateway and preserve a local backup, then add `availability: true` inside the **existing device entry**. The partial YAML in [step 5 above](#5-只配一盏灯启用该灯-availability) is structural: replace its placeholder with the existing device address; do not invent an address, duplicate the top-level `devices`, or replace other settings. Preserve friendly names referenced by other automations. Restart the same instance and verify it is online. See [per-device availability](https://www.zigbee2mqtt.io/guide/configuration/device-availability.html); do not disable the plugin's check merely to hide an unfinished setup.

<a id="reporting-en"></a>

#### Correlated-read prerequisite for the same light

Availability is not execution evidence. Ordinary state can contain cache, optimistic updates, or group inference, even in non-retained MQTT messages. Codex Home 0.1.2 defaults to `state_confirmation: "unverified"`: `/get` reports remain readable but do not clear unknown-outcome protection; control returns `STATE_CONFIRMATION_REQUIRED` / `not_sent`.

Correlated mode supports only a single-channel light with `genOnOff/onOff` on its default endpoint, not groups, multiple channels, or custom endpoints. During an owner-selected maintenance window, review the running version's [per-device settings](https://www.zigbee2mqtt.io/guide/configuration/devices-groups.html). The [shared YAML example](#reporting-zh) keeps `optimistic: true` (the default) and adds `'^codex_home_read_.*$'` to **this light's** `filtered_cache`. Merge rather than replace rules; this prevents dynamic read fields from accumulating. **Do not set optimistic false:** upstream publishes actual generic-read results through that channel too, so disabling it causes a timeout. Neither `filtered_attributes` nor `filtered_optimistic` may filter the `codex_home_read_...` fields. The gateway's `mqtt.output` must be `json` (default) or `attribute_and_json`. Preserve other settings, never disable global `cache_state`, and never delete pairing data, state files, or keys. Ordinary state is not accepted as confirmation, so this plugin does not require clearing old state cache.

After checking, install and configure the plugin as described in the next section. The owner selects `state_confirmation: "correlated_read"` in the **plugin's JSON**, not Zigbee2MQTT YAML, and first runs `node src/cli.mjs status light.demo` from the actual plugin directory with the correct ID. This read-only preflight wraps a fixed **read genOnOff/onOff** in `/set`; it does not switch the light. A new random `codex_home_read_<32hex>` field correlates each query with its actual ZCL read result. Ordinary state cannot confirm it. MQTT ACLs must permit the `/set` topic required by this fixed read. If no correlated reply arrives, stop instead of switching for diagnosis or changing gateway settings automatically. Setup is not switching authorization.

Control sends ON/OFF once; an ordinary matching state only triggers one correlated read. A wrong readback yields `STATE_MISMATCH` / `unknown`; timeout yields `unknown`, without replay. `confirmed` means the current device on/off bit met the correlated read condition, not measured illumination or proof of unique command causality. The source-reviewed implementations are [Zigbee2MQTT 2.14.2](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/publish.ts) and [converter 26.115.1](https://github.com/Koenkk/zigbee-herdsman-converters/blob/v26.115.1/src/converters/toZigbee.ts). **The new protocol has isolated simulation only, not hardware acceptance.** Older physical switching tests do not validate it; first live control still needs an explicit owner request and observation.

### 6. Connect Codex Home last

Return to [installation and configuration](../README.md#installation-and-use). For this same-Mac example, use broker `mqtt://127.0.0.1:1883`, base topic `zigbee2mqtt`, and the intended light's exact friendly name. Start with `check`, `list`, and `status`; switching requires both the correlated-read prerequisite and the owner's explicit request. The plugin's JSON and Zigbee2MQTT's YAML are different formats, not interchangeable registry imports.

To end this foreground test, press Ctrl-C in each service's own terminal. That interrupts those services; it does not switch the light off or justify deleting network data. Reuse the same configuration and one instance next time. Keep physical controls available. Validate startup, sleep/wake, power-loss recovery, and local access controls separately before relying on a long-running deployment.

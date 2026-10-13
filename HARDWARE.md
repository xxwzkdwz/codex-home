# 买什么设备，才能用 Codex 控制灯？

资料核对日期：2026-10-13。适用于 Codex Home v0.1.1。

**最小入门组合：已有电脑 + 1 个 Zigbee USB 协调器 + 1 只兼容 Zigbee 灯泡 + 合适的成品台灯。** 先验证一盏灯，不需要一开始改造全屋。

原灯控逻辑的实际安装与现场 ON/OFF 验收平台是 **macOS**；0.1.1 改名包只做隔离回归，不为发布重新控制真实灯或重装已有环境。安装脚本面向 macOS/Linux，Linux 现场安装与硬件尚未验收；Windows 安装器尚未适配，不要把 Zigbee2MQTT 自身支持 Windows 理解成本插件也已支持完整 Windows 安装。

本插件只接入你自己的 **Zigbee2MQTT + MQTT**，目前支持查状态、开灯和关灯。即使灯泡本身支持调光、色温或彩色，本版也只使用 `ON/OFF`。不直接支持 Wi-Fi 灯、蓝牙灯、Matter/Thread 灯或厂商私有网关；包装上只写“智能”“支持某语音助手”，不代表兼容。

## 1. 最小采购清单

| 物品 | 数量 | 怎么选 |
| --- | --- | --- |
| 运行 Codex 的电脑 | 已有的 1 台 | 安装本插件需要 Node.js 22+ 和支持本地插件的 Codex。入门可把 MQTT、Zigbee2MQTT 也放在这台电脑上；使用时电脑和网关服务需保持运行。不要仅为试灯先买新电脑。 |
| Zigbee USB 协调器 | 1 个 | 可选下文的 **SONOFF Dongle-PMG24**；下单核对完整型号，不能只看“SONOFF Dongle Plus”。 |
| Zigbee 灯泡 | 1 只 | 从下文精确型号候选中选一个，并核对本地区电压、灯头、尺寸和当地合规要求。 |
| 成品灯具 | 已有的 1 盏 | 使用与灯泡匹配、完好且符合额定功率要求的成品台灯；无需打开墙壁开关或自行接线。 |
| USB 延长线/转接头 | 按需 | 协调器离开电脑机身和 USB 3.x 设备有助于减少干扰。PMG24 官方包装清单含 1 米 USB 延长线，先确认卖家套装内容，避免重复买。只有 USB-C 接口的电脑还需合适的数据转接头。 |
| 单独网关主机及电源 | 可选，不是入门必买 | 想让网关长期独立运行，可用已有小主机或树莓派，并按主机厂商要求供电。只给 USB 协调器接充电器，不会自动变成可用的 Zigbee2MQTT 网关。 |

Zigbee2MQTT 官方入门要求是主机、MQTT broker、协调器和 Zigbee 终端；支持多种主机平台，并建议使用 USB 延长线。Node.js 22+ 是本插件自身的要求，不等于对所有平台完成了真机验收。[Zigbee2MQTT 入门](https://www.zigbee2mqtt.io/guide/getting-started/)、[SONOFF 包装清单](https://dongle.sonoff.tech/guide/dongle-pmg24/introduction-dongle-pmg24/)

本文不提供价格或库存承诺；以当地官方或正规渠道的**精确型号及实物铭牌**为准。

## 2. 协调器：本项目用过的型号

**SONOFF Dongle-PMG24（Dongle Plus MG24）** 是本项目真机使用过的协调器型号；不是对 SONOFF 全系列的兼容承诺。其 Zigbee 芯片为 EFR32MG24，USB 串口桥为 CP2102(N)。USB 主机既负责通信也提供电源；厂商标注输入为 5V DC / 500mA。[SONOFF 硬件规格](https://dongle.sonoff.tech/guide/dongle-pmg24/hardware-specification-dongle-pmg24/)

选择和设置时注意：

- 使用 **Zigbee Coordinator / Zigbee NCP** 固件。不要把唯一协调器刷成 Zigbee Router、OpenThread RCP 或多协议固件；“能刷多种固件”不表示这些固件都能用于本插件链路。[SONOFF 支持的固件](https://dongle.sonoff.tech/guide/dongle-pmg24/supported_firmware/)
- Zigbee2MQTT 对该型号使用 `adapter: ember`，只支持软件流控，**不要设置 `rtscts: true`**。旧 `ezsp` 适配器已弃用；当前 Ember 文档不支持多协议固件。[Zigbee2MQTT Ember 支持页](https://www.zigbee2mqtt.io/guide/adapters/emberznet.html)
- 固件版本和波特率必须与实际硬件、所刷固件及正在运行的 Zigbee2MQTT 版本匹配。不要直接抄别人串口号或波特率；官方烧录工具提供多种波特率固件，并非都一样。[SONOFF 固件工具与参数](https://dongle.sonoff.tech/sonoff-dongle-flasher/)
- 已能正常工作的协调器不必为了安装插件而刷固件。必须升级时，先按官方说明备份原 Zigbee 网络，确认硬件型号与固件用途，再操作。插件安装器不会刷机、重置或重新配网。
- 更换 USB 插口后，系统串口路径可能变化。先检查系统识别到的产品与串口，再修正对应路径；不要因找不到串口而重建整个 Zigbee 网络。驱动要求见厂商的[操作系统连接指南入口](https://dongle.sonoff.tech/guide/dongle-pmg24/getting-started/)。

如果已经有正常运行的 Zigbee2MQTT 和受支持的协调器，通常无需为了本插件另买 PMG24。保留原网关，先核对它能查询并控制目标灯。

## 3. 灯泡：两个精确型号候选

以下是 **Zigbee2MQTT 官方兼容目录列出的候选**，不是本项目已购买或组合实测的灯泡。两页均列出了 `state` 的读取及设置能力；本插件仍需在你的实际网关、灯泡固件和网络上验收。

| 精确型号 | 目录中的产品类型 | 购买前怎么核对 |
| --- | --- | --- |
| **IKEA TRÅDFRI LED2201G8** | E26/E27、白光光谱灯泡 | 核对铭牌 `LED2201G8`，不要只搜“TRÅDFRI 白灯”。[Zigbee2MQTT 型号页](https://www.zigbee2mqtt.io/devices/LED2201G8.html) |
| **IKEA TRÅDFRI LED2109G6** | E26/E27、彩色/白光光谱灯泡 | 核对铭牌 `LED2109G6`；本插件目前不会使用其彩色或调光能力。[Zigbee2MQTT 型号页](https://www.zigbee2mqtt.io/devices/LED2109G6.html) |

目录出现 E26/E27 等地区变体，**不代表不同灯头、电压版本可以互换**。本页没有确认这些型号在你的地区仍有库存；如买不到，先在[Zigbee2MQTT 设备目录](https://www.zigbee2mqtt.io/supported-devices/)查询替代品的完整型号，确认 `light` 下有可读、可写的 `state`，再购买一只试用。不要把同品牌的新款、Wi-Fi 款或 Matter 款当成同一款。

LED2201G8 的[厂商说明书](https://www.ikea.com/rs/sr/manuals/tradfri-led-sijalica-e27-1055-lm-pametno-bezicno-podesavanje-intenziteta-beli-spektar-kugla__AA-2392150-4-2.pdf)明确提示不要接普通调光器。使用相应地区、型号的原厂说明书核对灯具要求；Zigbee2MQTT 的兼容记录不是厂商对第三方平台的保修承诺。

## 4. 买回来后，按这个顺序接通

1. 先按[Zigbee2MQTT 官方入门](https://www.zigbee2mqtt.io/guide/getting-started/)建立自己的 MQTT 和 Zigbee2MQTT 服务，确认协调器在线；本插件不是这些服务的替代品。
2. 将第一只灯泡装进匹配的成品灯具，按该**精确型号**的说明配对到自己的 Zigbee2MQTT。只在明确配对时开放加入，完成后关闭；不要重置已经工作的其他设备。
3. 先在 Zigbee2MQTT 中验证这一盏灯能读取状态，并在你允许时完成一次开关测试。插件默认还要求设备 availability；按[官方 availability 说明](https://www.zigbee2mqtt.io/guide/configuration/device-availability.html)为该设备启用，而不是为消除错误就跳过在线检查。
4. 回到 [安装说明](README.md)安装 Codex Home，按[本机配置说明](plugins/codex-home/README.md)把**自己的**网关和灯加入白名单。不要上传配置、网络密钥、日志或协调器备份到 GitHub。
5. 在 Codex 先说“检查家庭网关”“列出已配置的灯”“查询示例灯状态”。确认目标后，再明确要求“打开示例灯”；把“示例灯”替换为你自己设置的唯一名称。

出现 `unknown` 只代表请求结果尚未确认，不代表一定没执行。先查状态，不让助手反复开关。工具确认的是网关的新鲜状态回报，不能代替人在现场确认灯确实亮了或灭了。

## 5. 安全边界

- 购买前核对当地供电电压、灯头、灯具额定功率及产品合规标识；不要仅凭外观、转换灯头或商品标题判断适配。
- 入门选成品灯具和可更换灯泡，不需要购买墙壁继电器。**不要为了试用插件自行拆墙壁开关、调整市电线路或短接线头；涉及接线必须交给合格电工。**
- 保留原有手动控制方式。智能灯断电后无法接收无线指令；电脑、网关或 Codex 不可用时，不能依赖本插件作为唯一照明控制手段。
- 当前范围仅是明确登记的灯光开关，不把插座、加热器、电机、门锁、燃气或其他高影响设备伪装成“灯”。

本页只记录通用商品型号与公开来源，不包含任何个人住宅的设备标识、房间、地址、密钥或配置。

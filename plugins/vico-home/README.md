# VICO Home runtime

独立的 Codex 智能灯插件，当前只支持已登记 Zigbee2MQTT 灯的 `ON/OFF`。不依赖 VICO App、VICO Core、Python、Home Assistant Server 或额外模型 API Key；Home Assistant 用户可以复用自己的 Zigbee2MQTT。

## 本机配置

需要 Node.js 22+。在**实际安装的插件目录**运行：

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node src/cli.mjs init
```

命令打印本机配置路径，不打印凭据。默认路径：

- macOS：`~/Library/Application Support/VICO Home/config.json`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/vico-home/config.json`
- Windows：`%APPDATA%/VICO Home/config.json`

环境变量 `VICO_HOME_CONFIG` 可指定已有配置；CLI 也支持 `--config <路径>`。配置变更在下一次工具调用加载。`init` 和 `import-vico` 都不会覆盖已有文件。

已有 VICO 用户可以**自行明确指定**原注册表，将它复制为独立配置：

```sh
node src/cli.mjs import-vico /absolute/path/to/your/devices.json
```

该操作只复制设备白名单，不修改原文件、不读取 Zigbee 网络密钥。不要将生成的私人配置加入本仓库。

在自己的编辑器中参照 [合成示例](examples/config.example.json) 编辑配置。示例设备默认禁用。只登记你确认用于照明的单个设备，不填 groups 或用于电器的智能插座。

| 字段 | 含义 |
| --- | --- |
| `version` | 固定 `1` |
| `mqtt.url` | 默认 `mqtt://127.0.0.1:1883`，不接受内嵌用户名密码、query 或 fragment |
| `mqtt.base_topic` | 默认 `zigbee2mqtt`，支持安全的多级 topic |
| `mqtt.timeout_ms` | 单次操作总超时，1000–30000，默认 8000 |
| `mqtt.username_env` / `password_env` | 从你在 Codex 启动环境中设置的环境变量读取凭据 |
| `mqtt.password_file` | 或从配置目录相对路径/绝对路径的私密文件读密码，不能同时设置 `password_env` |
| `mqtt.ca_file` | 自签证书的受信任 CA 文件；不关闭 TLS 校验 |
| `mqtt.allow_insecure_lan` | 默认为 false；非本机明文 MQTT 必须明确设置 true，仅用于你信任的局域网 |
| `devices[].device_id` / `room_id` | 稳定的小写英文 ID，允许数字、点、下划线和连字符 |
| `name` / `aliases` | 展示名称及别名；重名必须用精确 ID 消歧 |
| `kind` / `capabilities` | 固定 `light` / `["state"]` |
| `mqtt_topic` | 已有 Zigbee2MQTT friendly_name，不含 base_topic；不允许通配符或 `bridge/get/set/availability` 保留段 |
| `enabled` | 默认 true；停用后不会列出或控制 |
| `require_availability` | 默认 true；对应 Zigbee2MQTT 已启用设备 availability。若设备没有该功能，由主人明确设 false；仍检查 bridge 状态并要求新鲜 state |

macOS/Linux 的配置、密码和自定义 CA 文件必须是当前用户拥有的普通文件、权限 0600；可对**选定文件**执行 `chmod 600 <文件>`。Windows 上请用文件 ACL 限制为自己的账号。不要把真实密码放命令行参数或聊天里。

## 检查

```sh
node src/cli.mjs check
node src/cli.mjs list
node src/cli.mjs status light.demo
```

`check` 只读 bridge 状态。`list` 只读本机白名单。`status` 发 `/get` 查询，不改变灯。CLI 不提供开关命令；控制通过 Codex 的 `home_set_state`，受宿主授权规则约束。

桥接离线或 USB 协调器未识别时，先检查已有网关与线缆，不要清库/重新配网。`request_outcome: unknown` 表示命令可能已经生效，先读状态，不重试或擅自恢复原状态。

## 数据与边界

MCP 工具只返回展示名称、ID、状态、时间和固定错误，不返回 MQTT topic、地址或凭据。Codex 会接收这些工具结果并按其数据政策处理；不能宣传为所有数据都不离开电脑。插件本身不附加遥测、托管云服务、模型请求或后台计划。

非 retained 新鲜网关回报才可确认状态；Zigbee2MQTT 没有本插件可用的逐命令关联 ID，不能当作物理光照传感器或唯一因果证据。锁定和未知结果保护仅限一个 MCP 进程；多个 Codex 会话/其他控制器仍可同时影响设备。

不支持门锁、加热、燃气、电机、摄像头、批量群控、亮度/色温、任意 MQTT、配网、OTA 或固件升级。安装插件不等于配好了 Zigbee 网关；它不兼容所有品牌的私有云接口。

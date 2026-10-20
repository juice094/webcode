# 手动安装浏览器桥接：来源 / 解压 / 加载位置约定

适用场景：通过 `chrome://extensions` 开发者模式「加载已解压的扩展程序」手动安装桥接，
不使用 VS Code 托管的隔离浏览器。此模式下 Chrome 禁止扩展自我更新，必须按本约定手动同步。

## 三个固定要素

| 要素 | 位置 |
|------|------|
| **来源**（新构建压缩包） | 本仓库 `release/webcode-bridge-browser-<版本>.zip`；GitHub Release（juice094/webcode）附同名资产 |
| **解压/同步目标**（唯一真相文件夹） | 仓库根下 `dist/manual-bridge/`（版本中性固定路径，已 gitignore） |
| **加载位置**（Chrome 注册路径） | `chrome://extensions` → 加载已解压的扩展程序 → 选择上述 `dist/manual-bridge` 文件夹，**一次性** |

## 每次发版后的更新步骤

1. 同步新构建到固定文件夹（二选一）：
   - 一键：`powershell -File update-manual-bridge.ps1`（自动取 `release\` 下最新 zip）；
   - 手动：解压新 zip，覆盖 `dist/manual-bridge/` 全部内容。
2. `chrome://extensions` → webcode bridge 卡片 → 点**刷新图标**（重新加载）。
3. 回 VS Code 状态栏**重新发起连接**（启动码为一次性，必须重新生成）。

## 版本一致性

- 网关握手要求 VS Code 扩展版本与桥接 manifest 版本**严格一致**
  （另有 `bridgeProtocolVersion` 协议版本校验），不一致会拒绝连接并提示哪侧过旧；
- 因此每次升级 VS Code 扩展（vsix）后，桥接必须同步升级，反之亦然；
- 隔离浏览器用户无需本约定（扩展管理器自动暂存更新）。

## 注意事项

- 固定文件夹路径一经注册不要改动或重命名（Chrome 按绝对路径跟踪）；
- 更新后若仍报版本不一致：确认第 2 步的刷新已执行，再检查 `dist/manual-bridge/manifest.json` 版本号。

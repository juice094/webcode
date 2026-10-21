import { Logger } from "../modules/logger";

// 连接从在线变为离线时给出可行动指引：网关可能因空闲自动关停，
// 悬浮日志常驻一条警告，窗口在后台时再补一条系统通知。
export function notifyGatewayDisconnected(): void {
  const isZh = navigator.language.toLowerCase().startsWith("zh");
  const logMessage = isZh
    ? "⚠️ 与 VS Code 网关的连接中断，正在自动恢复。若网关仍在运行（例如窗口刚刚重载），回到页面几秒内会自行续上；若 VS Code 侧已停止服务，请在状态栏启动后重试。"
    : "⚠️ Lost the connection to the VS Code gateway. Recovering automatically: if the gateway is still running (for example right after a window reload) this tab reconnects within seconds; if the service was stopped, start it from the VS Code status bar and retry.";
  Logger.log(logMessage, "warn");

  void chrome.runtime.sendMessage({
    type: "SHOW_NOTIFICATION",
    title: isZh ? "webcode 连接已断开" : "webcode disconnected",
    message: isZh
      ? "正在自动恢复；若网关已停止，请在 VS Code 状态栏启动服务后重试。"
      : "Recovering automatically; if the gateway was stopped, start it from the VS Code status bar and retry.",
    onlyWhenWindowInBackground: true,
  });
}

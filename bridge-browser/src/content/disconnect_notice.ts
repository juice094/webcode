import { Logger } from "../modules/logger";

// 连接从在线变为离线时给出可行动指引：网关可能因空闲自动关停，
// 悬浮日志常驻一条警告，窗口在后台时再补一条系统通知。
export function notifyGatewayDisconnected(): void {
  const isZh = navigator.language.toLowerCase().startsWith("zh");
  const logMessage = isZh
    ? "⚠️ 与 VS Code 网关的连接已断开。网关可能因空闲自动停止：请在 VS Code 状态栏重启服务，然后重新打开站点连接。"
    : "⚠️ Disconnected from the VS Code gateway. It may have stopped after idle timeout: restart the service from the VS Code status bar, then reconnect the site.";
  Logger.log(logMessage, "warn");

  void chrome.runtime.sendMessage({
    type: "SHOW_NOTIFICATION",
    title: isZh ? "webcode 连接已断开" : "webcode disconnected",
    message: isZh
      ? "网关可能因空闲自动停止：请在 VS Code 状态栏重启服务并重新连接。"
      : "The gateway may have stopped after idle timeout: restart it from the VS Code status bar and reconnect.",
    onlyWhenWindowInBackground: true,
  });
}

import { BRANDING } from "@webcode/shared";
import { i18n } from "../modules/i18n";
import { Logger } from "../modules/logger";
import { detectNativeToolSyntax } from "../modules/nativeToolSyntax";
import { showUserAttentionNotification } from "../modules/user_attention";

// 同一条消息在同一位置重复扫描时只提示一次，避免流式重扫刷屏。
const notifiedNativeSyntax = new WeakMap<Element, string>();

/**
 * 生成结束后，如果本轮出现了平台原生工具调用语法、但没有任何有效 JSON 调用被捕获，
 * 说明整轮静默失败。此时主动提示，避免用户只看到一段乱码文本。
 */
export function reportNativeSyntaxDrift(messageElement: Element, hasValidToolCalls: boolean): void {
  const hit = detectNativeToolSyntax(messageElement.textContent ?? "");
  if (!hit || hasValidToolCalls) {
    return;
  }

  if (notifiedNativeSyntax.get(messageElement) === hit.marker) {
    return;
  }
  notifiedNativeSyntax.set(messageElement, hit.marker);

  const message = i18n.lang === "zh"
    ? `模型输出了 ${hit.family} 原生工具调用语法，本次未被 webcode 执行。请让它改用 JSON 代码块重试。`
    : `The model emitted ${hit.family} native tool syntax. webcode did not execute it. Ask it to retry with a JSON code block.`;
  Logger.log(message, "error");
  void showUserAttentionNotification({
    title: `${BRANDING.productName} Error`,
    message,
  });
}

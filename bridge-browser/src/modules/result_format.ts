import { i18n } from "./i18n";

/**
 * How one tool result reads when it is fed back to the model.
 *
 * Results used to be a {"mcp_action":"result"} JSON code block. That wrapper is
 * re-sent with the whole conversation on every later round, and JSON escaping
 * charges two characters for every newline — a 500-line file pays ~500 bytes
 * just to say "this is a line break", on every round, forever. One sentence
 * ("read_file done" / "read_file failed") carries the same information for the
 * model, and the payload stays byte for byte what the tool produced.
 */

/** A single-line payload at or below this length reads fine inline, without a block. */
const INLINE_RESULT_MAX_CHARS = 300;

export function formatToolResultOutcome(toolName: string, content: string, isError: boolean): string {
  if (isError) {
    return i18n.lang === "zh"
      ? `${toolName} 没成功：${content}`
      : `${toolName} failed: ${content}`;
  }

  const trimmed = content.trim();
  if (i18n.lang === "zh") {
    if (trimmed === "") {
      return `${toolName} 跑完了，没有输出。`;
    }
    return isShortSingleLine(content, trimmed)
      ? `${toolName} 跑完了，结果是：${trimmed}`
      : `${toolName} 跑完了，结果如下：\n${fenceResultContent(content)}`;
  }

  if (trimmed === "") {
    return `${toolName} finished with no output.`;
  }
  return isShortSingleLine(content, trimmed)
    ? `${toolName} done — result: ${trimmed}`
    : `${toolName} done — result:\n${fenceResultContent(content)}`;
}

function isShortSingleLine(content: string, trimmed: string): boolean {
  return trimmed.length <= INLINE_RESULT_MAX_CHARS && !content.includes("\n");
}

/**
 * A fence longer than any backtick run in the payload, so a result that itself
 * contains markdown code blocks cannot terminate the result block early.
 */
export function fenceResultContent(content: string): string {
  let longestRun = 0;
  let currentRun = 0;
  for (const character of content) {
    if (character === "`") {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${content}\n${fence}`;
}

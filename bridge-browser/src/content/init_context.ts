import { BRANDING, joinPromptSections, PROTOCOL } from "@webcode/shared";
import { i18n } from "../modules/i18n";
import { Logger } from "../modules/logger";
import { readPlatformPromptFromStorage } from "./prompt_resources";

interface ToolExecutionResponse {
  success: boolean;
  error?: string;
  data?: unknown;
}

interface WebcodeInitPromptOptions {
  includeInitToolResultHeader?: boolean;
  siteId?: string | null;
}

export async function buildWebcodeInitPrompt(options: WebcodeInitPromptOptions = {}): Promise<string> {
  let finalPrompt = options.includeInitToolResultHeader === false
    ? ""
    : buildInitToolResultHeader();
  finalPrompt += await buildBasePrompt(options.siteId);

  Logger.log(`Initializing ${BRANDING.productName} with prompt, project rules, project context, tool list, and skill list`, "action");

  try {
    const projectRules = (await executeInitToolCall("get_project_rules")).trim();
    if (projectRules) {
      finalPrompt += `\n\n${projectRules}`;
    }
  } catch (error) {
    Logger.log(`Project rules fetch failed: ${getErrorMessage(error)}`, "error");
  }

  try {
    const projectContext = (await executeInitToolCall("get_project_context")).trim();
    if (projectContext) {
      finalPrompt += `\n\n${projectContext}`;
    }
  } catch (error) {
    Logger.log(`Project context fetch failed: ${getErrorMessage(error)}`, "error");
  }

  try {
    const [toolsResult, skillsResult] = await Promise.all([
      executeInitToolCall("list_tools"),
      executeInitToolCall("list_skills"),
    ]);

    // Deliberately no product name in these headers: the injected context is
    // visible to the web AI platform, and naming the bridge is a free
    // automation signal. The JSON blocks stay (they are the machine-readable
    // tool/skill index the model reads on every round), but each gets one
    // spoken line first so the dump reads as an answer, not a payload.
    const toolsIntro = i18n.lang === "zh"
      ? "你现在能用的工具都在下面（JSON，按 server 分组）；调用时照每个条目的 schema 填参数。"
      : "Here are the tools you can call right now (JSON, grouped by server); fill arguments per each entry's schema.";
    const skillsIntro = i18n.lang === "zh"
      ? "下面是当前可用的技能清单（JSON）；要用哪个技能，直接读它的 skillFilePath。"
      : "Here are the available skills (JSON); to use one, read its skillFilePath directly.";
    finalPrompt += `\n\n# Available Tools\n${toolsIntro}\n\`\`\`json\n${escapeInlineNewlines(toolsResult)}\n\`\`\``;
    finalPrompt += `\n\n# Available Skills\n${skillsIntro}\n\`\`\`json\n${escapeInlineNewlines(skillsResult)}\n\`\`\``;
  } catch (error) {
    Logger.log(`Initialization data fetch failed: ${getErrorMessage(error)}`, "error");
    finalPrompt += `\n\n# Initialization Note\nFailed to fetch the tool or skill list. Re-run \`${PROTOCOL.initToolName}\` if needed.`;
  }

  return finalPrompt;
}

async function buildBasePrompt(siteId?: string | null): Promise<string> {
  const platformPrompt = await readPlatformPromptFromStorage(siteId);

  return joinPromptSections(i18n.resources.prompt, platformPrompt);
}

function buildInitToolResultHeader(): string {
  return i18n.lang === "zh"
    ? `初始化内容已就位——项目规则、项目上下文、工具清单和技能清单都在下面，直接开始任务即可，不要再发送 ${PROTOCOL.initToolName}。\n\n`
    : `The initialization payload is below — project rules, project context, the tool list and the skill list. Start the task directly; do not send ${PROTOCOL.initToolName} again.\n\n`;
}

function executeInitToolCall(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "EXECUTE_TOOL",
        payload: { name, arguments: {} },
      },
      (response: unknown) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const result = normalizeToolResponse(response);
        if (!result.success) {
          reject(new Error(result.error ?? `Failed to execute ${name}`));
          return;
        }

        resolve(formatToolOutput(result.data, getInitToolFallback(name)));
      }
    );
  });
}

function escapeInlineNewlines(value: string): string {
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function formatToolOutput(data: unknown, fallback: string): string {
  return stringifyToolData(data, fallback);
}

function getInitToolFallback(toolName: string): string {
  return toolName === "get_project_rules" || toolName === "get_project_context" ? "" : "[]";
}

function normalizeToolResponse(response: unknown): ToolExecutionResponse {
  if (!isRecord(response)) {
    return {
      success: false,
      error: "Tool execution failed.",
    };
  }

  return {
    success: response.success === true,
    error: typeof response.error === "string" ? response.error : undefined,
    data: response.data,
  };
}

function stringifyToolData(data: unknown, fallback: string): string {
  if (typeof data === "string") {return data;}
  if (data == null) {return fallback;}
  const json = JSON.stringify(data, null, 2);
  if (typeof json === "string") {return json;}
  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return String(data);
  }
  return fallback;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

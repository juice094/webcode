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
  let capabilitySnapshot = "";
  try {
    capabilitySnapshot = (await executeInitToolCall("get_capability_snapshot")).trim();
  } catch (error) {
    Logger.log(`Capability snapshot fetch failed: ${getErrorMessage(error)}`, "error");
  }

  let finalPrompt = options.includeInitToolResultHeader === false
    ? ""
    : buildInitToolResultHeader(capabilitySnapshot.length > 0);
  finalPrompt += await buildBasePrompt(options.siteId);

  Logger.log(`Initializing ${BRANDING.productName} with prompt, capability snapshot, project rules, and project context`, "action");

  if (capabilitySnapshot) {
    finalPrompt += `\n\n${capabilitySnapshot}`;
  }

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

  return finalPrompt;
}

async function buildBasePrompt(siteId?: string | null): Promise<string> {
  const platformPrompt = await readPlatformPromptFromStorage(siteId);

  return joinPromptSections(i18n.resources.prompt, platformPrompt);
}

function buildInitToolResultHeader(hasCapabilitySnapshot: boolean): string {
  if (hasCapabilitySnapshot) {
    return i18n.lang === "zh"
      ? `初始化内容已就位——控制流契约、能力快照、项目规则和项目上下文都在下面。能力快照即当前可用工具与技能的事实来源：按任务意图直接调用工具，不要把清点能力当作任务前置；需要某工具的完整 inputSchema，或快照之后能力有变动时，再按需调用 list_tools / list_skills。此后不要再发送 ${PROTOCOL.initToolName}。\n\n`
      : `The initialization payload is below — the control flow contract, the capability snapshot, project rules, and project context. The snapshot is the source of truth for the currently available tools and skills: call tools directly as the task requires instead of inventorying first; call list_tools / list_skills only when you need a tool's full inputSchema or capabilities changed after the snapshot. Do not send ${PROTOCOL.initToolName} again.\n\n`;
  }

  return i18n.lang === "zh"
    ? `初始化内容已就位——控制流契约、项目规则和项目上下文都在下面。开始任务前，先调用 list_tools 获取当前可用工具列表，并按需调用 list_skills 获取技能清单；此后不要再发送 ${PROTOCOL.initToolName}。\n\n`
    : `The initialization payload is below — the control flow contract, project rules, and project context. Before starting the task, call list_tools for the current tool list and list_skills for the skill list as needed; do not send ${PROTOCOL.initToolName} again.\n\n`;
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

        resolve(stringifyToolData(result.data, ""));
      }
    );
  });
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

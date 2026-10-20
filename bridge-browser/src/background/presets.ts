export interface SessionPresetSettings {
  defaultAutoApproveTools: boolean;
  defaultApprovalMode: string;
}

const SESSION_PRESET_SETTINGS_KEY = "sessionPresetSettings";

const DEFAULT_SESSION_PRESET_SETTINGS: SessionPresetSettings = {
  defaultAutoApproveTools: false,
  defaultApprovalMode: "ask-when-needed",
};

export async function getSessionPresetSettings(): Promise<SessionPresetSettings> {
  const result = await chrome.storage.local.get([SESSION_PRESET_SETTINGS_KEY]) as Record<string, unknown>;
  return normalizeSessionPresetSettings(result[SESSION_PRESET_SETTINGS_KEY]);
}

export async function updateDefaultAutoApproveTools(defaultAutoApproveTools: boolean): Promise<SessionPresetSettings> {
  const currentSettings = await getSessionPresetSettings();
  const nextSettings: SessionPresetSettings = {
    ...currentSettings,
    defaultAutoApproveTools,
    defaultApprovalMode: defaultAutoApproveTools ? "never-ask" : currentSettings.defaultApprovalMode,
  };

  await chrome.storage.local.set({
    [SESSION_PRESET_SETTINGS_KEY]: nextSettings,
  });

  return nextSettings;
}

export async function updateDefaultApprovalMode(defaultApprovalMode: string): Promise<SessionPresetSettings> {
  const currentSettings = await getSessionPresetSettings();
  const nextSettings: SessionPresetSettings = {
    ...currentSettings,
    defaultApprovalMode,
    defaultAutoApproveTools: defaultApprovalMode === "never-ask",
  };

  await chrome.storage.local.set({
    [SESSION_PRESET_SETTINGS_KEY]: nextSettings,
  });

  return nextSettings;
}

function normalizeSessionPresetSettings(value: unknown): SessionPresetSettings {
  if (!isRecord(value)) {
    return DEFAULT_SESSION_PRESET_SETTINGS;
  }

  // Legacy presets only stored the defaultAutoApproveTools boolean.
  const defaultApprovalMode = typeof value.defaultApprovalMode === "string"
    ? value.defaultApprovalMode
    : value.defaultAutoApproveTools === true
      ? "never-ask"
      : DEFAULT_SESSION_PRESET_SETTINGS.defaultApprovalMode;

  return {
    defaultAutoApproveTools: defaultApprovalMode === "never-ask"
      ? true
      : value.defaultAutoApproveTools === true,
    defaultApprovalMode,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

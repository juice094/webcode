import type { DiscoveredGateway, DiscoverGatewaysResponse, PairingErrorCode, RequestConnectResponse } from '../pairing_protocol';
import type { PopupTranslator } from './i18n';

/**
 * "Discovered workspaces" section of the popup.
 *
 * Self-contained on purpose: it looks its elements up itself and resolves the
 * active tab at click time, so the main popup script only has to show and hide
 * it. Pairing happens in the background; this file renders and sends messages.
 */
export type WorkspaceSection = {
  /** Shows the section and starts a scan. */
  show: () => void;
  hide: () => void;
};

type SectionElements = {
  card: HTMLElement;
  hint: HTMLElement;
  list: HTMLElement;
  rescanButton: HTMLButtonElement;
  status: HTMLElement;
  title: HTMLElement;
};

type SectionContext = {
  elements: SectionElements;
  t: PopupTranslator;
  scanning: boolean;
  connecting: boolean;
};

export function createWorkspaceSection(t: PopupTranslator): WorkspaceSection {
  const context: SectionContext = {
    elements: readElements(),
    t,
    scanning: false,
    connecting: false,
  };
  context.elements.title.textContent = t("discovered_title");
  context.elements.hint.textContent = t("discovered_hint");
  context.elements.rescanButton.textContent = t("discovered_rescan");
  context.elements.rescanButton.addEventListener("click", () => {
    void refreshSection(context);
  });

  return {
    show: () => {
      context.elements.card.classList.remove("hidden");
      void refreshSection(context);
    },
    hide: () => context.elements.card.classList.add("hidden"),
  };
}

async function refreshSection(context: SectionContext): Promise<void> {
  if (context.scanning || context.connecting) {
    return;
  }
  context.scanning = true;
  context.elements.rescanButton.disabled = true;
  setStatus(context, context.t("discovered_scanning"));

  const response = await sendMessage<DiscoverGatewaysResponse>({ type: "DISCOVER_GATEWAYS" });
  context.scanning = false;
  context.elements.rescanButton.disabled = false;

  const gateways = response?.success ? response.gateways ?? [] : [];
  renderGatewayList(context, gateways);
  setStatus(context, gateways.length > 0 ? "" : context.t("discovered_empty"));
}

function renderGatewayList(context: SectionContext, gateways: DiscoveredGateway[]): void {
  context.elements.list.textContent = "";
  for (const gateway of gateways) {
    context.elements.list.appendChild(createGatewayRow(context, gateway));
  }
}

function createGatewayRow(context: SectionContext, gateway: DiscoveredGateway): HTMLElement {
  const row = document.createElement("div");
  row.className = "discovered-item";

  const name = document.createElement("div");
  name.className = "discovered-name";
  name.textContent = gateway.workspaceName ?? context.t("discovered_unknown_workspace");
  const meta = document.createElement("div");
  meta.className = "discovered-meta";
  meta.textContent = `${context.t("port_label")} ${gateway.port}`;
  name.appendChild(meta);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn discovered-connect";
  button.textContent = gateway.sessionActive ? context.t("discovered_busy") : context.t("discovered_connect");
  button.disabled = gateway.sessionActive;
  button.addEventListener("click", () => {
    void connectGateway(context, gateway, button);
  });

  row.append(name, button);
  return row;
}

async function connectGateway(
  context: SectionContext,
  gateway: DiscoveredGateway,
  button: HTMLButtonElement
): Promise<void> {
  if (context.connecting) {
    return;
  }
  context.connecting = true;
  button.disabled = true;
  button.textContent = context.t("discovered_connecting");
  setStatus(context, context.t("discovered_connecting"));

  const response = await requestConnect(gateway.port);
  context.connecting = false;

  if (response?.success) {
    setStatus(context, context.t("discovered_connected"));
    window.setTimeout(() => window.close(), 600);
    return;
  }

  button.disabled = gateway.sessionActive;
  button.textContent = gateway.sessionActive
    ? context.t("discovered_busy")
    : context.t("discovered_connect");
  setStatus(context, describeFailure(context, response?.code) ?? response?.error ?? context.t("discovered_failed"));
}

async function requestConnect(port: number): Promise<RequestConnectResponse | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) {
    return null;
  }
  return sendMessage<RequestConnectResponse>({ type: "REQUEST_CONNECT", port, tabId });
}

function describeFailure(context: SectionContext, code: PairingErrorCode | undefined): string | null {
  if (code === "declined") {return context.t("discovered_declined");}
  if (code === "rate-limited") {return context.t("discovered_rate_limited");}
  if (code === "no-workspace") {return context.t("discovered_no_workspace");}
  return null;
}

function setStatus(context: SectionContext, text: string): void {
  context.elements.status.textContent = text;
}

function readElements(): SectionElements {
  return {
    card: document.getElementById("discoveredCard") as HTMLElement,
    hint: document.getElementById("discoveredHint") as HTMLElement,
    list: document.getElementById("discoveredList") as HTMLElement,
    rescanButton: document.getElementById("rescanGatewaysBtn") as HTMLButtonElement,
    status: document.getElementById("discoveredStatus") as HTMLElement,
    title: document.getElementById("discoveredTitle") as HTMLElement,
  };
}

function sendMessage<T>(message: unknown): Promise<T | null> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response as T);
    });
  });
}

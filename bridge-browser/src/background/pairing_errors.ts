import type { PairingErrorCode } from '../pairing_protocol';

/** Stable codes the gateway may return; anything else is a protocol surprise. */
const KNOWN_PAIRING_ERRORS: PairingErrorCode[] = [
  "declined",
  "rate-limited",
  "no-workspace",
  "unknown-site",
  "forbidden-origin",
  "unsupported-media-type",
  "invalid-request",
  "unavailable",
];

export function isPairingErrorCode(value: unknown): value is PairingErrorCode {
  return typeof value === "string" && (KNOWN_PAIRING_ERRORS as string[]).includes(value);
}

/** Maps a gateway error body onto the codes the popup translates. */
export async function readPairingErrorCode(response: Response): Promise<PairingErrorCode> {
  try {
    const body: unknown = await response.json();
    const error = typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).error
      : undefined;
    return isPairingErrorCode(error) ? error : "invalid-response";
  } catch {
    return response.status === 429 ? "rate-limited" : "invalid-response";
  }
}

/** Short English text for the background response; the popup localizes by code. */
const PAIRING_ERROR_MESSAGES: Record<PairingErrorCode, string> = {
  "declined": "The connection request was declined in VS Code.",
  "rate-limited": "Too many connection requests. Try again in a minute.",
  "no-workspace": "That VS Code window has no workspace folder open.",
  "unknown-site": "That page is not a configured AI site.",
  "forbidden-origin": "The request origin is not allowed to pair.",
  "unsupported-media-type": "The pairing request was not sent as JSON.",
  "invalid-request": "The pairing request was malformed.",
  "unreachable": "Could not reach the VS Code gateway.",
  "version-mismatch": "VS Code and the browser extension versions do not match.",
  "invalid-response": "The gateway returned an invalid pairing response.",
  "invalid-sender": "The pairing request did not come from the extension.",
  "no-tab": "The active tab could not be determined.",
  "invalid-port": "The gateway port is outside the supported range.",
  "unavailable": "The gateway could not issue a launch code.",
};

export function describePairingError(code: PairingErrorCode): string {
  return PAIRING_ERROR_MESSAGES[code];
}

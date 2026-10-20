import { createRequestDeadline, formatRequestTimeout } from "../src/background/request_deadline";

const DEADLINE_MS = 20;
const SETTLE_MS = 60;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);}
}

async function main(): Promise<void> {
  const disabled = createRequestDeadline(undefined);
  assert(disabled.signal === undefined, "a missing deadline must not create an AbortSignal");
  assert(disabled.timedOut() === false, "a missing deadline must never report a timeout");
  assert(disabled.timeoutMs === 0, "a missing deadline must report 0");

  assert(createRequestDeadline(0).signal === undefined, "0 must disable the deadline");
  assert(createRequestDeadline(Number.NaN).signal === undefined, "NaN must disable the deadline");
  assert(createRequestDeadline(-5).signal === undefined, "negative values must disable the deadline");

  const pending = createRequestDeadline(DEADLINE_MS);
  assert(pending.signal !== undefined, "a positive deadline must create an AbortSignal");
  assertEqual(pending.signal?.aborted, false, "the signal must start un-aborted");
  assertEqual(pending.timedOut(), false, "the deadline must not fire immediately");
  await delay(SETTLE_MS);
  assertEqual(pending.timedOut(), true, "the deadline must report a timeout once it fires");
  assertEqual(pending.signal?.aborted, true, "the signal must abort when the deadline fires");
  pending.dispose();

  const disposed = createRequestDeadline(DEADLINE_MS);
  disposed.dispose();
  await delay(SETTLE_MS);
  assertEqual(disposed.timedOut(), false, "dispose() must cancel the deadline");
  assertEqual(disposed.signal?.aborted, false, "dispose() must not abort the request");

  assertEqual(formatRequestTimeout(1500), "Request timed out after 1500 ms.", "unexpected timeout text");
  assert(
    formatRequestTimeout(1500, "The gateway may still be running the tool.").includes("may still be running"),
    "timeout detail was dropped"
  );

  console.log("PASS applies browser request deadlines without leaving state behind");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

void main();

import { detectNativeToolSyntax } from "../src/modules/nativeToolSyntax";

const FENCE = "`".repeat(3);

function main(): void {
  runTest("detects DeepSeek DSML call markers", () => {
    const text = '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="read_file">';
    const hit = detectNativeToolSyntax(text);
    if (!hit) {
      throw new Error("expected a DSML hit");
    }
    assertEqual(hit.family, "DeepSeek DSML", "unexpected family for double-bar DSML");
  });

  runTest("detects single-bar DSML variant", () => {
    const hit = detectNativeToolSyntax("prefix ｜DSML｜ invoke suffix");
    if (!hit) {
      throw new Error("expected a single-bar DSML hit");
    }
    assertEqual(hit.family, "DeepSeek DSML", "unexpected family for single-bar DSML");
  });

  runTest("detects Anthropic antml invoke markers", () => {
    const hit = detectNativeToolSyntax('<antml:invoke name="read_file">');
    if (!hit) {
      throw new Error("expected an antml hit");
    }
    assertEqual(hit.family, "Anthropic antml", "unexpected family for antml");
  });

  runTest("ignores ordinary prose that only mentions the platform", () => {
    assertEqual(
      detectNativeToolSyntax("DeepSeek replied with a normal answer."),
      null,
      "prose mentioning DeepSeek must not trigger"
    );
    assertEqual(
      detectNativeToolSyntax("Anthropic published a model card."),
      null,
      "prose mentioning Anthropic must not trigger"
    );
  });

  runTest("ignores a valid JSON tool call block", () => {
    const body = '{"mcp_action":"call","name":"read_file","purpose":"x","arguments":{"path":"a.txt"}}';
    const text = `${FENCE}json\n${body}\n${FENCE}`;
    assertEqual(detectNativeToolSyntax(text), null, "valid JSON block must not trigger");
  });

  runTest("returns null for empty input", () => {
    assertEqual(detectNativeToolSyntax(""), null, "empty input must return null");
  });
}

function runTest(name: string, test: () => void): void {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

main();

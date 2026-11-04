import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Content-script text that gets inserted into the chat input reaches the web
// AI platform's server, so it must stay identity-free. This is a regression
// gate: prompts were scrubbed in 1.6.3, but result/inserted text was missed
// until 1.6.4 because nothing guarded these strings.

const IDENTITY_PATTERN = /webcode/i;

// Literal occurrences that are not model-facing text:
// - the scoped package specifier is an import path;
// - the trigger token regex is user input, never echoed into inserted text.
const ALLOWED = [
    /@webcode\/shared/g,
    /\/webcode\|@webcode/g,
    /WebcodeInitPrompt/g,
];

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) { throw new Error(message); }
}

function scanFile(absolutePath: string): void {
    let content = fs.readFileSync(absolutePath, "utf8");
    for (const pattern of ALLOWED) {
        content = content.replace(pattern, "");
    }
    assert(
        !IDENTITY_PATTERN.test(content),
        `${path.basename(absolutePath)} names the product in chat-inserted text; keep it identity-free`,
    );
}

function main(): void {
    const contentDir = path.resolve(here, "../../src/content");
    const targets = [
        "auto_init_prompt.ts",
        "auto_init_prompt_text.ts",
        "init_context.ts",
        "tool_call_tracker.ts",
    ];
    for (const target of targets) {
        scanFile(path.join(contentDir, target));
    }
}

main();

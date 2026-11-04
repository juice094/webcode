import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createLocalToolMap } from '../tools';

// Model-facing surfaces must stay identity-free: injected prompts, tool
// descriptions, and tool-result text all reach the web AI platform's server,
// and naming the product there is a free automation signal for risk control.

const IDENTITY_PATTERN = /webcode/i;

suite('Model-facing identity hygiene', () => {
    test('injected prompt templates never name the product', () => {
        const promptsDir = path.resolve(__dirname, '../../prompts');
        const entries = fs.readdirSync(promptsDir, { recursive: true }) as string[];
        const mdFiles = entries.filter((entry) => entry.endsWith('.md'));
        assert.ok(mdFiles.length > 0, 'expected prompt templates under prompts/');
        for (const entry of mdFiles) {
            const content = fs.readFileSync(path.join(promptsDir, entry), 'utf8');
            assert.ok(
                !IDENTITY_PATTERN.test(content),
                `prompt template ${entry} names the product; keep model-facing text identity-free`,
            );
        }
    });

    test('local tool descriptions never name the product', () => {
        for (const [name, tool] of createLocalToolMap()) {
            assert.ok(
                !IDENTITY_PATTERN.test(tool.definition.description),
                `tool ${name} description names the product; keep model-facing text identity-free`,
            );
        }
    });

    test('tool-result text sources never name the product', () => {
        // Result strings are composed inline in these modules; scan them
        // textually. The @webcode/shared package specifier is an import path,
        // not model-facing text.
        const sources = [
            'terminalSessionManager.ts',
            'schemaValidation.ts',
            'tools/listToolsTool.ts',
            'tools/listSkillsTool.ts',
        ];
        for (const rel of sources) {
            const content = fs
                .readFileSync(path.resolve(__dirname, '../../src', rel), 'utf8')
                .replace(/@webcode\/shared/g, '')
                .replace(/WebcodeTerminalProfile/g, '');
            assert.ok(
                !IDENTITY_PATTERN.test(content),
                `${rel} names the product in model-facing text; keep tool results identity-free`,
            );
        }
    });
});

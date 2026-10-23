/**
 * Minimal module-loader stub so unit tests can exercise GatewayManager
 * outside the extension host and outside webpack:
 * - `vscode` resolves to a stub implementing only the surface the gateway
 *   touches during start/stop, while building tool definitions, and while
 *   resolving UI strings (workspace folders and configuration reads, status bar
 *   message, UI language).
 * - `*.md` prompt imports (webpack asset modules in production builds)
 *   resolve to the raw file content.
 * Import this module for its side effect BEFORE importing any module that
 * requires 'vscode' or markdown prompts at runtime.
 *
 * WARNING: this is a process-wide `Module._load` patch with no uninstall.
 * Once loaded, it applies to the entire mocha process — any unit test that
 * imports 'vscode' or '*.md' will silently hit this stub instead of failing
 * module resolution as it normally would. Before adding a new vscode-dependent
 * unit test, explicitly evaluate whether stubbing is really what you want.
 * Do NOT grow the stubbed vscode API surface casually; add exactly the
 * members a test needs, nothing more.
 */
import * as fs from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- TS import-require is the typed form for `export =` modules like node:module.
import Module = require('node:module');

const vscodeStub = {
    workspace: {
        workspaceFolders: [] as unknown[],
        // Terminal profile discovery reads terminal.integrated settings; outside
        // the extension host there are no configured profiles to report. `get`
        // must still honour its default value: settings readers call
        // `.get(key, '')` and then use the string directly.
        getConfiguration: () => ({
            get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue
        })
    },
    window: {
        setStatusBarMessage: () => ({ dispose: () => undefined })
    },
    env: {
        // Outside the extension host there is no VS Code default shell to report.
        shell: undefined,
        // Only used to pick the UI language for translated strings.
        language: 'en'
    }
};

type LoadFunction = (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown;
type ResolveFunction = (request: string, parent: unknown) => string;

const moduleInternals = Module as unknown as {
    _load: LoadFunction;
    _resolveFilename: ResolveFunction;
};
const originalLoad = moduleInternals._load;

moduleInternals._load = function (this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
    if (request === 'vscode') {
        return vscodeStub;
    }

    if (request.endsWith('.md')) {
        return fs.readFileSync(moduleInternals._resolveFilename(request, parent), 'utf8');
    }

    return originalLoad.call(this, request, parent, isMain);
};

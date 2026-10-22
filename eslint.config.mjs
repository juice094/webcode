import typescriptEslint from "typescript-eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const commonRules = {
    "curly": "error",
    "eqeqeq": ["error", "always", { null: "ignore" }],
    "no-constant-binary-expression": "error",
    "no-duplicate-imports": "error",
    "no-else-return": "error",
    "no-fallthrough": "error",
    "no-implicit-coercion": "error",
    "no-unreachable": "error",
    "no-unreachable-loop": "error",
    "no-useless-assignment": "error",
    "no-useless-return": "error",
    "no-var": "error",
    "prefer-const": "error",
    "complexity": ["error", 12],
    "max-depth": ["error", 4],
    "max-lines": ["error", {
        max: 400,
        skipBlankLines: true,
        skipComments: true,
    }],
    "max-lines-per-function": ["error", {
        max: 90,
        skipBlankLines: true,
        skipComments: true,
        IIFEs: true,
    }],
    "max-len": ["error", {
        code: 140,
        ignoreComments: true,
        ignoreRegExpLiterals: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreUrls: true,
    }],
    "max-nested-callbacks": ["error", 3],
    "max-params": ["error", 5],
};

export default typescriptEslint.config(
    {
        ignores: [
            "**/dist/**",
            "bridge-browser/preview-dist/**",
            "**/node_modules/**",
            "**/out/**",
            "**/release/**",
            "**/.vscode-test/**",
            "bridge-browser/public/generated/**",
            "evals/.playwright-cli/**",
            "evals/live-profiles/**",
            "evals/manual-browser-extensions/**",
            "evals/manual-browser-profiles/**",
            "evals/runs/**",
            "gateway-vscode/browser-extension/**",
            "pnpm-lock.yaml"
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: "error",
        },
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
        },
        rules: commonRules,
    },
    {
        files: ["**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
        },
        rules: commonRules,
    },
    {
        files: ["**/*.ts"],
        extends: [
            ...typescriptEslint.configs.recommendedTypeChecked,
        ],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: rootDir,
            },
        },
        rules: {
            ...commonRules,
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
                destructuredArrayIgnorePattern: "^_",
                ignoreRestSiblings: true,
                varsIgnorePattern: "^_",
            }],
            "@typescript-eslint/consistent-type-imports": ["error", {
                fixStyle: "inline-type-imports",
                prefer: "type-imports",
            }],
            "@typescript-eslint/no-empty-function": "error",
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": ["error", {
                checksVoidReturn: false,
            }],
            "@typescript-eslint/no-non-null-assertion": "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",
            "@typescript-eslint/no-unsafe-argument": "error",
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            "@typescript-eslint/prefer-promise-reject-errors": "error",
            "@typescript-eslint/prefer-nullish-coalescing": "error",
            "@typescript-eslint/prefer-optional-chain": "error",
            "@typescript-eslint/require-await": "error",
            "@typescript-eslint/switch-exhaustiveness-check": "error",
            "no-restricted-imports": ["error", {
                patterns: [
                    {
                        group: [
                            "../shared/*",
                            "../../shared/*",
                            "../gateway-vscode/*",
                            "../../gateway-vscode/*",
                            "../bridge-browser/*",
                            "../../bridge-browser/*",
                        ],
                        message: "Use workspace package imports instead of relative imports across package boundaries.",
                    },
                    {
                        group: ["@webcode/shared/*"],
                        message: "Import from @webcode/shared public entry instead of deep shared paths.",
                    },
                ],
            }],
            "semi": ["error", "always"],
            "@typescript-eslint/naming-convention": ["error", {
                selector: "import",
                format: ["camelCase", "PascalCase"],
            }],
        },
    },
    {
        // Design-token guardrail.
        //
        // Colour must reach the DOM through stylesheets so it stays overridable
        // by tokens, themes and forced-colors. Writing colour from script was
        // how the original hardcoded palettes accumulated, and it is invisible
        // to every CSS-level check we have.
        //
        // Scope is intentionally narrow: only direct `style.color`-style
        // assignments are rejected. `style.setProperty('--token', ...)` remains
        // allowed because that is how a surface feeds a CSS variable.
        files: ["bridge-browser/src/**/*.ts", "gateway-vscode/src/**/*.ts"],
        rules: {
            "no-restricted-syntax": ["error",
                {
                    selector: "AssignmentExpression > MemberExpression.left[object.property.name='style'][property.name=/^(color|backgroundColor|borderColor|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor)$/]",
                    message: "Do not assign colours via inline styles. Add a class or a CSS variable and style it in the surface stylesheet.",
                },
            ],
        },
    },
    {
        files: ["**/*.d.ts"],
        rules: {
            "max-lines-per-function": "off",
        },
    },
    {
        files: ["**/*.test.ts"],
        rules: {
            "max-lines-per-function": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    },
);

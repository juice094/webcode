#!/usr/bin/env node
/**
 * Security gate for dependencies that are actually bundled into the shipped
 * extension.
 *
 * Why this exists: `pnpm audit` reports 138 advisories against this repo, but
 * webpack inlines every runtime dependency into `dist/extension.js` and
 * `.vscodeignore` drops `node_modules` from the `.vsix`. Only the closure of
 * `gateway-vscode`'s runtime dependencies reaches users; everything else runs
 * on developer machines and in CI. Gating on the raw total would make the check
 * permanently red and it would get disabled within a week.
 *
 * Usage:
 *   node scripts/audit-shipped-deps.mjs
 *   node scripts/audit-shipped-deps.mjs --input audit.json   # offline check
 *   node scripts/audit-shipped-deps.mjs --report             # full layer breakdown
 *
 * Note on `pnpm audit` metadata: it reports `devDependencies: 0` for this
 * workspace regardless of reality, because it does not understand pnpm
 * workspaces. The layer classification below derives from dependency paths
 * instead, so do not trust the metadata totals.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Runtime dependencies of `gateway-vscode`.
 *
 * Keep in sync with `gateway-vscode/package.json` `dependencies`. `@webcode/shared`
 * is workspace source rather than a published package, so it is not listed.
 */
const SHIPPED_ROOTS = new Set([
  "@modelcontextprotocol/sdk",
  "cors",
  "express",
  "zod",
]);

const REGISTRY = process.env.WEBCODE_AUDIT_REGISTRY ?? "https://registry.npmjs.org/";

function parseArgs(argv) {
  const options = { input: null, report: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") {
      options.input = argv[index + 1] ?? null;
      index += 1;
    } else if (argv[index] === "--report") {
      options.report = true;
    }
  }
  return options;
}

/**
 * Classify a dependency path by where the code runs.
 *
 * - shipped: bundled into the extension and delivered to users.
 * - build: executed on developer machines and CI while building.
 * - test: executed only by the eval harness.
 * - other: anything the classifier does not recognise, reported rather than
 *   silently ignored so a new package cannot hide in an unlabelled bucket.
 */
function classifyPath(path) {
  if (isShippedPath(path)) {
    return "shipped";
  }

  const root = path.split(">")[0];
  if (root === "evals") {
    return "test";
  }
  if (root === "bridge-browser" || root === "gateway-vscode" || root === ".") {
    return "build";
  }
  return "other";
}

/** Group every (advisory, path) pair into its layer, de-duplicated. */
function groupByLayer(advisories) {
  const layers = { shipped: [], build: [], test: [], other: [] };
  const seen = new Set();

  for (const [id, advisory] of Object.entries(advisories)) {
    for (const finding of advisory.findings ?? []) {
      for (const path of finding.paths ?? []) {
        const key = `${id}|${path}`;
        if (seen.has(key)) {continue;}
        seen.add(key);
        layers[classifyPath(path)].push({ id, advisory, path });
      }
    }
  }

  return layers;
}

function reportLayers(advisories, layers) {
  console.log(`audit: ${Object.keys(advisories).length} advisories across ${Object.values(layers).flat().length} dependency paths`);
  for (const name of ["shipped", "build", "test", "other"]) {
    const entries = layers[name];
    const modules = new Set(entries.map((entry) => entry.advisory.module_name));
    console.log(`  ${name}: ${entries.length} paths, ${modules.size} modules`);
  }

  for (const { id, advisory, path } of layers.other) {
    console.log(`  unclassified: ${advisory.module_name} ${id} via ${path}`);
  }
}

function readAuditPayload(inputPath) {
  if (inputPath) {
    return readFileSync(inputPath, "utf8");
  }

  try {
    return execSync(`pnpm audit --json --registry=${REGISTRY}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // pnpm audit exits non-zero whenever it finds advisories; stdout is still
    // the JSON payload we need.
    if (typeof error.stdout === "string" && error.stdout.trim()) {
      return error.stdout;
    }
    throw error;
  }
}

/**
 * A path is shipped when it starts at the gateway package and its first
 * dependency segment is one of the runtime dependencies. Build tooling such as
 * `@vscode/vsce` and `webpack` also lives under `gateway-vscode` but never
 * reaches the bundle.
 */
function isShippedPath(path) {
  const segments = path.split(">");
  if (segments[0] !== "gateway-vscode") {
    return false;
  }
  return SHIPPED_ROOTS.has(segments[1]);
}

/**
 * Parse the audit payload or exit with a distinguishable code.
 * Exit 2 means "the audit could not be performed", which is a different
 * failure from "the audit found shipped advisories" (exit 1).
 */
function parseAuditPayload(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    console.error("audit: could not parse pnpm audit output as JSON");
    process.exit(2);
  }

  if (parsed.error) {
    console.error(`audit: registry rejected the request: ${parsed.error.message}`);
    console.error("audit: set WEBCODE_AUDIT_REGISTRY to a registry with an audit endpoint");
    process.exit(2);
  }

  return parsed.advisories ?? {};
}

/** Collect every (advisory, shipped path) pair, de-duplicated by both. */
function collectShippedAdvisories(advisories) {
  const shipped = [];
  const seen = new Set();

  for (const [id, advisory] of Object.entries(advisories)) {
    for (const finding of advisory.findings ?? []) {
      for (const path of finding.paths ?? []) {
        if (!isShippedPath(path)) {continue;}
        const key = `${id}|${path}`;
        if (seen.has(key)) {continue;}
        seen.add(key);
        shipped.push({ id, advisory, path });
      }
    }
  }

  return shipped;
}

function reportShippedAdvisories(shipped) {
  for (const { id, advisory, path } of shipped) {
    console.error(
      `  ${advisory.severity.toUpperCase()} ${advisory.module_name} ${id} via ${path}`
    );
    console.error(`    patched in: ${advisory.patched_versions}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const advisories = parseAuditPayload(readAuditPayload(options.input));

  if (options.report) {
    reportLayers(advisories, groupByLayer(advisories));
    return;
  }

  const shipped = collectShippedAdvisories(advisories);

  console.log(
    `audit: ${Object.keys(advisories).length} advisories total, ${shipped.length} on shipped dependency paths`
  );

  if (shipped.length === 0) {
    console.log("audit: no advisories affect the shipped extension bundle");
    return;
  }

  reportShippedAdvisories(shipped);
  console.error("audit: shipped dependencies have known advisories; add an override or an exemption");
  process.exit(1);
}

main();

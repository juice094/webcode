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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this script so the gate works from any cwd. */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Built bundle that ships inside the `.vsix`.
 *
 * The path-based classifier below trusts `pnpm audit` to attribute a dependency
 * to the package that declares it. It does not: an advisory reachable through
 * `gateway-vscode > @modelcontextprotocol/sdk > hono` can be reported only as
 * `evals > @modelcontextprotocol/sdk > hono`, which would hide a module that
 * actually got bundled. Scanning the bundle closes that gap directly.
 */
const BUNDLE_PATH = join(REPO_ROOT, "gateway-vscode", "dist", "extension.js");
const BUNDLE_MAP_PATH = `${BUNDLE_PATH}.map`;

/**
 * Which packages are reachable from the shipped bundle.
 *
 * Webpack minifies, so the bundle text no longer contains package paths and
 * grepping it for a module name yields false negatives: `fast-uri` is inlined
 * yet the string "fast-uri" never appears. The source map written by
 * `devtool: 'nosources-source-map'` keeps every module path, which is the
 * accurate signal. The text scan remains as a fallback for a build without a
 * source map.
 */
function readSourceMapSources() {
  if (!existsSync(BUNDLE_MAP_PATH)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(BUNDLE_MAP_PATH, "utf8"));
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch {
    return [];
  }
}

function findBundledModules() {
  const bundled = new Set();

  {
    const sources = readSourceMapSources();

    for (const source of sources) {
      const index = source.lastIndexOf("node_modules/");
      if (index < 0) {continue;}
      const rest = source.slice(index + "node_modules/".length);
      const parts = rest.split("/");
      bundled.add(rest.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }

    if (bundled.size > 0) {
      return bundled;
    }
  }

  if (existsSync(BUNDLE_PATH)) {
    const pattern = /node_modules\/((?:@[^/\s"']+\/)?[^/\s"']+)\//g;
    for (const match of readFileSync(BUNDLE_PATH, "utf8").matchAll(pattern)) {
      bundled.add(match[1]);
    }
  }

  return bundled;
}

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
  const options = { input: null, report: false, requireBundle: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") {
      options.input = argv[index + 1] ?? null;
      index += 1;
    } else if (argv[index] === "--report") {
      options.report = true;
    } else if (argv[index] === "--require-bundle") {
      // CI must not silently skip the bundle scan: without a built bundle the
      // classification-conflict check cannot run, so a green result would be
      // meaningless.
      options.requireBundle = true;
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

/**
 * Advisories classified as build/test whose module is nonetheless inside the
 * shipped bundle.
 *
 * A non-empty result means the layer classification is wrong for this repo
 * state: the exemption it relies on no longer holds. This is a distinct failure
 * from "a shipped dependency has an advisory" and gets its own exit code so the
 * cause is unambiguous.
 */
function collectClassificationConflicts(advisories, layers) {
  if (!existsSync(BUNDLE_PATH) && !existsSync(BUNDLE_MAP_PATH)) {
    return { bundled: null, conflicts: [] };
  }

  const bundled = findBundledModules();
  const conflicts = [];
  const seen = new Set();

  for (const layerName of ["build", "test", "other"]) {
    for (const { id, advisory, path } of layers[layerName]) {
      const moduleName = advisory.module_name;
      if (!bundled.has(moduleName)) {
        continue;
      }
      const key = `${id}|${moduleName}|${layerName}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      conflicts.push({ id, advisory, path, layerName });
    }
  }

  return { bundled, conflicts };
}

function reportClassificationConflicts(conflicts) {
  for (const { id, advisory, path, layerName } of conflicts) {
    console.error(
      `  ${advisory.severity.toUpperCase()} ${advisory.module_name} ${id} classified ${layerName} but bundled via ${path}`
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const advisories = parseAuditPayload(readAuditPayload(options.input));

  if (options.report) {
    const layers = groupByLayer(advisories);
    reportLayers(advisories, layers);
    const { bundled, conflicts } = collectClassificationConflicts(advisories, layers);
    if (bundled === null) {
      console.log(`  bundle scan: ${BUNDLE_PATH} not found, skipped`);
      return;
    }
    console.log(`  bundle scan: ${bundled.size} packages inlined`);
    if (conflicts.length > 0) {
      console.log(`  bundle scan: ${conflicts.length} classification conflicts`);
      reportClassificationConflicts(conflicts);
    }
    return;
  }

  const shipped = collectShippedAdvisories(advisories);
  const { bundled, conflicts } = collectClassificationConflicts(advisories, groupByLayer(advisories));

  console.log(
    `audit: ${Object.keys(advisories).length} advisories total, ${shipped.length} on shipped dependency paths`
  );

  if (conflicts.length > 0) {
    console.error(
      `audit: ${conflicts.length} advisories were classified build/test but the module is inlined in the bundle`
    );
    reportClassificationConflicts(conflicts);
    console.error("audit: fix the dependency or correct the layer classification before shipping");
    process.exit(3);
  }

  if (bundled === null) {
    if (options.requireBundle) {
      console.error("audit: --require-bundle was set but no built bundle exists; build before auditing");
      process.exit(4);
    }
    console.log("audit: no built bundle found, bundle scan skipped (build before shipping)");
  } else {
    console.log(`audit: bundle scan checked ${bundled.size} inlined packages, no classification conflicts`);
  }

  if (shipped.length === 0) {
    console.log("audit: no advisories affect the shipped extension bundle");
    return;
  }

  reportShippedAdvisories(shipped);
  console.error("audit: shipped dependencies have known advisories; add an override or an exemption");
  process.exit(1);
}

main();

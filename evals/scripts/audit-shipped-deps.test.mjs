import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCRIPT = join(REPO_ROOT, 'scripts', 'audit-shipped-deps.mjs');

function runAudit(fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-fixture-'));
  const file = join(dir, 'audit.json');
  writeFileSync(file, JSON.stringify(fixture), 'utf8');
  try {
    return { status: 0, stdout: execFileSync('node', [SCRIPT, '--input', file], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function advisory(moduleName, paths) {
  return { module_name: moduleName, severity: 'high', patched_versions: '>=99.0.0', findings: [{ paths }] };
}

test('passes when a build-layer advisory is not in the bundle', () => {
  // webpack is build tooling and never inlined.
  const result = runAudit({ advisories: { 'TEST-A': advisory('webpack', ['gateway-vscode>webpack']) } });
  assert.equal(result.status, 0, result.stderr);
});

test('fails with exit 3 when a test-layer advisory is inlined', () => {
  // zod is inlined, so claiming it is test-only must be caught.
  const result = runAudit({ advisories: { 'TEST-B': advisory('zod', ['evals>zod']) } });
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(result.stderr, /classified test but bundled/);
});

test('fails with exit 1 when a shipped dependency has an advisory', () => {
  const result = runAudit({ advisories: { 'TEST-C': advisory('express', ['gateway-vscode>express']) } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDir, '..');
const repoRoot = resolve(extensionRoot, '..');

const chineseReadme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8').trimEnd();
const englishReadme = readFileSync(resolve(repoRoot, 'README_en.md'), 'utf8').trimEnd();

// VS Code Marketplace rejects SVG images in extension READMEs, so drop any
// line that references an .svg asset before packaging.
const stripSvgReferences = (readme) => readme
  .split('\n')
  .filter((line) => !/\.svg([\"')\]]|$)/i.test(line))
  .join('\n');

const marketplaceReadme = [
  '<!-- This README is generated for the VS Code Marketplace package. -->',
  '<!-- Sources: ../README.md and ../README_en.md -->',
  '',
  stripSvgReferences(chineseReadme),
  '',
  '---',
  '',
  stripSvgReferences(englishReadme),
  ''
].join('\n');

if (process.argv.includes('--stdout')) {
  process.stdout.write(marketplaceReadme);
} else {
  writeFileSync(resolve(extensionRoot, 'README.md'), marketplaceReadme, 'utf8');
}

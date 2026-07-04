/**
 * Rewrites @packages/shared/* path aliases in dist JS to relative imports
 * so npm-installed packages resolve without monorepo tsconfig paths.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const localDistRoot = join(repoRoot, 'dist/packages/local/src');
const aliasTargets = {
  '@packages/shared/constants': join(repoRoot, 'dist/packages/shared/constants/index.js'),
  '@packages/shared/types': join(repoRoot, 'dist/packages/shared/types/index.js'),
};

function walkJsFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walkJsFiles(fullPath, files);
      continue;
    }
    if (fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function toRelativeImport(fromFile, targetFile) {
  let rel = relative(dirname(fromFile), targetFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel;
}

let rewritten = 0;

for (const file of walkJsFiles(localDistRoot)) {
  let content = readFileSync(file, 'utf8');
  let changed = false;

  for (const [alias, targetFile] of Object.entries(aliasTargets)) {
    if (!content.includes(alias)) {
      continue;
    }
    const relImport = toRelativeImport(file, targetFile);
    content = content.replaceAll(`'${alias}'`, `'${relImport}'`);
    content = content.replaceAll(`"${alias}"`, `"${relImport}"`);
    changed = true;
  }

  if (changed) {
    writeFileSync(file, content);
    rewritten += 1;
  }
}

console.info(`[fix-dist-imports] rewrote ${String(rewritten)} file(s)`);

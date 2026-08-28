import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const forbiddenPatterns = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\s*\(/,
];

const repositoryRoot = join(import.meta.dirname, '..');
const workspaceGroups = ['apps', 'packages'];

// Discovered rather than listed so a newly added workspace is covered by
// default: forgetting to wire one up must not silently skip this check.
function collectSourceRoots() {
  const roots = [];

  for (const group of workspaceGroups) {
    const groupPath = join(repositoryRoot, group);
    if (!existsSync(groupPath)) {
      continue;
    }

    for (const workspace of readdirSync(groupPath)) {
      const sourcePath = join(groupPath, workspace, 'src');
      if (existsSync(sourcePath)) {
        roots.push(sourcePath);
      }
    }
  }

  return roots;
}

function isCheckedSourceFile(filePath) {
  if (filePath.includes('__fixtures__')) {
    return false;
  }

  if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) {
    return false;
  }

  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

function collectFiles(directoryPath) {
  const entries = readdirSync(directoryPath);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directoryPath, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (isCheckedSourceFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

const sourceRoots = collectSourceRoots();

if (sourceRoots.length === 0) {
  console.error('No workspace source directories found; nothing was checked.');
  process.exit(1);
}

const violations = [];

for (const sourceRoot of sourceRoots) {
  for (const filePath of collectFiles(sourceRoot)) {
    const content = readFileSync(filePath, 'utf8');

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        violations.push(`${filePath}: matched ${pattern.source}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Network API usage detected in extension source:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(
  `No forbidden network APIs found in ${String(sourceRoots.length)} workspace source directories.`,
);

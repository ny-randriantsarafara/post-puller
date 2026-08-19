import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const forbiddenPatterns = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\s*\(/,
];

const sourceRoot = join(import.meta.dirname, '..', 'src');

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

    if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }

  return files;
}

const violations = [];

for (const filePath of collectFiles(sourceRoot)) {
  const content = readFileSync(filePath, 'utf8');

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      violations.push(`${filePath}: matched ${pattern.source}`);
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

console.log('No forbidden network APIs found in src/.');

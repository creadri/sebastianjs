#!/usr/bin/env node
// Pin `mermaid` to the exact version mermaid-cli was released against.
//
// Parity is measured against mermaid-cli's Chrome output, so the two must run
// the *same* mermaid build. They diverge silently otherwise: mermaid-cli
// declares "mermaid": "^11.0.2", and this package used to declare an open
// ">=" range, so a fresh install could put a newer mermaid on our side than
// the one mmdc renders with -- which is how mermaid 11.17's `new
// CSSStyleSheet()` reached users against a green suite.
//
// mermaid-cli does not publish its lockfile to npm (npm strips it from
// tarballs), so the pinned version is read from its GitHub tag.
//
// Usage: node scripts/sync-mermaid-version.mjs [--check]

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CLI_PKG = '@mermaid-js/mermaid-cli';
const LOCK_URL = (tag) =>
  `https://raw.githubusercontent.com/mermaid-js/mermaid-cli/${tag}/package-lock.json`;

/** The mermaid-cli version this repo actually installs, without its range prefix. */
async function installedCliVersion(root) {
  const pkgPath = resolve(root, 'node_modules', CLI_PKG, 'package.json');
  try {
    return JSON.parse(await readFile(pkgPath, 'utf8')).version;
  } catch {
    throw new Error(`${CLI_PKG} is not installed; run \`npm install\` first.`);
  }
}

/** mermaid-cli tags releases as a bare "11.9.0", but tolerate a "v" prefix. */
async function mermaidVersionForCli(cliVersion) {
  const errors = [];
  for (const tag of [cliVersion, `v${cliVersion}`]) {
    const res = await fetch(LOCK_URL(tag));
    if (!res.ok) {
      errors.push(`${tag}: HTTP ${res.status}`);
      continue;
    }
    const lock = JSON.parse(await res.text());
    const entry = lock.packages?.['node_modules/mermaid'];
    if (!entry?.version) {
      errors.push(`${tag}: no node_modules/mermaid entry in lockfile`);
      continue;
    }
    return { version: entry.version, tag };
  }
  throw new Error(
    `Could not read mermaid-cli's pinned mermaid version (${errors.join('; ')}).`
  );
}

async function main() {
  const check = process.argv.includes('--check');
  const root = resolve(import.meta.dirname, '..');
  const pkgPath = resolve(root, 'package.json');

  const cliVersion = await installedCliVersion(root);
  const { version: wanted, tag } = await mermaidVersionForCli(cliVersion);

  const raw = await readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  const declared = pkg.dependencies?.mermaid;

  console.error(`${CLI_PKG}@${cliVersion} (tag ${tag}) pins mermaid ${wanted}`);
  console.error(`package.json declares mermaid ${declared}`);

  if (declared === wanted) {
    console.error('In sync.');
    return;
  }
  if (check) {
    console.error(
      `\nOut of sync: expected an exact "${wanted}", found "${declared}".\n` +
      'Run `npm run sync:mermaid` and re-run the parity suite.'
    );
    process.exitCode = 1;
    return;
  }

  // Rewrite in place so the rest of package.json keeps its formatting.
  const updated = raw.replace(
    /("mermaid"\s*:\s*)"[^"]*"/,
    (_, key) => `${key}"${wanted}"`
  );
  if (updated === raw) throw new Error('Could not locate the mermaid dependency to rewrite.');
  await writeFile(pkgPath, updated, 'utf8');
  console.error(`\nUpdated to "${wanted}". Now run:\n  npm install\n  npm run fetch:samples\n  npm test`);
}

main().catch((err) => {
  console.error('Failed:', err?.message || err);
  process.exit(1);
});

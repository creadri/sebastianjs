// Lightweight wrapper around mermaid-cli (mmdc)
// - Detects Puppeteer config files in CWD or HOME and appends
//   `--puppeteerConfigFile <path>` if not already provided.
// - Provides simple spawn helpers and presence check.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';

const MMDC_CMD = 'mmdc';

const PUPPETEER_CONFIG_CANDIDATES = [
  '.puppeteerrc.cjs',
  '.puppeteerrc.js',
  '.puppeteerrc',
  '.puppeteerrc.json',
  '.puppeteerrc.yaml',
  'puppeteer.config.js',
  'puppeteer.config.cjs',
];

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

export async function locatePuppeteerConfig({ cwd = process.cwd() } = {}) {
  const dirs = [cwd, homedir()];
  for (const dir of dirs) {
    for (const name of PUPPETEER_CONFIG_CANDIDATES) {
      const p = resolve(dir, name);
      if (await fileExists(p)) return p;
    }
  }
  return null;
}

function hasFlag(args, flag) {
  const idx = args.findIndex(a => a === flag);
  if (idx >= 0) return true;
  // Support `--flag=value` form
  return args.some(a => a.startsWith(flag + '='));
}

export async function ensurePuppeteerConfigArg(args, opts = {}) {
  if (hasFlag(args, '--puppeteerConfigFile')) return args;
  const cfg = await locatePuppeteerConfig({ cwd: opts.cwd });
  if (cfg) return [...args, '--puppeteerConfigFile', cfg];
  return args;
}

export function spawnAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let stderr = '';
    if (p.stderr) p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', err => reject(err));
    p.on('exit', code => {
      if (code === 0) resolve({ code, stderr });
      else reject(new Error(`Command ${cmd} exited ${code}: ${stderr}`));
    });
  });
}

export async function spawnMmdc(userArgs, opts = {}) {
  const args = await ensurePuppeteerConfigArg(userArgs, { cwd: opts.cwd });
  return spawnAsync(MMDC_CMD, args, opts);
}


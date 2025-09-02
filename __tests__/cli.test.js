import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'sebastianjs');
const LOADER = path.join(ROOT, 'loader.mjs');

function runCLI(args = [], input = null, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['--experimental-loader', LOADER, CLI, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input != null) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

describe('CLI', () => {
  jest.setTimeout(30000);

  const def = 'graph TD; A[Start]-->B[End];';

  test('renders from stdin to stdout', async () => {
    const { code, stdout, stderr } = await runCLI(['-'], def);
    expect(code).toBe(0);
  // Allow Node experimental warnings on stderr
  expect(stdout).toContain('<svg');
  const openTag = stdout.match(/<svg[^>]*>/)?.[0] || '';
  expect(openTag).toContain('viewBox=');
  expect(openTag).not.toMatch(/\bwidth=\"/);
  expect(openTag).not.toMatch(/\bheight=\"/);
  });

  test('renders from file to stdout', async () => {
    const tmp = path.join(os.tmpdir(), `sebastianjs-cli-${Date.now()}.mmd`);
    await fs.writeFile(tmp, def, 'utf8');
    const { code, stdout, stderr } = await runCLI([tmp]);
    expect(code).toBe(0);
  // stderr may include experimental warnings
  expect(stdout).toContain('<svg');
    await fs.unlink(tmp).catch(() => {});
  });

  test('writes to output file with -o', async () => {
    const out = path.join(os.tmpdir(), `sebastianjs-cli-${Date.now()}.svg`);
    const { code, stdout, stderr } = await runCLI(['-', '-o', out], def);
    expect(code).toBe(0);
  // stderr may include experimental warnings
    expect(stdout).toBe('');
  const content = await fs.readFile(out, 'utf8');
  expect(content).toContain('<svg');
  const tag = content.match(/<svg[^>]*>/)?.[0] || '';
  expect(tag).toContain('viewBox=');
  expect(tag).not.toMatch(/\bwidth=\"/);
  expect(tag).not.toMatch(/\bheight=\"/);
    await fs.unlink(out).catch(() => {});
  });

  test('handles missing file with non-zero exit code', async () => {
    const { code, stdout, stderr } = await runCLI(['./does-not-exist.mmd']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/Failed to read input|ENOENT/);
  });

  test('supports theme flag', async () => {
    const { code, stdout, stderr } = await runCLI(['-', '-t', 'dark'], def);
    expect(code).toBe(0);
  // stderr may include experimental warnings
    expect(stdout).toContain('<svg');
  });
});

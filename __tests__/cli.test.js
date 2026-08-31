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

function runCLI(args = [], input = null, opts = {}) {
  return new Promise((resolve) => {
  const proc = spawn('node', [CLI, ...args], {
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
  // The diagram sizes itself from its own bounding box, exactly as mermaid does
  // in a browser and as mermaid-cli emits: width="100%" plus a max-width style,
  // with the real dimensions carried by the viewBox. It is deliberately NOT
  // stamped with the -W/-H viewport values.
  expect(openTag).toContain('viewBox=');
  expect(openTag).toMatch(/\bwidth="100%"/);
  expect(openTag).toMatch(/max-width:\s*[\d.]+px/);
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
  expect(tag).toMatch(/\bwidth="100%"/);
    await fs.unlink(out).catch(() => {});
  });

  test('-W/-H are viewport hints, not output dimensions', async () => {
    // Matches mermaid-cli, whose -w/-H set the Puppeteer viewport and leave the
    // emitted SVG's dimensions untouched.
    const { code, stdout } = await runCLI(['-', '-W', '1200', '-H', '700'], def);
    expect(code).toBe(0);
    const tag = stdout.match(/<svg[^>]*>/)?.[0] || '';
    expect(tag).toContain('viewBox=');
    expect(tag).not.toMatch(/\bwidth="1200"/);
    expect(tag).not.toMatch(/\bheight="700"/);
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

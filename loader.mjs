// ESM loader to alias 'dompurify' to our local stub for CLI runtime
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stubUrl = pathToFileURL(pathResolve(here, 'test/dompurify-stub.js')).href;

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === 'dompurify') {
    return { url: stubUrl, shortCircuit: true };
  }
  return defaultResolve(specifier, context, defaultResolve);
}

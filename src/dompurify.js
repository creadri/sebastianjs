/**
 * Prepares DOMPurify for Mermaid; support both factory and object default export.
 * @param {Window} win - The JSDOM window object.
 * @returns {Promise<Object>} - The DOMPurify instance.
 */
export async function ensureDomPurify(win) {
  const shim = () => {
    const purify = (html) => html;
    purify.sanitize = (html) => html;
    purify.addHook = () => {};
    purify.removeHook = () => {};
    return purify;
  };
  try {
    const mod = await import('dompurify');
    const dp = mod?.default ?? mod;
    // Patch the module export so downstream imports (e.g., Mermaid) see a sanitize API
    if (typeof dp === 'function') {
      if (typeof dp.sanitize !== 'function') dp.sanitize = (html) => html;
      if (!dp.addHook) dp.addHook = () => {};
      if (!dp.removeHook) dp.removeHook = () => {};
    } else if (dp && typeof dp === 'object') {
      if (typeof dp.sanitize !== 'function') dp.sanitize = (html) => html;
      if (!dp.addHook) dp.addHook = () => {};
      if (!dp.removeHook) dp.removeHook = () => {};
    }

    const inst = typeof dp === 'function' ? dp(win) : dp;
    if (typeof inst === 'function' && typeof inst.sanitize !== 'function') inst.sanitize = (html) => html;
    if (!inst || typeof inst.sanitize !== 'function') return shim();
    if (!inst.addHook) inst.addHook = () => {};
    if (!inst.removeHook) inst.removeHook = () => {};
    return inst;
  } catch (_) {
    return shim();
  }
}

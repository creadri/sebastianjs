// Minimal DOMPurify shim compatible with both factory and object usage.
// Default export is a function object with a .sanitize method and hook APIs.
function PurifyFactory(_window) {
  return PurifyFactory; // calling it returns itself (common factory pattern)
}

PurifyFactory.sanitize = (html) => html;
PurifyFactory.addHook = () => {};
PurifyFactory.removeHook = () => {};

export default PurifyFactory;
export const sanitize = (html) => PurifyFactory.sanitize(html);

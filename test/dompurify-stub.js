// Minimal DOMPurify stub for tests to satisfy Mermaid hooks
const hooks = new Map();

const DOMPurify = {
  addHook(name, fn) {
    hooks.set(name, fn);
  },
  removeHook(name) {
    hooks.delete(name);
  },
  sanitize(input) {
    // No-op sanitizer for tests
    return String(input);
  },
};

export default DOMPurify;

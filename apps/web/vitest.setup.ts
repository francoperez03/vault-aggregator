import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Radix's Slider (and other size-aware primitives) need one.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

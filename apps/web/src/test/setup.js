import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { installFakeFetch } from './fakeApi.js';

// Full-app renders under a loaded test runner can exceed the 1s default.
configure({ asyncUtilTimeout: 3000 });

// Every test starts signed in against a fresh in-memory API; tests may install their own fake.
beforeEach(() => {
  installFakeFetch();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  });
}

// Node 24's Request rejects jsdom's AbortSignal, and React Router builds one per navigation.
const NodeRequest = globalThis.Request;
globalThis.Request = class Request extends NodeRequest {
  #signal;
  constructor(input, init = {}) {
    const { signal, ...rest } = init ?? {};
    super(input, rest);
    this.#signal = signal;
  }
  get signal() {
    return this.#signal ?? super.signal;
  }
};

// jsdom lacks these; cmdk and Radix call them.
if (!('ResizeObserver' in window)) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

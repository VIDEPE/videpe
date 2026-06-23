import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Stubs ResizeObserver as a no-op class, since jsdom doesn't implement it and it's required by @dnd-kit/dom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom doesn't implement matchMedia — provide a stub so components that read
// OS colour-scheme preference (ThemeProvider) don't crash during tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

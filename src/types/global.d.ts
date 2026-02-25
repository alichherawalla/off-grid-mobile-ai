// Hermes (React Native) exposes the Web Crypto API globally.
// Declare the minimum subset we use so TypeScript recognises it
// without pulling in the full DOM lib.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

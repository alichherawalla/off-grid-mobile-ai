/* eslint-disable no-console */
/**
 * Dev-only logger. All output is suppressed in production builds.
 * Use this instead of console.log/warn/error to satisfy security linters
 * that flag direct console calls as potential log-injection hotspots.
 */
const logger = {
  log: (...args: unknown[]): void => {
    if (__DEV__) {
      console.log(...args); // NOSONAR
    }
  },
  warn: (...args: unknown[]): void => {
    if (__DEV__) {
      console.warn(...args); // NOSONAR
    }
  },
  error: (...args: unknown[]): void => {
    if (__DEV__) {
      console.error(...args); // NOSONAR
    }
  },
};

export default logger;

/* Minimal structured logger (keeps dependencies small). */
const silent = process.env.NODE_ENV === "test";
const ts = () => new Date().toISOString();

export const logger = {
  info: (...args: unknown[]) => !silent && console.log(`[${ts()}] INFO `, ...args),
  warn: (...args: unknown[]) => !silent && console.warn(`[${ts()}] WARN `, ...args),
  error: (...args: unknown[]) => !silent && console.error(`[${ts()}] ERROR`, ...args),
};

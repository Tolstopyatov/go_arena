export interface Env {
  DB: D1Database; GAME_ROOMS: DurableObjectNamespace;
  BOT_TOKEN: string; WEBHOOK_SECRET: string;
  PAGES_ORIGIN: string; BOT_USERNAME: string; WORKER_URL: string;
}
export const TIMEOUT_MS = 3 * 24 * 3600 * 1000; // 3 дня
export const APP_URL = (env: Env) => `https://${env.PAGES_ORIGIN.replace("https://", "")}/go-arena/`;
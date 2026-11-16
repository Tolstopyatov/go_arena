export interface TgUser { id: number; first_name: string; last_name?: string; username?: string }
export async function validateInitData(initData: string, token: string, maxAge = 86400): Promise<TgUser> {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash"); if (!hash) throw new Error("no hash");
  p.delete("hash");
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", base, enc.encode(token));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(dcs)));
  const hex = [...sig].map(b => b.toString(16).padStart(2, "0")).join("");
  const a = enc.encode(hex), b = enc.encode(hash);
  if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) throw new Error("bad hash");
  if (Date.now() / 1000 - Number(p.get("auth_date") ?? 0) > maxAge) throw new Error("expired");
  return JSON.parse(p.get("user") ?? "null");
}
export async function authUser(req: Request, env: Env): Promise<TgUser> {
  const h = req.headers.get("Authorization") ?? "";
  if (!h.startsWith("tma ")) throw new Error("no auth");
  return validateInitData(h.slice(4), env.BOT_TOKEN);
}
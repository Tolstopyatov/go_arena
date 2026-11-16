import { GameRoom } from "./game-room";
import { authUser } from "./auth";
import { makeBot, acceptChallenge, tg } from "./bot";
import { ensureUser, registerMissed } from "./ratings";
import type { Env } from "./env";
export { GameRoom };

const json = (env: Env, data: unknown, status = 200) => Response.json(data, { status, headers: cors(env) });
const cors = (env: Env): Record<string, string> => ({
  "Access-Control-Allow-Origin": env.PAGES_ORIGIN,
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      ctx.waitUntil(makeBot(env).handleUpdate(await req.json()));
      return new Response("ok");
    }
    const gm = url.pathname.match(/^\/api\/games\/([\w-]+)(\/ws)?$/);
    if (gm) {
      const stub = env.GAME_ROOMS.getByName(gm[1]);
      return stub.fetch(gm[2] ? "https://do/ws" : "https://do/state");
    }
    let user; try { user = await authUser(req, env); } catch { return json(env, { error: "auth" }, 401); }
    const uid = String(user.id);
    await ensureUser(env, uid, [user.first_name, user.last_name].filter(Boolean).join(" "), user.username);
    if (url.pathname === "/api/lobby") {
      const [me, ladder, active, ch] = await Promise.all([
        env.DB.prepare("SELECT * FROM users WHERE id=?").bind(uid).first(),
        env.DB.prepare("SELECT id,name,rating,rd,wins,losses,position FROM users ORDER BY position LIMIT 50").all(),
        env.DB.prepare("SELECT * FROM active WHERE user_id=?").bind(uid).first(),
        env.DB.prepare("SELECT * FROM challenges WHERE target=? OR challenger=?").bind(uid, uid).all()]);
      return json(env, { me, ladder: ladder.results, active, challenges: ch.results });
    }
    if (url.pathname === "/api/challenge" && req.method === "POST") {
      const { target } = await req.json<{ target: string }>();
      if (!target || target === uid) return json(env, { error: "bad target" }, 400);
      const key = `${uid}_${target}`;
      await env.DB.prepare("INSERT OR REPLACE INTO challenges VALUES(?,?,?,?)").bind(key, uid, target, Number(target), Date.now()).run();
      ctx.waitUntil(tg(env, "sendMessage", { chat_id: target, text: "Вам вызов в арене Го!",
        reply_markup: { inline_keyboard: [[{ text: "Принять", callback_data: `acc_${key}` }, { text: "Отклонить", callback_data: `dec_${key}` }]] } }));
      return json(env, { ok: true, key });
    }
    const cm = url.pathname.match(/^\/api\/challenge\/([\w-]+)\/(accept|decline|cancel)$/);
    if (cm && req.method === "POST") {
      const [, key, act] = cm;
      if (act === "accept") { const g = await acceptChallenge(env, key, uid); return g ? json(env, g) : json(env, { error: "no" }, 400); }
      const ch = await env.DB.prepare("SELECT * FROM challenges WHERE key=?").bind(key).first<any>();
      if (!ch) return json(env, { error: "no" }, 400);
      if (act === "decline" && ch.target === uid) { await registerMissed(env, uid); }
      if (act === "cancel" && ch.challenger !== uid) return json(env, { error: "no" }, 403);
      await env.DB.prepare("DELETE FROM challenges WHERE key=?").bind(key).run();
      return json(env, { ok: true });
    }
    if (url.pathname === "/api/h2h") {
      const opp = url.searchParams.get("opp") ?? "";
      const rows = await env.DB.prepare("SELECT winner FROM archive WHERE (black=? AND white=?) OR (black=? AND white=?)")
        .bind(uid, opp, opp, uid).all<{ winner: string | null }>();
      const w = rows.results.filter(r => r.winner === uid).length, l = rows.results.filter(r => r.winner === opp).length;
      return json(env, { w, l, total: rows.results.length });
    }
    if (url.pathname === "/api/archive") {
      const rows = await env.DB.prepare("SELECT id,black,white,winner,result,size,ended_at FROM archive WHERE black=? OR white=? ORDER BY ended_at DESC LIMIT 50")
        .bind(uid, uid).all();
      return json(env, rows.results);
    }
    const am = url.pathname.match(/^\/api\/archive\/([\w-]+)$/);
    if (am) return json(env, await env.DB.prepare("SELECT * FROM archive WHERE id=?").bind(am[1]).first());
    return json(env, { error: "not found" }, 404);
  },
  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext) { // cron: вызовы старше 24ч = пропуск
    ctx.waitUntil((async () => {
      const old = await env.DB.prepare("SELECT * FROM challenges WHERE created_at<?").bind(Date.now() - 86400_000).all<any>();
      for (const ch of old.results) {
        await registerMissed(env, ch.target);
        await env.DB.prepare("DELETE FROM challenges WHERE key=?").bind(ch.key).run();
        await tg(env, "sendMessage", { chat_id: ch.chat_id, text: "Вызов истёк без ответа. Ответчику начислен пропуск." });
      }
    })());
  }
};
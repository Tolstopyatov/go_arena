import { Bot, InlineKeyboard } from "grammy";
import type { Env } from "./env";
import { APP_URL } from "./env";
import { ensureUser, registerMissed } from "./ratings";
import type { PlayerInfo } from "@go-arena/shared";

export const tg = (env: Env, method: string, payload: unknown) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});

export async function createGame(env: Env, p1: string, p2: string, chatId: number) {
  const u1 = await ensureUser(env, p1, ""), u2 = await ensureUser(env, p2, "");
  const blackFirst = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 0; // нигири авто
  const black = blackFirst ? p1 : p2, white = blackFirst ? p2 : p1;
  const id = `${black}_${white}_${Date.now()}`;
  const pi = (u: typeof u1): PlayerInfo => ({ id: u.id, name: u.name || `id${u.id}`, rating: u.rating, rd: u.rd });
  const meta = { id, black, white, chatId, cfg: { size: 9, komi: 6.5, superko: "situational" as const },
    players: { black: pi(black === p1 ? u1 : u2), white: pi(white === p1 ? u1 : u2) },
    seq: 0, deadline: Date.now() + 3 * 86400_000, undoReq: null, finished: false };
  await env.GAME_ROOMS.getByName(id).fetch("https://do/init", { method: "POST", body: JSON.stringify(meta) });
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO active VALUES(?,?,?,?,?)").bind(black, id, 1, white, meta.deadline),
    env.DB.prepare("INSERT OR REPLACE INTO active VALUES(?,?,?,?,?)").bind(white, id, 2, black, meta.deadline)]);
  return { id, black, white };
}
export async function acceptChallenge(env: Env, key: string, uid: string) {
  const ch = await env.DB.prepare("SELECT * FROM challenges WHERE key=?").bind(key).first<any>();
  if (!ch || ch.target !== uid) return null;
  await env.DB.prepare("DELETE FROM challenges WHERE key=?").bind(key).run();
  await env.DB.prepare("UPDATE users SET missed=0 WHERE id=?").bind(uid).run();
  return createGame(env, ch.challenger, ch.target, ch.chat_id);
}

export function makeBot(env: Env) {
  const bot = new Bot(env.BOT_TOKEN);
  const appBtn = (label: string, startapp = "") =>
    new InlineKeyboard().webApp(label, `https://t.me/${env.BOT_USERNAME}/go${startapp ? `?startapp=${startapp}` : ""}`);
  bot.command("start", async ctx => {
    if (ctx.from) await ensureUser(env, String(ctx.from.id), ctx.from.first_name, ctx.from.username);
    await ctx.reply("Арена Го 9×9. Доска, лестница и архив — в мини-приложении.", { reply_markup: appBtn("Играть") });
  });
  bot.command("help", ctx => ctx.reply("/challenge @user или ответом на сообщение — вызов\n/rating — топ лестницы\nПартии и подсчёт — в мини-приложении."));
  bot.command("rating", async ctx => {
    const rows = await env.DB.prepare("SELECT name,rating,wins,losses FROM users ORDER BY position LIMIT 10").all<any>();
    await ctx.reply("Топ-10:\n" + rows.results.map((u, i) => `${i + 1}. ${u.name} — ${u.rating | 0} (${u.wins}/${u.losses})`).join("\n"));
  });
  bot.command("challenge", async ctx => {
    const msg = ctx.message!;
    let target: string | null = null;
    if (msg.reply_to_message?.from) target = String(msg.reply_to_message.from.id);
    else {
      const ent = (msg.entities ?? []).find(e => e.type === "mention");
      if (ent) {
        const un = msg.text!.substr(ent.offset, ent.length).replace("@", "").toLowerCase();
        target = (await env.DB.prepare("SELECT id FROM users WHERE lower(username)=?").bind(un).first<{ id: string }>())?.id ?? null;
        if (!target) return ctx.reply("Игрок мне неизвестен — вызови ответом на его сообщение.");
      }
    }
    if (!target || !ctx.from) return ctx.reply("Формат: /challenge @user или ответ на сообщение.");
    const me = String(ctx.from.id);
    if (target === me) return ctx.reply("Одолеть себя? Не сегодня.");
    await ensureUser(env, me, ctx.from.first_name, ctx.from.username);
    const key = `${me}_${target}`;
    await env.DB.prepare("INSERT OR REPLACE INTO challenges VALUES(?,?,?,?)").bind(key, me, target, msg.chat.id, Date.now()).run();
    await ctx.reply("Вызов отправлен. Ответьте:", { reply_markup: new InlineKeyboard()
      .text("Принять", `acc_${key}`).text("Отклонить", `dec_${key}`).row().text("Отменить", `can_${key}`) });
  });
  bot.callbackQuery(/^acc_(.+)$/, async ctx => {
    const g = await acceptChallenge(env, ctx.match[1], String(ctx.from.id));
    if (!g) return ctx.answerCallbackQuery({ text: "Это не ваша битва / вызов истёк.", show_alert: true });
    await ctx.editMessageText(`Партия началась! Чёрные: ${g.black === ctx.match[1].split("_")[0] ? "вызов" : "принявший"} — нигири решено автоматически.`,
      { reply_markup: appBtn("Открыть доску", `g_${g.id}`) });
    await ctx.answerCallbackQuery();
  });
  bot.callbackQuery(/^dec_(.+)$/, async ctx => {
    const key = ctx.match[1], uid = String(ctx.from.id);
    const ch = await env.DB.prepare("SELECT * FROM challenges WHERE key=?").bind(key).first<any>();
    if (!ch || ch.target !== uid) return ctx.answerCallbackQuery({ text: "Не получится.", show_alert: true });
    await env.DB.prepare("DELETE FROM challenges WHERE key=?").bind(key).run();
    await registerMissed(env, uid);
    await ctx.editMessageText("Вызов отклонён."); await ctx.answerCallbackQuery();
  });
  bot.callbackQuery(/^can_(.+)$/, async ctx => {
    const key = ctx.match[1];
    const ch = await env.DB.prepare("SELECT * FROM challenges WHERE key=?").bind(key).first<any>();
    if (!ch || ch.challenger !== String(ctx.from.id)) return ctx.answerCallbackQuery({ text: "Только автор.", show_alert: true });
    await env.DB.prepare("DELETE FROM challenges WHERE key=?").bind(key).run();
    await ctx.editMessageText("Вызов отменён."); await ctx.answerCallbackQuery();
  });
  return bot;
}
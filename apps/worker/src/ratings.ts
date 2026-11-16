import type { Env } from "./env";
import type { GoEngine } from "@go-arena/engine";
const S = 173.7178, TAU = 0.5, PERIOD_MS = 30 * 86400_000;

export function glickoUpdate(r: number, rd: number, vol: number, oppR: number, oppRD: number, score: number) {
  const mu = (r - 1500) / S, phi = rd / S, muj = (oppR - 1500) / S, phij = oppRD / S;
  const g = 1 / Math.sqrt(1 + 3 * phij * phij / (Math.PI * Math.PI));
  const E = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(-g * (mu - muj)))));
  const v = 1 / (g * g * E * (1 - E)), delta = v * (score - E), a = Math.log(vol * vol);
  const f = (x: number) => { const ex = Math.exp(x);
    return ex * (delta * delta - phi * phi - v - ex) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU); };
  let A = a, B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU; }
  let fA = f(A), fB = f(B);
  while (Math.abs(B - A) > 1e-6) { const C = A + (A - B) * fA / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2; B = C; fB = fC; }
  const nvol = Math.exp(A / 2), pstar = Math.sqrt(phi * phi + nvol * nvol);
  const nphi = 1 / Math.sqrt(1 / (pstar * pstar) + 1 / v);
  const nmu = mu + nphi * nphi * g * (score - E); // фикс bot.py: БЕЗ деления на v
  return { rating: 1500 + S * nmu, rd: S * nphi, vol: nvol };
}
function idleRD(rd: number, vol: number, lastAt: number, now: number): number {
  if (!lastAt) return rd; // новичок: простоя не было
  let phi = rd / S;
  const periods = Math.min(100, Math.floor((now - lastAt) / PERIOD_MS));
  for (let i = 0; i < periods; i++) phi = Math.sqrt(phi * phi + vol * vol);
  return Math.min(350, phi * S);
}

export interface UserRow { id: string; name: string; username: string | null; rating: number; rd: number; vol: number;
  position: number; wins: number; losses: number; missed: number; last_game_at: number }

export async function ensureUser(env: Env, id: string, name: string, username?: string | null): Promise<UserRow> {
  await env.DB.prepare(`INSERT INTO users(id,name,username,position,created_at)
    VALUES(?1,?2,?3,(SELECT COALESCE(MAX(position),0)+1 FROM users),?4)
    ON CONFLICT(id) DO UPDATE SET
      name=CASE WHEN ?2<>'' THEN ?2 ELSE users.name END,
      username=COALESCE(?3,users.username)`).bind(id, name, username ?? null, Date.now()).run();
  return (await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<UserRow>())!;
}
export function ladderTakePlace(env: Env, w: UserRow, l: UserRow) {
  if (w.position <= l.position) return [];
  return [
    env.DB.prepare("UPDATE users SET position=position+1 WHERE position>=? AND position<?").bind(l.position, w.position),
    env.DB.prepare("UPDATE users SET position=? WHERE id=?").bind(l.position, w.id)];
}
export async function registerMissed(env: Env, uid: string) {
  const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(uid).first<UserRow>();
  if (!u) return;
  const missed = u.missed + 1;
  if (missed >= 5) {
    const max = (await env.DB.prepare("SELECT MAX(position) m FROM users").first<{ m: number }>())!.m;
    const np = Math.min(u.position + 5, max);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET position=position-1 WHERE position>? AND position<=?").bind(u.position, np),
      env.DB.prepare("UPDATE users SET position=?, missed=0 WHERE id=?").bind(np, uid)]);
  } else await env.DB.prepare("UPDATE users SET missed=? WHERE id=?").bind(missed, uid).run();
}

// Атомарно: рейтинги + лестница + архив + очистка active. gameId — id партии из createGame.
export async function settleGame(env: Env, gameId: string, black: string, white: string,
  names: { black: string; white: string }, eng: GoEngine, result: string, chatId: number, size: number) {
  const b = await ensureUser(env, black, names.black), w = await ensureUser(env, white, names.white);
  const now = Date.now();
  const bRD = idleRD(b.rd, b.vol, b.last_game_at, now), wRD = idleRD(w.rd, w.vol, w.last_game_at, now);
  const winner = result.startsWith("B") ? black : result.startsWith("W") ? white : null;
  const sb = winner === black ? 1 : winner === white ? 0 : 0.5;
  const nb = glickoUpdate(b.rating, bRD, b.vol, w.rating, wRD, sb);
  const nw = glickoUpdate(w.rating, wRD, w.vol, b.rating, bRD, 1 - sb);
  const stmts = [
    env.DB.prepare("UPDATE users SET rating=?,rd=?,vol=?,wins=wins+?,losses=losses+?,last_game_at=? WHERE id=?")
      .bind(nb.rating, nb.rd, nb.vol, sb === 1 ? 1 : 0, sb === 0 ? 1 : 0, now, black),
    env.DB.prepare("UPDATE users SET rating=?,rd=?,vol=?,wins=wins+?,losses=losses+?,last_game_at=? WHERE id=?")
      .bind(nw.rating, nw.rd, nw.vol, sb === 0 ? 1 : 0, sb === 1 ? 1 : 0, now, white),
    env.DB.prepare("INSERT INTO archive(id,black,white,winner,result,size,sgf,chat_id,ended_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(gameId, black, white, winner, result, size, eng.sgf({ pb: names.black, pw: names.white }), chatId, now),
    env.DB.prepare("DELETE FROM active WHERE game_id=?").bind(gameId)];
  if (winner) stmts.push(...ladderTakePlace(env, winner === black ? b : w, winner === black ? w : b));
  await env.DB.batch(stmts);
}
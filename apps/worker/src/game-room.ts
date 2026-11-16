import { DurableObject } from "cloudflare:workers";
import { GoEngine, other, type Color, type GameConfig, type Serialized } from "@go-arena/engine";
import type { ClientMsg, ServerMsg, PlayerInfo } from "@go-arena/shared";
import { validateInitData } from "./auth";
import { settleGame } from "./ratings";
import { TIMEOUT_MS, type Env } from "./env";
import { tg } from "./bot";

interface Meta { id: string; black: string; white: string; chatId: number; cfg: GameConfig;
  players: { black: PlayerInfo; white: PlayerInfo }; seq: number; deadline: number;
  undoReq: Color | null; finished: boolean }
interface Att { uid: string; color: Color }
const ERR_RU: Record<string, string> = { bounds: "Вне доски", turn: "Сейчас не ваш ход", occupied: "Пункт занят",
  ko: "Ко: немедленный откат запрещён", superko: "Суперко: повтор позиции", suicide: "Самоубийственный ход", phase: "Не та фаза партии" };

export class GameRoom extends DurableObject<Env> {
  private meta?: Meta; private eng?: GoEngine;
  private async load() {
    if (this.meta) return;
    this.meta = await this.ctx.storage.get<Meta>("meta");
    const s = await this.ctx.storage.get<Serialized>("eng");
    if (s) this.eng = GoEngine.load(s); // реплей истории: состояние компактное (<128 КБ лимит DO)
  }
  private persist() { return this.ctx.storage.put({ meta: this.meta, eng: this.eng!.serialize() }); }
  private socks(color?: Color) {
    return this.ctx.getWebSockets().filter(ws => {
      const a = ws.deserializeAttachment() as Att | null;
      return a && (color === undefined || a.color === color);
    });
  }
  private send(ws: WebSocket, m: ServerMsg) { try { ws.send(JSON.stringify(m)); } catch {} }
  private broadcast(m: ServerMsg, only?: Color) { for (const ws of this.socks(only)) this.send(ws, m); }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/init") {
      this.meta = await req.json<Meta>(); this.eng = new GoEngine(this.meta.cfg);
      await this.persist(); await this.ctx.storage.setAlarm(this.meta.deadline);
      return Response.json({ ok: true });
    }
    await this.load();
    if (!this.meta || !this.eng) return new Response("no game", { status: 404 });
    if (path === "/state") return Response.json({ meta: this.meta, state: this.eng.view() });
    if (path === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("ws only", { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server); // hibernation: объект спит между ходами, не тарифицируется
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.load();
    if (!this.meta || !this.eng) return ws.close(1011, "no game");
    let msg: ClientMsg; try { msg = JSON.parse(raw as string); } catch { return; }
    const att = ws.deserializeAttachment() as Att | null;
    if (!att) { // первый кадр — авторизация
      if (msg.t !== "auth") return this.send(ws, { t: "error", code: "auth", msg: "Сначала auth" });
      try {
        const u = await validateInitData(msg.initData, this.env.BOT_TOKEN);
        const uid = String(u.id);
        const color: Color | 0 = uid === this.meta.black ? 1 : uid === this.meta.white ? 2 : 0;
        if (!color) { this.send(ws, { t: "error", code: "not_player", msg: "Вы не участник партии" }); return ws.close(1008); }
        ws.serializeAttachment({ uid, color } satisfies Att);
        this.send(ws, { t: "hello", you: color, gameId: this.meta.id, seq: this.meta.seq,
          state: this.eng.view(), deadline: this.meta.deadline, players: this.meta.players });
        this.broadcast({ t: "presence", online: true }, other(color));
      } catch { this.send(ws, { t: "error", code: "auth", msg: "initData невалиден" }); ws.close(1008); }
      return;
    }
    const c = att.color, e = this.eng, m = this.meta;
    const commit = async (events: (seq: number) => ServerMsg[], activity = true) => {
      m.seq++;
      if (activity && e.phase !== "finished") { m.deadline = Date.now() + TIMEOUT_MS; await this.ctx.storage.setAlarm(m.deadline); }
      await this.persist();
      for (const ev of events(m.seq)) this.broadcast(ev);
      this.broadcast({ t: "state", seq: m.seq, state: e.view(), deadline: m.deadline });
    };
    switch (msg.t) {
      case "sync": this.send(ws, { t: "state", seq: m.seq, state: e.view(), deadline: m.deadline }); break;
      case "move": {
        m.undoReq = null;
        const r = e.play(msg.x, msg.y, c);
        if (!r.ok) return this.send(ws, { t: "error", code: r.err, msg: ERR_RU[r.err] });
        await commit(seq => [{ t: "moved", seq, by: c, x: msg.x, y: msg.y, captured: r.captured }]);
        if (this.socks(other(c)).length === 0) // соперник офлайн → пуш «твой ход»
          this.ctx.waitUntil(tg(this.env, "sendMessage", { chat_id: other(c) === 1 ? m.black : m.white,
            text: "Ваш ход в партии Го.", reply_markup: { inline_keyboard: [[{ text: "Открыть доску", web_app: { url: `https://t.me/${this.env.BOT_USERNAME}/go?startapp=g_${m.id}` } }]] } }));
        break;
      }
      case "pass": {
        const r = e.pass(c);
        if (!r.ok) return this.send(ws, { t: "error", code: "turn", msg: ERR_RU.turn });
        await commit(seq => [{ t: "passed", seq, by: c },
          ...(r.scoring ? [{ t: "scoring" as const, seq, state: e.view(), suggestedDead: e.suggestDead() }] : [])]);
        break;
      }
      case "resign": { const r = e.resign(c); if (r) await this.finish(r, "Соперник сдался."); break; }
      case "undo_req": {
        const last = e.moves[e.moves.length - 1];
        if (e.phase !== "play" || !last || last.c !== c || m.undoReq)
          return this.send(ws, { t: "error", code: "undo_pending", msg: "Откат просит тот, кто сделал последний ход" });
        m.undoReq = c; await this.persist();
        this.broadcast({ t: "undo_req", by: c });
        break;
      }
      case "undo_reply": {
        if (!m.undoReq || m.undoReq === c) return;
        const req = m.undoReq; m.undoReq = null;
        if (msg.ok) { e.undo(); await commit(seq => [{ t: "undone", seq, by: req }]); }
        else { await this.persist(); this.broadcast({ t: "undo_denied", by: c }); }
        break;
      }
      case "mark_dead": if (!e.toggleDeadGroup(msg.i)) return this.send(ws, { t: "error", code: "phase", msg: ERR_RU.phase }); await commit(() => []); break;
      case "mark_neutral": if (!e.toggleNeutralRegion(msg.i)) return this.send(ws, { t: "error", code: "phase", msg: ERR_RU.phase }); await commit(() => []); break;
      case "confirm": { const r = e.confirm(c); if (r.done) await this.finish(r.result!, "Подсчёт завершён."); else await commit(() => []); break; }
      case "resume": if (!e.resume()) return; await commit(() => []); break;
    }
  }
  async webSocketClose(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Att | null;
    if (a && this.socks(a.color).length === 0) this.broadcast({ t: "presence", online: false }, other(a.color));
  }
  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws); }

  async alarm() { // таймаут 3 дня = тех. поражение тому, чей ход
    await this.load();
    if (!this.meta || !this.eng || this.meta.finished) return;
    if (Date.now() < this.meta.deadline - 1000) return this.ctx.storage.setAlarm(this.meta.deadline);
    const r = this.eng.timeout();
    if (r) await this.finish(r, "Таймаут 3 дня: тех. поражение стороне, чей был ход.");
  }
  private async finish(result: string, note: string) {
    const m = this.meta!, e = this.eng!;
    if (m.finished) return;
    m.finished = true; m.seq++;
    await this.persist(); await this.ctx.storage.deleteAlarm();
    this.broadcast({ t: "result", seq: m.seq, result, state: e.view() });
    await settleGame(this.env, m.id, m.black, m.white,
      { black: m.players.black.name, white: m.players.white.name }, e, result, m.chatId, m.cfg.size);
    await this.ctx.storage.deleteAll(); // партия ушла в архив D1, объект больше не нужен
    this.ctx.waitUntil(tg(this.env, "sendMessage", { chat_id: m.chatId,
      text: `Партия завершена: ${result}\n${note}\nSGF — в архиве мини-приложения.` }));
  }
}
export const BLACK = 1 as const;
export const WHITE = 2 as const;
export type Color = typeof BLACK | typeof WHITE;
export const other = (c: Color): Color => (c === BLACK ? WHITE : BLACK);
export const pointXY = (i: number, n: number): [number, number] => [i % n, (i / n) | 0];

export type SuperkoMode = "situational" | "positional" | "none";
export interface GameConfig { size: number; komi: number; superko: SuperkoMode }
export const defaultConfig = (size = 9): GameConfig => ({ size, komi: 6.5, superko: "situational" });

export interface MoveRec { c: Color; p: number | null } // null = pass
export type Phase = "play" | "scoring" | "finished";
export type ErrCode = "bounds" | "turn" | "occupied" | "ko" | "superko" | "suicide" | "phase";
export type PlayResult = { ok: true; captured: number[] } | { ok: false; err: ErrCode };
export interface ScoreBreakdown {
  territory: [number, number]; prisoners: [number, number];
  komi: number; total: [number, number]; diff: number;
}
export interface Serialized {
  cfg: GameConfig; moves: MoveRec[]; phase: Phase; dead: number[]; neutral: number[];
  confirms: [string | null, string | null]; result: string | null;
}
export interface SgfMeta { pb: string; pw: string; dt?: string; ap?: string }

const LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go-нотация: I пропускается
export const coordLabel = (x: number, y: number, n: number): string => `${LETTERS[x]}${n - y}`;
export function parseCoord(s: string, n: number): number | null {
  const m = /^([A-HJ-T])(\d{1,2})$/i.exec(s.trim());
  if (!m) return null;
  const x = LETTERS.indexOf(m[1].toUpperCase()), y = n - parseInt(m[2], 10);
  return x >= 0 && x < n && y >= 0 && y < n ? y * n + x : null;
}
export function hoshi(n: number): number[] {
  if (n === 19) { const a = [3, 9, 15]; return a.flatMap(y => a.map(x => y * n + x)); }
  if (n === 13) return [3, 9].flatMap(y => [3, 9].map(x => y * n + x)).concat([6 * n + 6]);
  if (n === 9) return [2, 6].flatMap(y => [2, 6].map(x => y * n + x)).concat([4 * n + 4]);
  return [];
}

// Детерминированный PRNG: ключи Зобриста одинаковы на сервере и клиенте
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
type RT = { b: number[]; cap: [number, number]; ko: number | null; pc: number; t: Color; h1: number; h2: number };

export class GoEngine {
  readonly cfg: GameConfig; readonly n: number;
  moves: MoveRec[] = [];
  board: number[]; turn: Color = BLACK;
  captures: [number, number] = [0, 0]; // пленники ЧЁРНЫХ / БЕЛЫХ (камни, взятые ими)
  koPoint: number | null = null; passCount = 0;
  phase: Phase = "play";
  dead = new Set<number>(); neutral = new Set<number>();
  confirms: [string | null, string | null] = [null, null];
  result: string | null = null;

  private z1: Uint32Array; private z2: Uint32Array; private ts1: number; private ts2: number;
  private h1 = 0; private h2 = 0; private keys = new Set<string>();

  constructor(cfg: GameConfig = defaultConfig(), moves: MoveRec[] = []) {
    if (!Number.isInteger(cfg.size) || cfg.size < 5 || cfg.size > 19) throw new Error("size must be 5..19");
    this.cfg = { ...cfg }; this.n = cfg.size;
    this.board = new Array(this.n * this.n).fill(0);
    const rnd = mulberry32(0x9e3779b9 ^ cfg.size);
    this.z1 = new Uint32Array(this.n * this.n * 2); this.z2 = new Uint32Array(this.n * this.n * 2);
    for (let i = 0; i < this.z1.length; i++) { this.z1[i] = rnd(); this.z2[i] = rnd(); }
    this.ts1 = rnd(); this.ts2 = rnd();
    this.keys.add(this.posKey());
    for (const m of moves) { m.p === null ? this.placePass(m.c) : this.place(m.p, m.c); this.commit(m); }
  }

  // ---------- позиции / тесты / будущие задачи-цумэго ----------
  static fromBoard(cfg: GameConfig, board: number[], turn: Color = BLACK): GoEngine {
    const e = new GoEngine(cfg);
    e.board = board.slice(); e.turn = turn; e.h1 = 0; e.h2 = 0;
    for (let i = 0; i < board.length; i++) if (board[i]) e.xor(i, board[i] as Color);
    e.keys = new Set([e.posKey()]);
    return e;
  }

  // ---------- внутреннее ----------
  private *nbrs(i: number): Generator<number> {
    const x = i % this.n, y = (i / this.n) | 0;
    if (x > 0) yield i - 1;
    if (x < this.n - 1) yield i + 1;
    if (y > 0) yield i - this.n;
    if (y < this.n - 1) yield i + this.n;
  }
  group(i: number): { stones: number[]; libs: Set<number> } {
    const col = this.board[i], stones = new Set<number>(), libs = new Set<number>(), st = [i];
    while (st.length) {
      const j = st.pop()!;
      if (stones.has(j)) continue;
      stones.add(j);
      for (const k of this.nbrs(j)) {
        const v = this.board[k];
        if (v === 0) libs.add(k);
        else if (v === col && !stones.has(k)) st.push(k);
      }
    }
    return { stones: [...stones], libs };
  }
  private xor(i: number, c: Color) { const k = i * 2 + (c - 1); this.h1 ^= this.z1[k]; this.h2 ^= this.z2[k]; }
  private posKey(): string {
    let a = this.h1, b = this.h2;
    if (this.cfg.superko === "situational" && this.turn === WHITE) { a ^= this.ts1; b ^= this.ts2; }
    return `${a >>> 0}:${b >>> 0}`;
  }
  private place(p: number, c: Color): number[] {
    this.board[p] = c; this.xor(p, c);
    const opp = other(c), captured: number[] = [], done = new Set<number>();
    for (const k of this.nbrs(p)) {
      if (this.board[k] === opp && !done.has(k)) {
        const g = this.group(k);
        if (g.libs.size === 0) for (const j of g.stones) { this.board[j] = 0; this.xor(j, opp); captured.push(j); }
        else for (const j of g.stones) done.add(j);
      }
    }
    this.captures[c - 1] += captured.length;
    const mine = this.group(p);
    this.koPoint = captured.length === 1 && mine.stones.length === 1 && mine.libs.size === 1 ? captured[0] : null;
    this.passCount = 0; this.turn = opp;
    return captured;
  }
  private placePass(c: Color) { this.passCount++; this.koPoint = null; this.turn = other(c); }
  private commit(m: MoveRec) {
    this.moves.push(m); this.keys.add(this.posKey());
    if (m.p === null && this.passCount >= 2 && this.phase === "play") this.phase = "scoring";
  }
  private save(): RT {
    return { b: this.board.slice(), cap: [...this.captures] as [number, number], ko: this.koPoint, pc: this.passCount, t: this.turn, h1: this.h1, h2: this.h2 };
  }
  private restore(s: RT) {
    this.board = s.b; this.captures = s.cap; this.koPoint = s.ko; this.passCount = s.pc; this.turn = s.t; this.h1 = s.h1; this.h2 = s.h2;
  }
  private rebuild(moves: MoveRec[]) {
    this.board.fill(0); this.turn = BLACK; this.captures = [0, 0]; this.koPoint = null; this.passCount = 0;
    this.h1 = 0; this.h2 = 0; this.keys = new Set([this.posKey()]); this.moves = [];
    this.phase = "play"; this.dead.clear(); this.neutral.clear(); this.confirms = [null, null]; this.result = null;
    for (const m of moves) { m.p === null ? this.placePass(m.c) : this.place(m.p, m.c); this.commit(m); }
  }
  private cleaned(): number[] { const b = this.board.slice(); for (const i of this.dead) b[i] = 0; return b; }
  private regionAt(b: number[], i: number): number[] {
    const reg = new Set<number>(), st = [i];
    while (st.length) {
      const j = st.pop()!;
      if (reg.has(j)) continue;
      reg.add(j);
      for (const k of this.nbrs(j)) if (b[k] === 0 && !reg.has(k)) st.push(k);
    }
    return [...reg];
  }

  // ---------- ходы ----------
  play(x: number, y: number, c: Color): PlayResult {
    if (this.phase !== "play") return { ok: false, err: "phase" };
    if (c !== this.turn) return { ok: false, err: "turn" };
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return { ok: false, err: "bounds" };
    const p = y * this.n + x;
    if (this.board[p] !== 0) return { ok: false, err: "occupied" };
    if (this.koPoint === p) return { ok: false, err: "ko" };
    const save = this.save();
    const captured = this.place(p, c);
    if (this.group(p).libs.size === 0) { this.restore(save); return { ok: false, err: "suicide" }; }
    if (this.cfg.superko !== "none" && this.keys.has(this.posKey())) { this.restore(save); return { ok: false, err: "superko" }; }
    this.commit({ c, p });
    return { ok: true, captured };
  }
  pass(c: Color): { ok: boolean; scoring: boolean } {
    if (this.phase !== "play" || c !== this.turn) return { ok: false, scoring: false };
    this.placePass(c); this.commit({ c, p: null });
    return { ok: true, scoring: this.phase === "scoring" };
  }
  // UNDO = реплей истории без последнего полухода (баг bot.py «history только из пассов» невозможен by design)
  undo(): boolean {
    if (this.phase !== "play" || this.moves.length === 0) return false;
    this.rebuild(this.moves.slice(0, -1));
    return true;
  }
  resume(): boolean { // «доиграть» из фазы подсчёта: снимаем два пасса и разметку
    if (this.phase !== "scoring") return false;
    const moves = this.moves.slice();
    for (let k = 0; k < 2 && moves.length && moves[moves.length - 1].p === null; k++) moves.pop();
    this.rebuild(moves);
    return true;
  }
  resign(c: Color): string | null {
    if (this.phase === "finished") return null;
    this.result = `${other(c) === BLACK ? "B" : "W"}+R`; this.phase = "finished"; return this.result;
  }
  timeout(): string | null { // тех. поражение тому, чей ход
    if (this.phase === "finished") return null;
    this.result = `${this.turn === BLACK ? "W" : "B"}+T`; this.phase = "finished"; return this.result;
  }

  // ---------- японский подсчёт ----------
  toggleDeadGroup(i: number): boolean {
    if (this.phase !== "scoring" || this.board[i] === 0) return false;
    const g = this.group(i).stones, mark = !this.dead.has(i);
    for (const j of g) mark ? this.dead.add(j) : this.dead.delete(j);
    this.confirms = [null, null];
    return true;
  }
  toggleNeutralRegion(i: number): boolean { // сэки: тап по региону (в т.ч. глазу группы сэки) делает его нейтральным
    if (this.phase !== "scoring" || !(this.board[i] === 0 || this.dead.has(i))) return false;
    const reg = this.regionAt(this.cleaned(), i), off = reg.some(j => this.neutral.has(j));
    for (const j of reg) off ? this.neutral.delete(j) : this.neutral.add(j);
    this.confirms = [null, null];
    return true;
  }
  marksHash(): string {
    const s = (a: Set<number>) => [...a].sort((x, y) => x - y);
    return JSON.stringify([s(this.dead), s(this.neutral)]);
  }
  score(): ScoreBreakdown {
    const b = this.cleaned();
    const pris: [number, number] = [this.captures[0], this.captures[1]];
    for (const i of this.dead) if (this.board[i]) pris[other(this.board[i] as Color) - 1]++;
    const terr: [number, number] = [0, 0], seen = new Set<number>();
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== 0 || seen.has(i)) continue;
      const reg = this.regionAt(b, i);
      for (const j of reg) seen.add(j);
      if (reg.some(j => this.neutral.has(j))) continue; // сэки / дамэ вручную
      const borders = new Set<number>();
      for (const j of reg) for (const k of this.nbrs(j)) if (b[k]) borders.add(b[k]);
      if (borders.size === 1) terr[[...borders][0] - 1] += reg.length; // дамэ (оба цвета) = 0 автоматически
    }
    const total: [number, number] = [terr[0] + pris[0], terr[1] + pris[1] + this.cfg.komi];
    return { territory: terr, prisoners: pris, komi: this.cfg.komi, total, diff: total[0] - total[1] };
  }
  confirm(c: Color): { done: boolean; result?: string; score?: ScoreBreakdown } {
    if (this.phase !== "scoring") return { done: false };
    this.confirms[c - 1] = this.marksHash();
    if (this.confirms[0] !== null && this.confirms[0] === this.confirms[1]) {
      const s = this.score();
      this.result = s.diff > 0 ? `B+${s.diff}` : s.diff < 0 ? `W+${-s.diff}` : "0";
      this.phase = "finished";
      return { done: true, result: this.result, score: s };
    }
    return { done: false };
  }
  suggestDead(): number[] { // эвристика-подсказка для UI: без глаз + все соседние регионы касаются соперника
    const out: number[] = [], visited = new Set<number>(), b = this.board;
    for (let i = 0; i < b.length; i++) {
      if (!b[i] || visited.has(i)) continue;
      const g = this.group(i); for (const j of g.stones) visited.add(j);
      const col = b[i] as Color, regs = new Set<number>();
      for (const j of g.stones) for (const k of this.nbrs(j)) if (b[k] === 0) regs.add(k);
      let eyes = 0;
      for (const k of regs) { let eye = true; for (const q of this.nbrs(k)) if (b[q] !== col) { eye = false; break; } if (eye) eyes++; }
      if (eyes !== 0 || regs.size === 0) continue;
      let surrounded = true;
      for (const k of regs) {
        let opp = false;
        for (const j of this.regionAt(b, k)) for (const q of this.nbrs(j)) if (b[q] === other(col)) opp = true;
        if (!opp) { surrounded = false; break; }
      }
      if (surrounded) out.push(...g.stones);
    }
    return out;
  }

  // ---------- сериализация / SGF / вид для клиента ----------
  serialize(): Serialized {
    return { cfg: this.cfg, moves: this.moves, phase: this.phase, dead: [...this.dead], neutral: [...this.neutral], confirms: this.confirms, result: this.result };
  }
  static load(s: Serialized): GoEngine {
    const e = new GoEngine(s.cfg, s.moves);
    e.phase = s.phase; e.dead = new Set(s.dead); e.neutral = new Set(s.neutral);
    e.confirms = s.confirms; e.result = s.result;
    return e;
  }
  sgf(meta: SgfMeta): string {
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
    let s = `(;GM[1]FF[4]CA[UTF-8]AP[${esc(meta.ap ?? "GoArena")}]RU[Japanese]SZ[${this.n}]KM[${this.cfg.komi}]` +
      `PB[${esc(meta.pb)}]PW[${esc(meta.pw)}]DT[${meta.dt ?? new Date().toISOString().slice(0, 10)}]`;
    if (this.result) s += `RE[${this.result}]`;
    for (const m of this.moves) {
      const tag = m.c === BLACK ? "B" : "W";
      s += m.p === null ? `;${tag}[]`
        : `;${tag}[${String.fromCharCode(97 + (m.p % this.n))}${String.fromCharCode(97 + ((m.p / this.n) | 0))}]`;
    }
    return s + ")";
  }
  view() {
    return {
      size: this.n, komi: this.cfg.komi, board: this.board.slice(), turn: this.turn,
      captures: [...this.captures] as [number, number], koPoint: this.koPoint, passCount: this.passCount,
      moveNumber: this.moves.length, lastMove: this.moves.length ? this.moves[this.moves.length - 1] : null,
      phase: this.phase, dead: [...this.dead], neutral: [...this.neutral], confirms: this.confirms, result: this.result,
    };
  }
}
export type GameView = ReturnType<GoEngine["view"]>;
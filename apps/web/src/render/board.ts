import { hoshi, pointXY, type Color, type GameView } from "@go-arena/engine";
import type { LoadedTheme } from "../theme/types";
export const CELL = 16, PAD = 10, FRAME = 3; // арт-пиксели

function boardArt(t: LoadedTheme, n: number): HTMLCanvasElement {
  const W = (n - 1) * CELL + (PAD + FRAME) * 2;
  const c = document.createElement("canvas"); c.width = W; c.height = W;
  const g = c.getContext("2d")!;
  g.fillStyle = t.palette.frame; g.fillRect(0, 0, W, W);
  g.fillStyle = t.palette.board; g.fillRect(FRAME, FRAME, W - 2 * FRAME, W - 2 * FRAME);
  g.fillStyle = t.palette.grid;
  const o = FRAME + PAD, L = (n - 1) * CELL;
  for (let i = 0; i < n; i++) { g.fillRect(o, o + i * CELL, L + 1, 1); g.fillRect(o + i * CELL, o, 1, L + 1); }
  for (const i of hoshi(n)) { const [x, y] = pointXY(i, n); g.fillRect(o + x * CELL - 1, o + y * CELL - 1, 3, 3); }
  return c;
}
export class BoardRenderer {
  readonly art: HTMLCanvasElement; scale = 1; private origin = FRAME + PAD;
  constructor(readonly cv: HTMLCanvasElement, readonly theme: LoadedTheme, readonly n: number) { this.art = boardArt(theme, n); }
  resize(availW: number, availH: number) {
    const W = this.art.width;
    this.scale = Math.max(1, Math.floor(Math.min(availW / W, availH / W))); // целочисленный масштаб = честный пиксель-арт
    this.cv.width = this.cv.height = W * this.scale;
    this.cv.style.width = this.cv.style.height = `${W * this.scale}px`;
  }
  pointCss(x: number, y: number): [number, number] {
    return [(this.origin + x * CELL) * this.scale, (this.origin + y * CELL) * this.scale];
  }
  hit(cssX: number, cssY: number): { x: number; y: number } | null {
    const r = this.cv.getBoundingClientRect();
    const ax = (cssX - r.left) / this.scale, ay = (cssY - r.top) / this.scale;
    const x = Math.round((ax - this.origin) / CELL), y = Math.round((ay - this.origin) / CELL);
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return null;
    const px = this.origin + x * CELL, py = this.origin + y * CELL;
    return Math.hypot(ax - px, ay - py) <= CELL * 0.6 ? { x, y } : null;
  }
  draw(v: GameView, o: { hide?: number | null; ghost?: { x: number; y: number; c: Color } | null } = {}) {
    const g = this.cv.getContext("2d")!, s = this.scale;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.drawImage(this.art, 0, 0, this.cv.width, this.cv.height);
    const stone = (c: Color) => (c === 1 ? this.theme.black : this.theme.white);
    const put = (i: number, c: Color, alpha = 1) => {
      const [x, y] = pointXY(i, this.n), [px, py] = this.pointCss(x, y), img = stone(c);
      g.globalAlpha = alpha;
      g.drawImage(img, px - (img.width * s) / 2, py - (img.height * s) / 2, img.width * s, img.height * s);
      g.globalAlpha = 1;
    };
    for (let i = 0; i < v.board.length; i++) {
      const c = v.board[i] as Color;
      if (!c || i === o.hide) continue;
      put(i, c, v.dead.includes(i) ? 0.45 : 1);
      if (v.lastMove?.p === i) {
        const [x, y] = pointXY(i, this.n), [px, py] = this.pointCss(x, y);
        g.strokeStyle = c === 1 ? "#F8F8F8" : "#000000"; g.lineWidth = s;
        g.strokeRect(px - 2 * s, py - 2 * s, 4 * s, 4 * s);
      }
    }
    for (const i of v.neutral) {
      const [x, y] = pointXY(i, this.n), [px, py] = this.pointCss(x, y);
      g.fillStyle = this.theme.palette.accent; g.fillRect(px - s, py - s, 2 * s, 2 * s);
    }
    if (o.ghost) put(o.ghost.y * this.n + o.ghost.x, o.ghost.c, 0.5);
  }
}
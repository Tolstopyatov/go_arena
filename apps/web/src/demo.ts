// demo.ts — локальный просмотр доски и руки БЕЗ бэкенда
import "./style.css";
import { GoEngine, BLACK, WHITE, coordLabel, pointXY, type Color } from "@go-arena/engine";
import { THEMES } from "./theme/themes";
import { loadTheme } from "./theme/sprites";
import { BoardRenderer } from "./render/board";
import { Hand } from "./render/hand";
import { sfxPlace, sfxCapture, toggleSound } from "./sfx";

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="plate" id="p2"><img id="b2"><span class="name">Белые</span><span id="c2">0</span></div>
  <div id="wrap"><canvas id="board"></canvas><canvas id="hand"></canvas></div>
  <div id="bar">ход 1</div>
  <div class="plate" id="p1"><img id="b1"><span class="name">Чёрные</span><span id="c1">0</span></div>
  <div id="ctrl">
    <button id="opp">Ход соперника (рука)</button><button id="snd">Звук: вкл</button>
    <select id="theme">${THEMES.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}</select>
  </div>`;
const cv = document.getElementById("board") as HTMLCanvasElement;
const hv = document.getElementById("hand") as HTMLCanvasElement;
const eng = new GoEngine();
let theme = await loadTheme(THEMES[0]);
let rnd = new BoardRenderer(cv, theme, eng.n);
let hand = new Hand(hv, theme.hand, rnd.scale);
let hide: number | null = null;

function applyCss() {
  const p = theme.palette, r = document.documentElement.style;
  r.setProperty("--bg", p.bg); r.setProperty("--text", p.text); r.setProperty("--plate", p.plate);
  r.setProperty("--plateText", p.plateText); r.setProperty("--accent", p.accent);
  (document.getElementById("b1") as HTMLImageElement).src = theme.bowl.toDataURL();
  (document.getElementById("b2") as HTMLImageElement).src = theme.bowl.toDataURL();
}
function layout() {
  rnd.resize(Math.min(innerWidth - 16, 420), innerHeight - 190);
  hv.width = cv.width; hv.height = cv.height;
  hv.style.width = cv.style.width; hv.style.height = cv.style.height;
  hand = new Hand(hv, theme.hand, rnd.scale);
  draw();
}
function draw() {
  rnd.draw(eng.view(), { hide });
  const v = eng.view();
  (document.getElementById("c1") as HTMLElement).textContent = String(v.captures[0]);
  (document.getElementById("c2") as HTMLElement).textContent = String(v.captures[1]);
  const last = v.lastMove?.p != null ? coordLabel(...pointXY(v.lastMove.p, eng.n), eng.n) : "—";
  (document.getElementById("bar") as HTMLElement).textContent =
    `ход ${v.moveNumber + 1} · ${v.turn === BLACK ? "чёрные" : "белые"} · ${last}`;
}
cv.addEventListener("pointerdown", e => {
  if (hand.playing) { hand.cancel(); return; } // тап = скип анимации
  const h = rnd.hit(e.clientX, e.clientY);
  if (!h || eng.turn !== BLACK) return;
  const r = eng.play(h.x, h.y, BLACK);
  if (r.ok) { sfxPlace(); if (r.captured.length) sfxCapture(); navigator.vibrate?.(10); draw(); }
});
document.getElementById("opp")!.addEventListener("click", async () => {
  if (eng.turn !== WHITE || eng.phase !== "play") return;
  const empties = eng.board.map((v, i) => (v === 0 ? i : -1)).filter(i => i >= 0);
  for (const i of empties.sort(() => Math.random() - 0.5)) {
    const [x, y] = pointXY(i, eng.n);
    if (!eng.play(x, y, WHITE).ok) continue;
    hide = i; draw(); // камень спрятан, пока рука его не «поставит»
    const [tx, ty] = rnd.pointCss(x, y);
    await hand.play(tx, ty, () => { hide = null; sfxPlace(); draw(); });
    return;
  }
});
document.getElementById("snd")!.addEventListener("click", e => {
  const on = toggleSound(); (e.target as HTMLElement).textContent = `Звук: ${on ? "вкл" : "выкл"}`;
});
document.getElementById("theme")!.addEventListener("change", async e => {
  theme = await loadTheme(THEMES.find(t => t.id === (e.target as HTMLSelectElement).value)!);
  rnd = new BoardRenderer(cv, theme, eng.n); applyCss(); layout();
});
addEventListener("resize", layout);
applyCss(); layout();
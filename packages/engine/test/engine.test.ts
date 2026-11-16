import { describe, it, expect } from "vitest";
import { GoEngine, defaultConfig, BLACK, WHITE, coordLabel, parseCoord, hoshi, type Color } from "../src/engine";

const diagram = (rows: string[], turn: Color = BLACK, size = rows.length) => {
  const b: number[] = [];
  for (const r of rows) for (const ch of r) b.push(ch === "X" ? 1 : ch === "O" ? 2 : 0);
  return GoEngine.fromBoard(defaultConfig(size), b, turn);
};

describe("ходы", () => {
  it("захват в углу", () => {
    const e = diagram(["O........", "X........", ".........", ".........", ".........", ".........", ".........", ".........", "........."]);
    const r = e.play(0, 1, BLACK);
    expect(r.ok).toBe(true);
    expect(e.board[0]).toBe(0);
    expect(e.captures[0]).toBe(1);
  });
  it("суицид запрещён и не меняет состояние", () => {
    const e = diagram([".O.......", "O........", ".........", ".........", ".........", ".........", ".........", ".........", "........."]);
    const before = e.board.slice();
    expect(e.play(0, 0, BLACK)).toEqual({ ok: false, err: "suicide" });
    expect(e.board).toEqual(before);
    expect(e.turn).toBe(BLACK);
  });
  it("ко: немедленный откат запрещён, после хода в другом месте — разрешён", () => {
    const e = diagram([".XO......", "XO.O.....", ".XO......", ".........", ".........", ".........", ".........", ".........", "........."]);
    expect(e.play(2, 1, BLACK).ok).toBe(true);
    expect(e.koPoint).toBe(1 * 9 + 1);
    expect(e.play(1, 1, WHITE)).toEqual({ ok: false, err: "ko" });
    e.play(8, 8, WHITE); e.play(0, 8, BLACK);
    expect(e.play(1, 1, WHITE).ok).toBe(true);
  });
  it("undo реплеем восстанавливает доски, пленников, ко и очередь", () => {
    const e = diagram([".XO......", "XO.O.....", ".XO......", ".........", ".........", ".........", ".........", ".........", "........."]);
    const before = e.view();
    e.play(2, 1, BLACK); e.undo();
    expect(e.view()).toEqual(before);
  });
});

describe("подсчёт (японские, 5x5 для наглядности)", () => {
  const walls = () => diagram(["..XO.", "..XO.", "..XO.", "..XO.", "..XO."], BLACK, 5);
  it("территория + коми: W+1.5", () => {
    const e = walls(); e.pass(BLACK); e.pass(WHITE);
    expect(e.phase).toBe("scoring");
    expect(e.confirm(BLACK).done).toBe(false);
    const r = e.confirm(WHITE);
    expect(r.done).toBe(true); expect(r.result).toBe("W+1.5");
  });
  it("мёртвая группа = пленники + территория; разметка сбрасывает подтверждения", () => {
    const e = walls(); e.board[0] = 2; // белый камень в зоне чёрных
    e.pass(BLACK); e.pass(WHITE);
    expect(e.score().total).toEqual([0, 11.5]); // регион стал дамэ
    e.confirm(BLACK);
    e.toggleDeadGroup(0);
    expect(e.confirms).toEqual([null, null]);
    expect(e.score().total).toEqual([11, 11.5]);
    e.confirm(BLACK); expect(e.confirm(WHITE).result).toBe("W+0.5");
  });
  it("сэки: нейтральный регион не считается территорией", () => {
    const e = walls(); e.pass(BLACK); e.pass(WHITE);
    e.toggleNeutralRegion(0);
    expect(e.score().total).toEqual([0, 11.5]);
  });
  it("resume снимает пассы и разметку", () => {
    const e = walls(); e.pass(BLACK); e.pass(WHITE); e.toggleNeutralRegion(0);
    expect(e.resume()).toBe(true);
    expect(e.phase).toBe("play"); expect(e.passCount).toBe(0); expect(e.neutral.size).toBe(0);
  });
});

describe("SGF / координаты / размеры", () => {
  it("9x9: край = ii (не jj), пасс, экранирование, RU/KM", () => {
    const e = new GoEngine(defaultConfig(9));
    e.play(8, 8, BLACK); e.pass(WHITE); e.resign(WHITE);
    const s = e.sgf({ pb: "a]b\\c", pw: "White" });
    expect(s).toContain(";B[ii]"); expect(s).toContain(";W[]");
    expect(s).toContain("PB[a\\]b\\\\c]"); expect(s).toContain("SZ[9]KM[6.5]");
    expect(s).toContain("RU[Japanese]"); expect(s).toContain("RE[B+R]");
  });
  it("нотация пропускает I", () => {
    expect(coordLabel(8, 8, 9)).toBe("J1");
    expect(parseCoord("J1", 9)).toBe(80);
    expect(parseCoord("I1", 9)).toBeNull();
  });
  it("13x13 и 19x19 работают, хоси корректны", () => {
    for (const n of [13, 19]) {
      const e = new GoEngine(defaultConfig(n));
      expect(e.play(n - 1, n - 1, BLACK).ok).toBe(true);
      expect(e.sgf({ pb: "B", pw: "W" })).toContain(`SZ[${n}]`);
    }
    expect(hoshi(9).length).toBe(5); expect(hoshi(13).length).toBe(5); expect(hoshi(19).length).toBe(9);
  });
  it("сериализация = реплей без потерь", () => {
    const e = new GoEngine(); e.play(2, 2, BLACK); e.play(6, 6, WHITE); e.pass(BLACK);
    const l = GoEngine.load(JSON.parse(JSON.stringify(e.serialize())));
    expect(l.view()).toEqual(e.view());
  });
});
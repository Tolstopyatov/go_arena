import type { Color, ErrCode, GameView } from "@go-arena/engine";

export interface PlayerInfo { id: string; name: string; rating: number; rd: number }

export type ClientMsg =
  | { t: "auth"; initData: string }
  | { t: "move"; x: number; y: number }
  | { t: "pass" } | { t: "resign" }
  | { t: "undo_req" } | { t: "undo_reply"; ok: boolean }
  | { t: "mark_dead"; i: number } | { t: "mark_neutral"; i: number }
  | { t: "confirm" } | { t: "resume" }
  | { t: "sync"; seq: number };

export type ServerMsg =
  | { t: "hello"; you: Color; gameId: string; seq: number; state: GameView; deadline: number;
      players: { black: PlayerInfo; white: PlayerInfo } }
  | { t: "state"; seq: number; state: GameView; deadline: number }
  | { t: "moved"; seq: number; by: Color; x: number; y: number; captured: number[] } // ← триггер анимации руки
  | { t: "passed"; seq: number; by: Color }
  | { t: "undone"; seq: number; by: Color }
  | { t: "undo_req"; by: Color } | { t: "undo_denied"; by: Color }
  | { t: "scoring"; seq: number; state: GameView; suggestedDead: number[] }
  | { t: "result"; seq: number; result: string; state: GameView }
  | { t: "presence"; online: boolean }
  | { t: "error"; code: ErrCode | "auth" | "not_player" | "no_game" | "undo_pending"; msg: string };
import { BLACK_STONE, WHITE_STONE, HAND_OPEN, HAND_PRESS, BOWL, type Theme } from "./types";
export const FAMICOM: Theme = {
  id: "famicom", name: "Famicom",
  palette: { bg: "#000000", board: "#C84C0C", grid: "#000000", frame: "#F8B800",
    plate: "#0000FC", plateText: "#FFFFFF", accent: "#00E8D8", text: "#FFFFFF" },
  stones: { black: BLACK_STONE, white: WHITE_STONE },
  hand: { frames: [HAND_OPEN, HAND_PRESS] }, bowl: BOWL };
export const ZEN: Theme = {
  id: "zen", name: "Zen",
  palette: { bg: "#101418", board: "#DCB35C", grid: "#4A3517", frame: "#8A6A30",
    plate: "#203040", plateText: "#FFFFFF", accent: "#D0A040", text: "#E8E0D0" },
  stones: { black: { ...BLACK_STONE, palette: { o: "#101010", b: "#282828", h: "#909090" } }, white: WHITE_STONE },
  hand: { frames: [HAND_OPEN, HAND_PRESS] }, bowl: { ...BOWL, palette: { o: "#101010", R: "#8A6A30", r: "#DCB35C" } } };
export const THEMES = [FAMICOM, ZEN];
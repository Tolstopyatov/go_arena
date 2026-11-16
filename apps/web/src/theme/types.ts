export type Pixels = { pixels: string[]; palette: Record<string, string> };
export type SpriteSource = Pixels | { url: string };
export interface Theme {
  id: string; name: string;
  palette: { bg: string; board: string; grid: string; frame: string; plate: string; plateText: string; accent: string; text: string };
  stones: { black: SpriteSource; white: SpriteSource };
  hand: { frames: SpriteSource[] };
  bowl: SpriteSource;
  sounds?: { place?: string; capture?: string };
}
export interface LoadedTheme extends Omit<Theme, "stones" | "hand" | "bowl"> {
  black: HTMLCanvasElement; white: HTMLCanvasElement; hand: HTMLCanvasElement[]; bowl: HTMLCanvasElement;
}

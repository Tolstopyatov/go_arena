export const BLACK_STONE: Pixels = { palette: { o: "#000000", b: "#101010", h: "#F8F8F8" }, pixels: [
  "....oooo....", "..oobbbboo..", ".obbbbbbbbo.", ".obhbbbbbbo.", "obbhhbbbbbo",
  "obbbbbbbbbo", "obbbbbbbbbo", "obbbbbbbbbo", ".obbbbbbbbo.", ".obbbbbbbbo.", "..oobbbboo..", "....oooo...."] };
export const WHITE_STONE: Pixels = { palette: { o: "#000000", w: "#F8F8F8", h: "#FFFFFF", s: "#B8B8B8" }, pixels: [
  "....oooo....", "..oowwwwoo..", ".owwwwwwwwo.", ".owhwwwwwwo.", "owwwwwwwwwo",
  "owwwwwwwwwo", "owwwwwwwwso", ".owwwwwsso.", ".owwwwssso.", "..oowwssoo..", "....oooo...."] };
export const HAND_OPEN: Pixels = { palette: { k: "#FCA044", d: "#D87020", c: "#F8F8F8", B: "#0000FC" }, pixels: [
  ".kk..kk..kk...", ".kk..kk..kk.kk", ".kk..kk..kk.kk", ".kkkkkkkkkkkk.", ".kkkkkkkkkkkk.",
  "..kkkkkkkkkk..", "..kkkkkkkkkk..", "...kkkkkkkk...", "...kkdkkd kk...".replace(" ", ""),
  "....kkkkkk....", "....cccccc....", "....BBBBBB....", "....BBBBBB....", "....BBBBBB....", "....BBBBBB...."] };
export const HAND_PRESS: Pixels = { ...HAND_OPEN, pixels: [
  "..............", "..............", ".kk..kk..kk...", ".kk..kk..kk.kk", ".kkkkkkkkkkkk.",
  ".kkkkkkkkkkkk.", "..kkkkkkkkkk..", "..kkkkkkkkkk..", "...kkkkkkkk...", "...kkdkkdkk...",
  "....kkkkkk....", "....cccccc....", "....BBBBBB....", "....BBBBBB....", "....BBBBBB....", "....BBBBBB...."] };
export const BOWL: Pixels = { palette: { o: "#000000", R: "#C84C0C", r: "#F8B800" }, pixels: [
  "...oooooooo...", "..oRRRRRRRRo..", ".oRrroooorrRo.", ".oRo......oRo.", ".oRrroooorrRo.", "..oRRRRRRRRo..", "...oooooooo..."] };

export function pixelsToCanvas(p: Pixels): HTMLCanvasElement {
  const w = Math.max(...p.pixels.map(r => r.length)), h = p.pixels.length;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  p.pixels.forEach((row, y) => { for (let x = 0; x < row.length; x++) {
    const col = p.palette[row[x]]; if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } } });
  return c;
}
async function resolve(s: SpriteSource): Promise<HTMLCanvasElement> {
  if ("pixels" in s) return pixelsToCanvas(s);
  const img = new Image(); img.src = s.url; await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}
export async function loadTheme(t: Theme): Promise<LoadedTheme> {
  return { ...t, black: await resolve(t.stones.black), white: await resolve(t.stones.white),
    hand: await Promise.all(t.hand.frames.map(resolve)), bowl: await resolve(t.bowl) };
}
export class Hand {
  private raf = 0; playing = false; private skip = false;
  constructor(private cv: HTMLCanvasElement, private frames: HTMLCanvasElement[], private scale: number) {}
  cancel() { this.skip = true; }
  play(tx: number, ty: number, onPlace: () => void): Promise<void> {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { onPlace(); return Promise.resolve(); }
    this.cancel(); this.playing = true; this.skip = false;
    const s = this.scale, [open, press] = this.frames;
    const sx = this.cv.width - 8 * s, sy = this.cv.height + 16 * s; // въезд из-за нижнего края
    const ex = tx - 2 * s, ey = ty - s;
    const g = this.cv.getContext("2d")!; g.imageSmoothingEnabled = false;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const paint = (f: HTMLCanvasElement, x: number, y: number) => {
      g.clearRect(0, 0, this.cv.width, this.cv.height);
      g.drawImage(f, x, y, f.width * s, f.height * s);
    };
    return new Promise(res => {
      const t0 = performance.now();
      const step = (now: number) => {
        if (!this.playing) return;
        const t = now - t0;
        if (this.skip || t >= 960) { // 550 путь + 130 нажатие + 280 уход
          g.clearRect(0, 0, this.cv.width, this.cv.height);
          this.playing = false; if (!this.placed) onPlace(); res(); return;
        }
        if (t < 550) { const k = ease(t / 550); paint(open, sx + (ex - sx) * k, sy + (ey - sy) * k); }
        else if (t < 680) { paint(press, ex, ey); if (t >= 600 && !this.placed) { this.placed = true; onPlace(); } }
        else { const k = ease((t - 680) / 280); paint(open, ex + (sx - ex) * k, ey + (sy - ey) * k); }
        this.raf = requestAnimationFrame(step);
      };
      this.placed = false;
      this.raf = requestAnimationFrame(step);
    });
  }
  private placed = false;
}
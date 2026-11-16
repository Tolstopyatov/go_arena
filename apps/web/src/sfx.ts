let ac: AudioContext | null = null;
export let soundOn = true;
export const toggleSound = () => (soundOn = !soundOn);
function blip(freq: number, dur: number, type: OscillatorType = "square") {
  if (!soundOn) return;
  ac ??= new AudioContext();
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.12, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
}
export const sfxPlace = () => blip(900, 0.05);
export const sfxCapture = () => blip(300, 0.09, "triangle");
export const sfxPass = () => blip(500, 0.06);
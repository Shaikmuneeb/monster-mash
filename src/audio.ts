// Tiny synthesized SFX engine (no audio assets, zero load time).
let ctx: AudioContext | null = null
function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 1) {
  const a = ac()
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, a.currentTime)
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), a.currentTime + dur)
  g.gain.setValueAtTime(vol, a.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur)
  o.connect(g).connect(a.destination)
  o.start()
  o.stop(a.currentTime + dur)
}

function noise(dur: number, vol: number, hp = 2000) {
  const a = ac()
  const len = Math.floor(a.sampleRate * dur)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = hp
  const g = a.createGain()
  g.gain.setValueAtTime(vol, a.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur)
  src.connect(f).connect(g).connect(a.destination)
  src.start()
}

export const sfx = {
  slash() { noise(0.12, 0.25, 3000); tone(700, 0.1, 'sawtooth', 0.05, 0.4) },
  heavy() { noise(0.25, 0.35, 1200); tone(180, 0.3, 'sawtooth', 0.12, 0.3) },
  clang() {
    // metal parry: bright inharmonic partials + spark noise
    tone(2489, 0.5, 'square', 0.08, 0.98)
    tone(3729, 0.4, 'triangle', 0.06, 0.99)
    tone(1180, 0.6, 'sine', 0.07, 0.995)
    noise(0.2, 0.3, 5000)
  },
  guard() { tone(300, 0.12, 'square', 0.05, 0.7) },
  deathblow() {
    tone(90, 0.9, 'sawtooth', 0.2, 0.3)
    noise(0.6, 0.35, 600)
    tone(60, 1.1, 'sine', 0.25, 0.5)
  },
  postureBreak() { tone(1500, 0.35, 'square', 0.09, 0.2); noise(0.3, 0.2, 2500) },
  cleanse() { tone(520, 0.5, 'sine', 0.1, 2); tone(780, 0.6, 'sine', 0.08, 1.8) },
  hurt() { tone(140, 0.25, 'sawtooth', 0.12, 0.5) },
}

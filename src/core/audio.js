// Synthesised impact sounds.
//
// No audio files ship with the project, and a survival game needs a hit to make
// a noise or it reads as if nothing happened. These are short WebAudio blips
// built from noise and a tuned filter — a thud with a woody resonance for an
// axe, a sharp crack for stone, a ringing knock for metal.
//
// Browsers refuse to start audio before the player interacts, so the context is
// created lazily on the first sound after a real input.

let ctx = null;
let master = null;
let enabled = true;

function context() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) { enabled = false; return null; }
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  return ctx;
}

/** Call from a user gesture so the first hit isn't swallowed by autoplay rules. */
export function unlockAudio() {
  const c = context();
  if (c?.state === 'suspended') c.resume();
}

export function setVolume(v) {
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

let noiseBuffer = null;
function noise(c) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  return src;
}

/**
 * One percussive hit: a filtered noise burst for the texture, plus an optional
 * short tone for the body of the impact.
 */
function strike(c, { freq, q, decay, gain, tone, toneDecay, type = 'lowpass' }) {
  const now = c.currentTime;

  const src = noise(c);
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const env = c.createGain();
  env.gain.setValueAtTime(gain, now);
  env.gain.exponentialRampToValueAtTime(0.0001, now + decay);

  src.connect(filter).connect(env).connect(master);
  src.start(now);
  src.stop(now + decay + 0.02);

  if (tone) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(tone, now);
    osc.frequency.exponentialRampToValueAtTime(tone * 0.55, now + toneDecay);
    const tenv = c.createGain();
    tenv.gain.setValueAtTime(gain * 0.7, now);
    tenv.gain.exponentialRampToValueAtTime(0.0001, now + toneDecay);
    osc.connect(tenv).connect(master);
    osc.start(now);
    osc.stop(now + toneDecay + 0.02);
  }
}

const VOICES = {
  // axe into wood: dull, low, with a knock underneath
  chop:    { freq: 900,  q: 1.2, decay: 0.16, gain: 0.55, tone: 180, toneDecay: 0.1 },
  // pick into stone: brighter and sharper, no body
  mine:    { freq: 2600, q: 2.4, decay: 0.11, gain: 0.5,  tone: 420, toneDecay: 0.05 },
  // prying metal: ringing
  metal:   { freq: 3200, q: 6.0, decay: 0.2,  gain: 0.4,  tone: 760, toneDecay: 0.18 },
  // pulling at a bush
  soft:    { freq: 1400, q: 0.8, decay: 0.13, gain: 0.28 },
  // a tree going over
  timber:  { freq: 320,  q: 0.9, decay: 0.75, gain: 0.75, tone: 90,  toneDecay: 0.6 },
  // stone breaking apart
  shatter: { freq: 1800, q: 1.4, decay: 0.4,  gain: 0.6,  tone: 240, toneDecay: 0.25 },
  // something picked up
  pickup:  { freq: 2200, q: 3.0, decay: 0.07, gain: 0.25, tone: 900, toneDecay: 0.07 },
};

/** Plays a named voice. Unknown names and dead audio are silently ignored. */
export function playSound(name, detune = 1) {
  if (!enabled) return;
  const voice = VOICES[name];
  if (!voice) return;
  const c = context();
  if (!c || c.state === 'suspended') return;
  strike(c, {
    ...voice,
    freq: voice.freq * detune,
    tone: voice.tone ? voice.tone * detune : undefined,
  });
}

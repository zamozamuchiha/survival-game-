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
 *
 * `at` offsets the layer within a voice, and `sweep` bends the filter down over
 * the decay — the difference between a flat hiss and something with a shape to
 * it. A rifle is a hard crack that opens into a low thump, which is two layers
 * rather than one clever one.
 */
function strike(c, { freq, q, decay, gain, tone, toneDecay, type = 'lowpass', at = 0, sweep }) {
  const now = c.currentTime + at;

  const src = noise(c);
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, now);
  if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), now + decay);
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

// A voice is one layer or a list of them, played together. Everything here is
// synthesised: no audio files ship with the project, so nothing to download and
// nothing to go missing.
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

  // ---- weapons ---------------------------------------------------------
  // Rifle: a hard bright crack, a low thump under it for the weight, and a tail
  // of filtered noise that falls away like the report rolling off the trees.
  shot: [
    { freq: 5200, q: 0.7, decay: 0.05, gain: 0.9, type: 'highpass' },
    { freq: 420,  q: 1.1, decay: 0.16, gain: 0.85, tone: 110, toneDecay: 0.1 },
    { freq: 1800, q: 0.5, decay: 0.42, gain: 0.22, sweep: 0.2, at: 0.02 },
  ],
  // The hammer falling on nothing.
  dryfire: { freq: 3000, q: 5.0, decay: 0.04, gain: 0.3, tone: 1400, toneDecay: 0.03 },
  // Fists and blades connecting with something soft.
  hit:     { freq: 700,  q: 1.0, decay: 0.13, gain: 0.45, tone: 150, toneDecay: 0.09 },
  // A swing that meets nothing but air.
  whoosh:  { freq: 900,  q: 0.6, decay: 0.18, gain: 0.16, sweep: 0.3 },

  // ---- the body --------------------------------------------------------
  // Boots. Deliberately quiet: this plays twice a second for the whole session,
  // and anything with presence becomes unbearable inside a minute.
  step_soft: { freq: 620,  q: 0.7, decay: 0.07, gain: 0.09, sweep: 0.4 },
  // Same weight of footfall, but a deck answers it with a hollow knock.
  step_wood: { freq: 900,  q: 1.6, decay: 0.09, gain: 0.13, tone: 190, toneDecay: 0.07 },
  hurt:      { freq: 500,  q: 0.8, decay: 0.22, gain: 0.55, tone: 130, toneDecay: 0.18 },
  die:       { freq: 300,  q: 0.7, decay: 0.9,  gain: 0.7,  tone: 80,  toneDecay: 0.8 },
  eat:       { freq: 800,  q: 0.6, decay: 0.16, gain: 0.22, sweep: 0.35 },
  drink:     { freq: 1200, q: 2.2, decay: 0.13, gain: 0.2,  tone: 380, toneDecay: 0.11 },

  // ---- making and building --------------------------------------------
  // Two knocks and a settle: something came together.
  craft: [
    { freq: 1500, q: 2.0, decay: 0.07, gain: 0.3, tone: 520, toneDecay: 0.06 },
    { freq: 1500, q: 2.0, decay: 0.07, gain: 0.3, tone: 700, toneDecay: 0.07, at: 0.09 },
    { freq: 900,  q: 1.2, decay: 0.22, gain: 0.24, tone: 1050, toneDecay: 0.2, at: 0.19 },
  ],
  // A timber panel dropped into place and taking its weight.
  build: [
    { freq: 700, q: 1.0, decay: 0.14, gain: 0.5, tone: 160, toneDecay: 0.11 },
    { freq: 2200, q: 1.8, decay: 0.06, gain: 0.2, at: 0.03 },
  ],
  // Boards coming apart.
  demolish: [
    { freq: 1100, q: 0.8, decay: 0.3, gain: 0.45, sweep: 0.25 },
    { freq: 400,  q: 1.0, decay: 0.2, gain: 0.35, tone: 120, toneDecay: 0.16, at: 0.04 },
  ],
  // Refused: no materials, nowhere to put it, wrong tool.
  deny:    { freq: 400, q: 3.0, decay: 0.12, gain: 0.28, tone: 150, toneDecay: 0.1 },

  // ---- interface -------------------------------------------------------
  ui:      { freq: 2400, q: 2.0, decay: 0.035, gain: 0.13, tone: 1100, toneDecay: 0.03 },
  // An objective closed out: three rising knocks, the only sound in the game
  // that resolves upwards.
  fanfare: [
    { freq: 1800, q: 3.0, decay: 0.1, gain: 0.28, tone: 660,  toneDecay: 0.1 },
    { freq: 1800, q: 3.0, decay: 0.1, gain: 0.28, tone: 880,  toneDecay: 0.1,  at: 0.11 },
    { freq: 1800, q: 3.0, decay: 0.3, gain: 0.32, tone: 1320, toneDecay: 0.32, at: 0.22 },
  ],
};

/** Plays a named voice. Unknown names and dead audio are silently ignored. */
export function playSound(name, detune = 1) {
  if (!enabled || isMuted()) return;
  const voice = VOICES[name];
  if (!voice) return;
  const c = context();
  if (!c || c.state === 'suspended') return;
  for (const layer of Array.isArray(voice) ? voice : [voice]) {
    strike(c, {
      ...layer,
      freq: layer.freq * detune,
      tone: layer.tone ? layer.tone * detune : undefined,
    });
  }
}

// ---------------------------------------------------------------- audio mode
//
// Three states rather than a plain mute, because music and effects are wanted
// separately far more often than either is wanted alone: plenty of people keep
// the world audible and the score off.

const MODE_KEY = 'lastlight.audio';
const MODES = ['full', 'sfx', 'off'];
export const MODE_LABEL = { full: 'Sound & music', sfx: 'Sound, no music', off: 'Silent' };

let mode = 'full';
try {
  const saved = localStorage.getItem(MODE_KEY);
  if (MODES.includes(saved)) mode = saved;
} catch { /* private mode */ }

export const audioMode = () => mode;
export const isMuted = () => mode === 'off';
export const musicWanted = () => mode === 'full';

export function cycleAudio() {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  return mode;
}

/**
 * The shared output stage, for anything that makes its own sound.
 *
 * The music runs its own graph but must sit behind the same master gain, or
 * turning the volume down would leave the score playing on at full level.
 */
export function audioBus() {
  const c = context();
  return c ? { ctx: c, master } : null;
}

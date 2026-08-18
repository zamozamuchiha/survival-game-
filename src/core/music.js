import { audioBus, musicWanted } from './audio.js';

// The score: a dead world with a guitar in it.
//
// Written rather than sampled. No audio files ship with the project, so the
// string is synthesised — Karplus-Strong, which is a burst of noise fed round a
// delay line one wavelength long, losing a little top end each trip. That is
// genuinely how a plucked string behaves, and it sounds like one.
//
// Four layers, none of which is a tune:
//
//   drone    a low detuned hum, always there, swelling and receding. Two
//            oscillators a few cents apart so they beat against each other —
//            the slow throb of something not quite in tune is unease you can
//            hear without being able to name.
//   wind     filtered noise drifting across the top. Empty space, made audible.
//   guitar   sparse plucks, mostly the root and the notes that fight it
//   rumble   rare, distant, far below. Something coming down a long way off.
//
// The harmony is Phrygian: a minor scale with the second flattened, so the note
// a semitone above the tonic belongs to the key. Leaning on that semitone is the
// oldest trick there is for dread, and it does not resolve, ever — the
// progression circles between the tonic and its flat neighbour and gets nowhere.
// There is not one major chord in it.

const A4 = 440;
const hz = (midi) => A4 * (2 ** ((midi - 69) / 12));

// ---------------------------------------------------------------- the string

function pluck(ctx, freq, seconds, decay, colour) {
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / freq));
  const total = Math.ceil(sr * seconds);
  const buffer = ctx.createBuffer(1, total, sr);
  const out = buffer.getChannelData(0);

  // The excitation. Filtering it is what separates a pluck from a click; a low
  // colour is the flesh of a fingertip rather than a nail.
  const line = new Float32Array(period);
  let smooth = 0;
  for (let i = 0; i < period; i++) {
    smooth += colour * ((Math.random() * 2 - 1) - smooth);
    line[i] = smooth;
  }

  let read = 0;
  let previous = 0;
  for (let i = 0; i < total; i++) {
    const current = line[read];
    line[read] = decay * 0.5 * (current + previous);
    previous = current;
    out[i] = current;
    read = (read + 1) % period;
  }
  return buffer;
}

const TAKES = 3;
const cache = new Map();
function voiceFor(ctx, midi, seconds, decay, colour) {
  const key = `${midi}:${Math.round(seconds * 10)}:${Math.round(decay * 1000)}:${Math.round(colour * 100)}`;
  let takes = cache.get(key);
  if (!takes) {
    takes = Array.from({ length: TAKES }, () => pluck(ctx, hz(midi), seconds, decay, colour));
    cache.set(key, takes);
  }
  return takes[(Math.random() * TAKES) | 0];
}

// ---------------------------------------------------------------- the room

/** A long, dark tail. Bigger and emptier than a room — this is outdoors. */
function reverbIR(ctx, seconds = 4.2) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(sr * seconds);
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let dark = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const swell = Math.min(1, t * 14);
      // Lowpassed noise, so the tail is a hollow wash rather than a hiss.
      dark += 0.22 * ((Math.random() * 2 - 1) - dark);
      data[i] = dark * swell * ((1 - t) ** 2.2);
    }
  }
  return ir;
}

function noiseLoop(ctx, seconds = 4) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.ceil(sr * seconds), sr);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < d.length; i++) {
    v += 0.04 * ((Math.random() * 2 - 1) - v);   // heavily lowpassed: wind, not static
    d[i] = v * 6;
  }
  return buf;
}

// ---------------------------------------------------------------- the harmony

// D Phrygian. `bII` is the flat second — the chord a semitone above home, which
// in any other key would be an intruder and here is the whole point.
const CHORDS = {
  i:   { root: 38, tones: [50, 53, 57, 62, 65] },   // Dm
  bII: { root: 39, tones: [51, 54, 58, 63, 66] },   // Ebm, one semitone up
  bVI: { root: 34, tones: [46, 50, 53, 58, 62] },   // Bb
  v:   { root: 33, tones: [45, 48, 52, 57, 60] },   // Am
};
// Home, home, the semitone above, home again — then a long way down and back.
// Nothing here is a cadence; it is the same ground walked over repeatedly.
const PROGRESSION = ['i', 'i', 'bII', 'i', 'bVI', 'v', 'bII', 'i'];

// The tritone above the root. Used rarely and never resolved.
const DEVIL = 6;

// Picking figures over eight pulses, as [pulse, chord tone, how hard].
// Tone -1 is the bass string. Sparse by design: most bars are one or two notes.
const PATTERNS = [
  [[0, -1, 0.5]],
  [[0, -1, 0.46], [5, 0, 0.26]],
  [[0, -1, 0.5], [3, 1, 0.28]],
  [[0, -1, 0.44], [2, 0, 0.26], [6, 2, 0.24]],
  [[0, -1, 0.5], [4, 1, 0.3], [5, 0, 0.22]],
  [[0, -1, 0.46], [1, 2, 0.24], [4, 0, 0.28], [7, 1, 0.2]],
];
const PATTERN_WEIGHT = [5, 5, 4, 3, 2, 1];

const BAR_PULSES = 8;
const PULSE = 0.62;              // seconds; about 48 to the minute. Slow.
const LOOKAHEAD = 0.8;
const REST_CHANCE = 0.28;        // more than a quarter of bars are nothing at all

const pick = (weights) => {
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((roll -= weights[i]) < 0) return i;
  return weights.length - 1;
};

// ---------------------------------------------------------------- the graph

let bus = null;
let out = null;          // everything passes through here, and it is what fades
let dry = null;
let wet = null;
let drone = null;        // { oscs, gain, filter }
let wind = null;
let timer = null;
let nextTime = 0;
let bar = 0;
let running = false;

function build() {
  bus = audioBus();
  if (!bus || out) return !!bus;
  const { ctx, master } = bus;

  out = ctx.createGain();
  out.gain.value = 0.0001;
  out.connect(master);

  const verb = ctx.createConvolver();
  verb.buffer = reverbIR(ctx);
  wet = ctx.createGain();
  wet.gain.value = 0.62;               // wetter than before: distance, not presence
  wet.connect(verb).connect(out);

  dry = ctx.createGain();
  dry.gain.value = 0.8;
  dry.connect(out);

  // ---- drone: two saws a few cents apart, under a moving lowpass -----
  const dGain = ctx.createGain();
  dGain.gain.value = 0.0001;
  const dFilter = ctx.createBiquadFilter();
  dFilter.type = 'lowpass';
  dFilter.frequency.value = 170;
  dFilter.Q.value = 3.5;
  dFilter.connect(dGain).connect(out);

  const oscs = [-9, 7].map((cents) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = cents;           // the beating between them is the unease
    o.frequency.value = hz(CHORDS.i.root);
    o.connect(dFilter);
    o.start();
    return o;
  });

  // A very slow sweep on the filter, so the hum breathes instead of sitting still.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.031;         // one breath every half minute
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 70;
  lfo.connect(lfoDepth).connect(dFilter.frequency);
  lfo.start();
  drone = { oscs, gain: dGain, filter: dFilter };

  // ---- wind: noise through a drifting bandpass ----------------------
  const wsrc = ctx.createBufferSource();
  wsrc.buffer = noiseLoop(ctx);
  wsrc.loop = true;
  const wFilter = ctx.createBiquadFilter();
  wFilter.type = 'bandpass';
  wFilter.frequency.value = 520;
  wFilter.Q.value = 0.8;
  const wGain = ctx.createGain();
  wGain.gain.value = 0.0001;
  wsrc.connect(wFilter).connect(wGain).connect(out);

  const wlfo = ctx.createOscillator();
  wlfo.frequency.value = 0.017;
  const wDepth = ctx.createGain();
  wDepth.gain.value = 300;
  wlfo.connect(wDepth).connect(wFilter.frequency);
  wlfo.start();
  wsrc.start();
  wind = { gain: wGain };

  return true;
}

function note(midi, when, velocity, seconds, decay, colour) {
  const { ctx } = bus;
  const src = ctx.createBufferSource();
  src.buffer = voiceFor(ctx, midi, seconds, decay, colour);
  src.detune.value = (Math.random() - 0.5) * 18;   // nobody frets twice the same

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(velocity, when + 0.006);
  env.gain.setTargetAtTime(0, when + seconds * 0.5, seconds * 0.32);

  src.connect(env);
  env.connect(dry);
  env.connect(wet);
  src.start(when);
  src.stop(when + seconds + 0.1);
}

/** Something large, far away, coming apart. */
function rumble(when) {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(58, when);
  osc.frequency.exponentialRampToValueAtTime(24, when + 3.2);

  const n = ctx.createBufferSource();
  n.buffer = noiseLoop(ctx, 1);
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass';
  nf.frequency.setValueAtTime(220, when);
  nf.frequency.exponentialRampToValueAtTime(50, when + 3.2);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(0.5, when + 0.9);      // it arrives, it doesn't hit
  env.gain.exponentialRampToValueAtTime(0.0001, when + 3.4);

  osc.connect(env);
  n.connect(nf).connect(env);
  env.connect(wet);
  env.connect(dry);
  osc.start(when); osc.stop(when + 3.5);
  n.start(when);   n.stop(when + 3.5);
}

function scheduleBar() {
  const name = PROGRESSION[(bar >> 1) % PROGRESSION.length];   // two bars each
  const chord = CHORDS[name];
  const start = nextTime;
  const changing = (bar % 2) === 0;
  bar++;
  nextTime += BAR_PULSES * PULSE;

  const { ctx } = bus;

  if (changing) {
    // The drone follows the harmony, but slides rather than steps — it never
    // sounds like a chord change, only like the ground shifting underneath.
    const f = hz(chord.root);
    for (const o of drone.oscs) {
      o.frequency.cancelScheduledValues(start);
      o.frequency.setValueAtTime(o.frequency.value, start);
      o.frequency.exponentialRampToValueAtTime(f, start + 3.0);
    }
    // Swell and recede on its own slow schedule, independent of the picking.
    const level = 0.1 + Math.random() * 0.11;
    drone.gain.gain.cancelScheduledValues(start);
    drone.gain.gain.setValueAtTime(Math.max(0.0001, drone.gain.gain.value), start);
    drone.gain.gain.linearRampToValueAtTime(level, start + BAR_PULSES * PULSE * 0.7);
  }

  if (Math.random() < 0.05) rumble(start + Math.random() * 3);

  if (Math.random() < REST_CHANCE) return;                     // let it be empty

  const pattern = PATTERNS[pick(PATTERN_WEIGHT)];
  for (const [pulse, tone, velocity] of pattern) {
    const when = start + pulse * PULSE + (Math.random() - 0.5) * 0.07;
    const level = velocity * (0.75 + Math.random() * 0.45);

    if (tone < 0) {
      // The bass string, low and long. Dark excitation: almost no attack noise.
      note(chord.root + 12, when, level * 0.95, 4.6, 0.9972, 0.3);
    } else {
      let midi = chord.tones[Math.min(tone, chord.tones.length - 1)];
      // Once in a while the tritone instead of the note that belongs there.
      if (Math.random() < 0.07) midi = chord.root + 12 + DEVIL;
      note(midi, when, level, 3.4, 0.996, 0.38);
    }
  }
}

function tick() {
  if (!running) return;
  const { ctx } = bus;
  while (nextTime < ctx.currentTime + LOOKAHEAD) scheduleBar();
  timer = setTimeout(tick, 260);
}

export function startMusic() {
  if (running || !musicWanted()) return;
  if (!build()) return;
  const { ctx } = bus;
  if (ctx.state === 'suspended') return;      // no gesture yet; caller retries

  running = true;
  bar = 0;
  nextTime = ctx.currentTime + 0.5;
  const now = ctx.currentTime;
  // It does not start. It is noticed.
  out.gain.cancelScheduledValues(now);
  out.gain.setValueAtTime(0.0001, now);
  out.gain.linearRampToValueAtTime(0.26, now + 9);
  wind.gain.gain.cancelScheduledValues(now);
  wind.gain.gain.setValueAtTime(0.0001, now);
  wind.gain.gain.linearRampToValueAtTime(0.05, now + 14);
  tick();
}

export function stopMusic() {
  if (!running) return;
  running = false;
  clearTimeout(timer);
  timer = null;
  const { ctx } = bus;
  const now = ctx.currentTime;
  for (const node of [out.gain, drone.gain.gain, wind.gain.gain]) {
    node.cancelScheduledValues(now);
    node.setValueAtTime(Math.max(0.0001, node.value), now);
    node.linearRampToValueAtTime(0.0001, now + 2.2);
  }
}

export const musicPlaying = () => running;

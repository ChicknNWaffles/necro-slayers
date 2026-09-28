// Sound: synthesizes the game's sounds with the Web Audio API (no sound files).
//
// Voices (see voice.js) are made the way a real voice is: a buzzing source at
// the speaker's pitch (the vocal cords), shaped by filters that pick out the
// resonances of each vowel ("formants"), with short bursts of noise for the
// consonants.

let context = null;

// Browsers only allow sound after the player has pressed a key or clicked.
// Starting the audio takes a moment, so the game calls this on the player's
// first key press or click (see game.js), well before any sound is needed --
// otherwise the first sound would come late.
export function startAudio() {
  context ??= new AudioContext({ latencyHint: 'interactive' });
  if (context.state === 'suspended') context.resume();
  return context;
}

// The two main resonances of each vowel (Hz).
const FORMANTS = { a: [800, 1200], o: [500, 900], e: [500, 1800], i: [320, 2300], u: [350, 800] };

// Consonants: a burst of noise, filtered to [frequency, sharpness], [length (s), loudness].
const CONSONANTS = {
  h: [[1600, 0.6], [0.06, 0.25]],
  k: [[2800, 1.5], [0.035, 0.8]],
  g: [[1300, 1.2], [0.03, 0.6]],
  r: [[1200, 2.5], [0.05, 0.35]],
};

// Plays a line of syllables (see voice.js).
//   pitch:  the speaker's normal pitch (Hz) -- lower for a deeper voice
//   volume: 0-1
export function playVoice(syllables, options) {
  const ac = startAudio();
  voice(ac, syllables, options, ac.currentTime); // (straight away)
}

// Builds the voice in an audio context, starting at `start` (seconds). (Also
// usable with an OfflineAudioContext, to record it.)
//   roughness: how rough and growling the voice is (0.02 is a normal raised voice)
export function voice(ac, syllables, { pitch = 150, volume = 0.35, roughness = 0.02 } = {}, start = 0) {
  // Everything goes through a compressor, which evens out the loudness and
  // gives the voice a hard, projected edge.
  const master = ac.createGain();
  master.gain.value = volume;
  const compressor = ac.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.ratio.value = 6;
  master.connect(compressor).connect(ac.destination);

  for (const s of syllables) {
    const t0 = start + s.at, t1 = t0 + s.length;

    // The voice: a buzz at the syllable's pitch, gliding from its start to end pitch.
    const source = ac.createOscillator();
    source.type = 'sawtooth';
    source.frequency.setValueAtTime(pitch * s.pitch[0], t0);
    source.frequency.linearRampToValueAtTime(pitch * s.pitch[1], t1);
    // (A fast wobble in the pitch gives it the roughness of a raised voice.)
    const growl = ac.createOscillator();
    growl.frequency.value = 32;
    const growlDepth = ac.createGain();
    growlDepth.gain.value = pitch * roughness;
    growl.connect(growlDepth).connect(source.frequency);

    // Loudness: a sharp attack and a clipped end.
    const envelope = ac.createGain();
    envelope.gain.setValueAtTime(0, t0);
    envelope.gain.linearRampToValueAtTime(s.loudness, t0 + 0.015);
    envelope.gain.setValueAtTime(s.loudness, Math.max(t1 - 0.04, t0 + 0.02));
    envelope.gain.linearRampToValueAtTime(0, t1);
    envelope.connect(master);

    // The vowel: the buzz through its two formants (and a little brightness).
    const [f1, f2] = FORMANTS[s.vowel];
    for (const [frequency, q, gain] of [[f1, 5, 3], [f2, 7, 1.6], [2700, 9, 0.5]]) {
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const level = ac.createGain();
      level.gain.value = gain;
      source.connect(filter).connect(level).connect(envelope);
    }
    source.start(t0);
    source.stop(t1 + 0.02);
    growl.start(t0);
    growl.stop(t1 + 0.02);

    // The consonant: a short burst of shaped noise just before the vowel.
    const consonant = CONSONANTS[s.consonant];
    if (consonant) {
      const [[frequency, q], [length, loudness]] = consonant;
      const noise = ac.createBufferSource();
      noise.buffer = noiseBuffer(ac);
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const burst = ac.createGain();
      const b0 = Math.max(t0 - length * 0.6, ac.currentTime);
      burst.gain.setValueAtTime(0, b0);
      burst.gain.linearRampToValueAtTime(loudness, b0 + 0.005);
      burst.gain.exponentialRampToValueAtTime(0.001, b0 + length);
      noise.connect(filter).connect(burst).connect(master);
      noise.start(b0);
      noise.stop(b0 + length + 0.01);
    }
  }
}

let noise = null;
function noiseBuffer(ac) {
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); // (long, so looping it doesn't make an audible pattern)
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// --- Smite ------------------------------------------------------------------

// The swing of a smite: a rising whoosh of air.
export function playSwing({ volume = 0.18 } = {}) {
  const ac = startAudio();
  const t = ac.currentTime;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuffer(ac);
  noise.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.5;
  filter.frequency.setValueAtTime(350, t);
  filter.frequency.exponentialRampToValueAtTime(1800, t + 0.38);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.3);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  noise.connect(filter).connect(gain).connect(ac.destination);
  noise.start(t);
  noise.stop(t + 0.5);
}

// A smite landing: a clap of thunder right overhead -- a split-second crack
// that breaks into a huge, deep boom, then rolls and grumbles away over a few
// seconds, surging unevenly as it goes (each clap is a little different).
export function playSmite({ volume = 0.5 } = {}) {
  const ac = startAudio();
  smite(ac, ac.currentTime, volume);
}

// Builds the smite sound in an audio context, starting at t (seconds). (Also
// usable with an OfflineAudioContext, to record it.)
export function smite(ac, t, volume = 0.5, random = Math.random) {
  const out = ac.createGain();
  out.gain.value = volume;
  // A little overdrive gives thunder its rough, torn edge.
  const rough = ac.createWaveShaper();
  rough.curve = softClip(2.5);
  rough.connect(out).connect(ac.destination);

  // The crack: bright noise whose brightness falls away fast, into the boom.
  const crack = ac.createBufferSource();
  crack.buffer = noiseBuffer(ac);
  const crackTone = ac.createBiquadFilter();
  crackTone.type = 'lowpass';
  crackTone.frequency.setValueAtTime(7000, t);
  crackTone.frequency.exponentialRampToValueAtTime(300, t + 0.45);
  const crackGain = ac.createGain();
  crackGain.gain.setValueAtTime(0.9, t);
  crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  crack.connect(crackTone).connect(crackGain).connect(rough);
  crack.start(t);
  crack.stop(t + 0.65);

  // The boom: a very low thud you feel more than hear.
  const boom = ac.createOscillator();
  boom.frequency.setValueAtTime(60, t);
  boom.frequency.exponentialRampToValueAtTime(28, t + 1.0);
  const boomGain = ac.createGain();
  boomGain.gain.setValueAtTime(0.001, t);
  boomGain.gain.exponentialRampToValueAtTime(1.2, t + 0.03);
  boomGain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
  boom.connect(boomGain).connect(rough);
  boom.start(t);
  boom.stop(t + 1.25);

  // The roll: deep rumbling noise, getting duller as it goes, whose loudness
  // surges up and down at random as it fades out.
  const length = 4;
  const rumble = ac.createBufferSource();
  rumble.buffer = rumbleBuffer(ac);
  const rumbleTone = ac.createBiquadFilter();
  rumbleTone.type = 'lowpass';
  rumbleTone.frequency.setValueAtTime(900, t);
  rumbleTone.frequency.exponentialRampToValueAtTime(110, t + length);
  const fade = ac.createGain();
  fade.gain.setValueAtTime(0.001, t);
  fade.gain.exponentialRampToValueAtTime(1.4, t + 0.06);
  fade.gain.exponentialRampToValueAtTime(0.8, t + 1.0); // (rolling on a good while...)
  fade.gain.exponentialRampToValueAtTime(0.35, t + 2.3);
  fade.gain.exponentialRampToValueAtTime(0.001, t + length); // (...before it dies away)
  const surge = ac.createGain();
  surge.gain.setValueAtTime(1, t);
  for (let s = t + 0.3; s < t + length; s += 0.12 + random() * 0.25) {
    surge.gain.linearRampToValueAtTime(0.35 + random() * 0.9, s);
  }
  rumble.connect(rumbleTone).connect(fade).connect(surge).connect(rough);
  rumble.start(t, random() * 2);
  rumble.stop(t + length);
}

// A gentle clipping curve (for overdrive): drive > 1 squashes loud sounds harder.
function softClip(drive) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

// "Brown" noise: random, but weighted heavily towards the low end, like a rumble.
let rumbleNoise = null;
function rumbleBuffer(ac) {
  if (!rumbleNoise) {
    rumbleNoise = ac.createBuffer(1, ac.sampleRate * 6, ac.sampleRate);
    const data = rumbleNoise.getChannelData(0);
    let level = 0;
    for (let i = 0; i < data.length; i++) {
      level = (level + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = level * 3.5;
    }
  }
  return rumbleNoise;
}

// --- Divine Blade -----------------------------------------------------------

// Summoning the swords: a bright metallic ring swelling up, like blades
// being drawn all at once, over a rushing wind.
export function playSummon({ volume = 0.22 } = {}) {
  const ac = startAudio();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.value = volume;
  out.connect(ac.destination);
  // Rushing wind, rising.
  const wind = ac.createBufferSource();
  wind.buffer = noiseBuffer(ac);
  const windTone = ac.createBiquadFilter();
  windTone.type = 'bandpass';
  windTone.Q.value = 0.8;
  windTone.frequency.setValueAtTime(300, t);
  windTone.frequency.exponentialRampToValueAtTime(2500, t + 0.7);
  const windGain = ac.createGain();
  windGain.gain.setValueAtTime(0.001, t);
  windGain.gain.exponentialRampToValueAtTime(0.9, t + 0.6);
  windGain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  wind.connect(windTone).connect(windGain).connect(out);
  wind.start(t);
  wind.stop(t + 1.15);
  // The "shing" of blades: a scrape of high noise and a shimmer of metal.
  const scrape = ac.createBufferSource();
  scrape.buffer = noiseBuffer(ac);
  const scrapeTone = ac.createBiquadFilter();
  scrapeTone.type = 'highpass';
  scrapeTone.frequency.value = 4000;
  const scrapeGain = ac.createGain();
  scrapeGain.gain.setValueAtTime(0.001, t + 0.35);
  scrapeGain.gain.exponentialRampToValueAtTime(0.5, t + 0.55);
  scrapeGain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
  scrape.connect(scrapeTone).connect(scrapeGain).connect(out);
  scrape.start(t + 0.35, 0.5);
  scrape.stop(t + 1.05);
  metalRing(ac, out, t + 0.45, 0.35, 0.9);
}

// A sword hitting the ground: a short metallic chunk.
export function playSwordImpact({ volume = 0.12 } = {}) {
  const ac = startAudio();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.value = volume * (0.7 + 0.6 * Math.random());
  out.connect(ac.destination);
  // The thud of it going in...
  const thud = ac.createOscillator();
  thud.frequency.setValueAtTime(180, t);
  thud.frequency.exponentialRampToValueAtTime(70, t + 0.08);
  const thudGain = ac.createGain();
  thudGain.gain.setValueAtTime(0.8, t);
  thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  thud.connect(thudGain).connect(out);
  thud.start(t);
  thud.stop(t + 0.12);
  // ...a click of metal, and the blade humming for a moment.
  const click = ac.createBufferSource();
  click.buffer = noiseBuffer(ac);
  const clickTone = ac.createBiquadFilter();
  clickTone.type = 'bandpass';
  clickTone.frequency.value = 3200;
  clickTone.Q.value = 2;
  const clickGain = ac.createGain();
  clickGain.gain.setValueAtTime(0.9, t);
  clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  click.connect(clickTone).connect(clickGain).connect(out);
  click.start(t, Math.random());
  click.stop(t + 0.05);
  metalRing(ac, out, t, 0.25, 0.25);
  // ...all over the dull thud of the blade driving into the ground.
  const ground = ac.createOscillator();
  ground.frequency.setValueAtTime(95, t);
  ground.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  const groundGain = ac.createGain();
  groundGain.gain.setValueAtTime(1.1, t);
  groundGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  ground.connect(groundGain).connect(out);
  ground.start(t);
  ground.stop(t + 0.25);
  const earth = ac.createBufferSource();
  earth.buffer = noiseBuffer(ac);
  const earthTone = ac.createBiquadFilter();
  earthTone.type = 'lowpass';
  earthTone.frequency.value = 350;
  const earthGain = ac.createGain();
  earthGain.gain.setValueAtTime(1.4, t);
  earthGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  earth.connect(earthTone).connect(earthGain).connect(out);
  earth.start(t, Math.random());
  earth.stop(t + 0.18);
}

// The ring of struck metal: a few high, unevenly spaced tones dying away.
function metalRing(ac, destination, t, level, length) {
  const base = 1700 + Math.random() * 400;
  for (const [ratio, share] of [[1, 1], [1.47, 0.6], [2.09, 0.4], [2.83, 0.25]]) {
    const tone = ac.createOscillator();
    tone.frequency.value = base * ratio;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(level * share, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + length * (1.2 - 0.2 * ratio / 2.83));
    tone.connect(gain).connect(destination);
    tone.start(t);
    tone.stop(t + length + 0.05);
  }
}

// --- Zombies ----------------------------------------------------------------

// A zombie's hungry snarl as it lunges to bite: a low, rough, rising and
// falling "rrraaah".
const SNARL = [
  { at: 0, length: 0.45, vowel: 'o', pitch: [0.9, 1.15], loudness: 0.8, consonant: 'r' },
  { at: 0.42, length: 0.3, vowel: 'a', pitch: [1.2, 0.8], loudness: 1, consonant: '' },
];

export function playSnarl({ volume = 0.3 } = {}) {
  const ac = startAudio();
  voice(ac, SNARL, { pitch: 80 + Math.random() * 25, volume, roughness: 0.18 }, ac.currentTime);
}

// A zombie's arm swiping through the air.
export function playClaw({ volume = 0.14 } = {}) {
  const ac = startAudio();
  const t = ac.currentTime;
  const air = ac.createBufferSource();
  air.buffer = noiseBuffer(ac);
  const tone = ac.createBiquadFilter();
  tone.type = 'bandpass';
  tone.Q.value = 1.2;
  tone.frequency.setValueAtTime(700, t + 0.15);
  tone.frequency.exponentialRampToValueAtTime(2200, t + 0.38);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.001, t + 0.15);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.33);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  air.connect(tone).connect(gain).connect(ac.destination);
  air.start(t, Math.random());
  air.stop(t + 0.5);
}

// A scratch or bite landing: a soft, meaty thump, then the tear of claws or
// the crunch of teeth.
export function playWound(kind, { volume = 0.35 } = {}) {
  const ac = startAudio();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.value = volume;
  out.connect(ac.destination);
  // Thump: low, muffled noise.
  const thump = ac.createBufferSource();
  thump.buffer = noiseBuffer(ac);
  const thumpTone = ac.createBiquadFilter();
  thumpTone.type = 'lowpass';
  thumpTone.frequency.value = 250;
  const thumpGain = ac.createGain();
  thumpGain.gain.setValueAtTime(1.6, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  thump.connect(thumpTone).connect(thumpGain).connect(out);
  thump.start(t, Math.random());
  thump.stop(t + 0.16);
  // Tear (scratch): a ragged, stuttering scrape. Crunch (bite): a few quick,
  // dry clicks.
  const bursts = kind === 'bite' ? [[0, 0.03], [0.04, 0.025], [0.075, 0.03], [0.11, 0.02]] : [[0, 0.05], [0.05, 0.04], [0.1, 0.06], [0.17, 0.05]];
  for (const [delay, length] of bursts) {
    const burst = ac.createBufferSource();
    burst.buffer = noiseBuffer(ac);
    const tone = ac.createBiquadFilter();
    tone.type = 'bandpass';
    tone.frequency.value = kind === 'bite' ? 1400 + Math.random() * 600 : 2600 + Math.random() * 1200;
    tone.Q.value = kind === 'bite' ? 3 : 1.5;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(kind === 'bite' ? 0.9 : 0.5, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, t + delay + length);
    burst.connect(tone).connect(gain).connect(out);
    burst.start(t + delay, Math.random());
    burst.stop(t + delay + length + 0.01);
  }
}

// --- Divine Restoration ------------------------------------------------------

// Healing: a warm, soft swell, like a choir holding a major chord, with a
// gentle breath of air through it -- rising in and fading away (no bells).
export function playHealing({ volume = 0.16 } = {}) {
  const ac = startAudio();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(0.001, t);
  out.gain.exponentialRampToValueAtTime(volume, t + 0.5);
  out.gain.setValueAtTime(volume, t + 1.0);
  out.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
  const warmth = ac.createBiquadFilter();
  warmth.type = 'lowpass';
  warmth.frequency.value = 1600;
  warmth.connect(out).connect(ac.destination);
  // The chord (a major triad and its octave), each note two slightly
  // detuned voices, so it shimmers softly.
  for (const note of [261.6, 329.6, 392.0, 523.3]) {
    for (const detune of [-6, 6]) {
      const voiceTone = ac.createOscillator();
      voiceTone.type = 'triangle';
      voiceTone.frequency.value = note;
      voiceTone.detune.value = detune;
      const level = ac.createGain();
      level.gain.value = 0.25;
      voiceTone.connect(level).connect(warmth);
      voiceTone.start(t);
      voiceTone.stop(t + 2.3);
    }
  }
  // A breath of air.
  const air = ac.createBufferSource();
  air.buffer = noiseBuffer(ac);
  const airTone = ac.createBiquadFilter();
  airTone.type = 'bandpass';
  airTone.frequency.value = 1200;
  airTone.Q.value = 0.6;
  const airLevel = ac.createGain();
  airLevel.gain.value = 0.35;
  air.connect(airTone).connect(airLevel).connect(out);
  air.start(t, Math.random());
  air.stop(t + 2.3);
}

// --- Shield of Faith --------------------------------------------------------

// The shield forming: a soft, glassy shimmer swelling up -- a cluster of high,
// gently wavering tones over a rising breath of air -- then settling away.
export function playShield({ volume = 0.12 } = {}) {
  const ac = startAudio();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(0.001, t);
  out.gain.exponentialRampToValueAtTime(volume, t + 0.45);
  out.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
  out.connect(ac.destination);
  // The shimmer: high tones, each wavering at its own rate, so they glisten.
  for (const [frequency, rate] of [[1318, 5.1], [1568, 6.3], [1976, 7.7], [2637, 9.2]]) {
    const tone = ac.createOscillator();
    tone.frequency.value = frequency;
    const waver = ac.createOscillator();
    waver.frequency.value = rate;
    const waverDepth = ac.createGain();
    waverDepth.gain.value = 0.5;
    const level = ac.createGain();
    level.gain.value = 0.5;
    waver.connect(waverDepth).connect(level.gain);
    tone.connect(level).connect(out);
    for (const node of [tone, waver]) { node.start(t); node.stop(t + 1.9); }
  }
  // A breath of air, rising.
  const air = ac.createBufferSource();
  air.buffer = noiseBuffer(ac);
  const tone = ac.createBiquadFilter();
  tone.type = 'bandpass';
  tone.Q.value = 0.8;
  tone.frequency.setValueAtTime(800, t);
  tone.frequency.exponentialRampToValueAtTime(4000, t + 0.6);
  const level = ac.createGain();
  level.gain.value = 1.2;
  air.connect(tone).connect(level).connect(out);
  air.start(t, Math.random());
  air.stop(t + 1.9);
}

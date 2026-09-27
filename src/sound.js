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
export function voice(ac, syllables, { pitch = 150, volume = 0.35 } = {}, start = 0) {
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
    growlDepth.gain.value = pitch * 0.02;
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
    noise = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

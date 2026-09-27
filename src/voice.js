// Voices: short bursts of made-up speech -- unintelligible, but with the tone
// of real speech -- as plain data. The sound is made from it by sound.js, and
// the mouth is moved in time with it by the character animations
// (characterAnimation.js), so the two always match.
//
// Each syllable: when it starts and how long it lasts (seconds), its vowel
// (which sets the sound's colour and how wide the mouth opens), the pitch at
// its start and end (multiples of the speaker's normal pitch), how loud it is,
// and the consonant it starts with ('' for none).

// A commander's call to follow: short, clipped and loud, with the stress on
// the last syllable and the pitch falling at the end -- an order, not a
// request. ("Hup -- ka-RAH!")
export const COMMAND_CALL = [
  { at: 0.02, length: 0.13, vowel: 'u', pitch: [1.0, 0.95], loudness: 0.8, consonant: 'h' },
  { at: 0.32, length: 0.11, vowel: 'a', pitch: [1.05, 1.0], loudness: 0.75, consonant: 'k' },
  { at: 0.47, length: 0.32, vowel: 'a', pitch: [1.3, 0.85], loudness: 1, consonant: 'r' },
  { at: 0.9, length: 0.24, vowel: 'o', pitch: [1.15, 0.8], loudness: 0.9, consonant: 'g' },
];

// How wide the mouth opens for each vowel (0-1).
export const VOWEL_OPENING = { a: 1, o: 0.75, e: 0.55, i: 0.35, u: 0.4 };

// How open the mouth is at time t (seconds) into a line of syllables.
export function mouthOpening(syllables, t) {
  let open = 0;
  for (const s of syllables) {
    const f = (t - s.at) / s.length;
    if (f > 0 && f < 1) open = Math.max(open, VOWEL_OPENING[s.vowel] * Math.sin(Math.PI * Math.min(f * 1.6, 1)) ** 0.7 * Math.min((1 - f) * 4, 1));
  }
  return open;
}

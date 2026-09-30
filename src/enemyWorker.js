// Builds characters in the background (a web worker), so the game doesn't
// stall while their shapes are sculpted: it makes each character asked for,
// and sends back the shapes it sculpted (see geometryCaches.js), which the
// page puts in its own caches. Making the character there is then quick.
//
// Message in: { id, appearance, options } (as for new CharacterModel).
// Message out: { id, entries } (see packGeometryCaches), or { id, error }.
import { CharacterModel } from './characterModel.js';
import { clearGeometryCaches, packGeometryCaches } from './geometryCaches.js';

self.onmessage = ({ data: { id, appearance, options } }) => {
  try {
    // (Starting from empty caches, so every shape this character uses is sent.)
    clearGeometryCaches();
    const model = new CharacterModel(appearance, options);
    const { entries, transfer } = packGeometryCaches();
    model.dispose();
    clearGeometryCaches();
    self.postMessage({ id, entries }, transfer);
  } catch (error) {
    self.postMessage({ id, error: String(error?.stack ?? error) });
  }
};

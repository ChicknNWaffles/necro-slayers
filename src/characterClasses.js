// Shared by the character creator and combat rules.
export const CLASSES = {
  // All four of Evalyn's spells, and two she doesn't know.
  cleric: {
    spells: ['smite', 'divineBlade', 'divineRestoration', 'shieldOfFaith', 'sovereignAid', 'cleansingLight'],
    slots: 4,
  },
  // A sword, a shield, and a halberd -- two hands' worth of them: the sword
  // and shield can be carried together, but the halberd takes both hands.
  fighter: {
    weapons: ['sword', 'shield', 'halberd'],
    slots: 2,
  },
  // One of three bows (chosen at character creation), and a dagger for when
  // enemies get too close. (The player only -- no NPC archers.)
  archer: {
    bows: ['shortbow', 'longbow', 'crossbow'],
  },
  // Six spells of fire, nature and arcane power, of which the player picks
  // four.
  mage: {
    spells: ['fireball', 'vineTrap', 'powerShove', 'wallOfEarth', 'leachBomb', 'burningGround'],
    slots: 4,
    magic: 'fire', // (the colour of the glow in their hands)
  },
};

export const WEAPONS = {
  sword: { label: 'Sword', hands: 1, moves: ['stab', 'slash'] },
  shield: { label: 'Shield', hands: 1, moves: ['block', 'bash'] },
  halberd: { label: 'Halberd', hands: 2, moves: ['axeSlash', 'hammer'] },
  shortbow: { label: 'Short Bow', hands: 2, moves: ['shortbowShot'] },
  longbow: { label: 'Long Bow', hands: 2, moves: ['longbowShot'] },
  crossbow: { label: 'Crossbow', hands: 2, moves: ['crossbowShot'] },
  dagger: { label: 'Dagger', hands: 1, moves: ['daggerStab'] },
};

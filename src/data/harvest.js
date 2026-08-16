// Central tuning for everything you break with a tool.
//
// Nothing in here is wired to a Tree or Rock class. A harvestable declares how
// many swings it takes, which tool class makes progress on it, what it pays out,
// how it dies, and which feedback profile to play. Adding ore, crates, metal
// objects or anything else later is a new entry in HARVEST — not a new code path.

/**
 * How a swing lands, chosen by the tool's class rather than by what's being hit.
 *
 * `impactAt` is the point in the clip where the head of the tool actually
 * arrives. Damage, particles and sound all fire on that frame instead of on the
 * button press, which is what makes a hit feel like contact rather than input.
 */
export const SWING_STYLES = {
  chop:    { clip: 'chop', duration: 0.72, impactAt: 0.40 },
  mine:    { clip: 'mine', duration: 0.80, impactAt: 0.46 },
  salvage: { clip: 'chop', duration: 0.72, impactAt: 0.40 },
  none:    { clip: 'swing', duration: 0.55, impactAt: 0.38 },
};

export const swingStyle = (toolClass) => SWING_STYLES[toolClass] ?? SWING_STYLES.none;

/**
 * Impact feedback profiles. Kept separate from the harvestables so several
 * resources can share one look, and so a designer can retune the feel of every
 * wooden thing in the game from a single line.
 */
export const IMPACT_FX = {
  wood: {
    chips: { count: 7, color: 0x8a6a42, size: [0.04, 0.09], speed: [1.6, 3.4], life: [0.35, 0.65] },
    dust:  { count: 3, color: 0xc7b48d, size: [0.06, 0.12], speed: [0.4, 1.1], life: [0.5, 0.9] },
    sound: 'chop',
    shake: 0.16,
  },
  stone: {
    chips: { count: 9, color: 0x9aa0a6, size: [0.03, 0.07], speed: [2.0, 4.2], life: [0.3, 0.6] },
    dust:  { count: 4, color: 0xb9b3a6, size: [0.07, 0.14], speed: [0.4, 1.2], life: [0.5, 1.0] },
    sound: 'mine',
    shake: 0.2,
  },
  ore: {
    chips: { count: 10, color: 0xc87a2e, size: [0.03, 0.07], speed: [2.2, 4.4], life: [0.3, 0.6] },
    dust:  { count: 4, color: 0xb9b3a6, size: [0.07, 0.13], speed: [0.4, 1.2], life: [0.5, 1.0] },
    sound: 'mine',
    shake: 0.22,
  },
  metal: {
    chips: { count: 8, color: 0xb4643f, size: [0.03, 0.08], speed: [2.0, 4.0], life: [0.3, 0.6] },
    dust:  { count: 2, color: 0x8a8378, size: [0.05, 0.1], speed: [0.4, 1.0], life: [0.4, 0.8] },
    sound: 'metal',
    shake: 0.2,
  },
  leaf: {
    chips: { count: 6, color: 0x6f9b4a, size: [0.05, 0.1], speed: [1.2, 2.6], life: [0.4, 0.8] },
    dust:  { count: 0 },
    sound: 'soft',
    shake: 0.06,
  },
};

/**
 * Harvestables.
 *
 *  maxHp / damagePerHit  swing count, not a damage pool — maxHp 5 with a
 *                        damagePerHit of 1 is a five-swing tree. A better tool
 *                        raises damagePerHit through its own `power`.
 *  tool                  the tool class that makes progress. null means bare
 *                        hands are fine. Anything else gets no progress at all,
 *                        which is what pushes a new player at the branches and
 *                        loose stones lying on the ground first.
 *  hitCooldown           seconds between swings (the swing clip is scaled to fit)
 *  reward                paid out when it finally breaks
 *  perHit                small trickle on each landed hit; omit for none
 *  death                 how it goes away: 'topple' | 'shatter' | 'shrink'
 */
export const HARVEST = {
  tree: {
    tool: 'chop', maxHp: 5, damagePerHit: 1, hitCooldown: 0.8,
    reward: [{ id: 'wood', min: 5, max: 10 }, { id: 'fiber', min: 0, max: 2 }],
    perHit: [{ id: 'wood', min: 0, max: 1 }],
    death: 'topple', fx: 'wood', respawn: 35,
    hitAt: 1.1,          // height up the trunk the tool connects at
  },
  bush: {
    tool: null, maxHp: 2, damagePerHit: 1, hitCooldown: 0.5,
    reward: [{ id: 'fiber', min: 2, max: 4 }, { id: 'berries', min: 0, max: 2 }],
    death: 'shrink', fx: 'leaf', respawn: 22,
    hitAt: 0.5,
  },
  rock: {
    tool: 'mine', maxHp: 4, damagePerHit: 1, hitCooldown: 0.8,
    reward: [{ id: 'stone', min: 4, max: 8 }],
    perHit: [{ id: 'stone', min: 0, max: 1 }],
    death: 'shatter', fx: 'stone', respawn: 45,
    hitAt: 0.7,
  },
  iron: {
    tool: 'mine', maxHp: 7, damagePerHit: 1, hitCooldown: 0.85,
    reward: [{ id: 'iron_ore', min: 2, max: 4 }, { id: 'stone', min: 1, max: 3 }],
    perHit: [{ id: 'stone', min: 0, max: 1 }],
    death: 'shatter', fx: 'ore', respawn: 65,
    hitAt: 0.8,
  },
  wreck: {
    tool: 'salvage', maxHp: 6, damagePerHit: 1, hitCooldown: 0.85,
    reward: [{ id: 'scrap', min: 3, max: 6 }],
    perHit: [{ id: 'scrap', min: 0, max: 1 }],
    death: 'shatter', fx: 'metal', respawn: 60,
    hitAt: 1.0,
  },
};

export const harvestDef = (type) => HARVEST[type] ?? null;

/**
 * Damage one swing of `weapon` does to `type`, in hit points.
 *
 * Returns 0 when the tool is wrong for the job — the caller turns that into a
 * "you need an axe for this" prompt rather than a slow, silent grind.
 */
export function swingDamage(type, weapon) {
  const def = HARVEST[type];
  if (!def) return 0;
  if (def.tool === null) return def.damagePerHit;
  if (!weapon || weapon.tool !== def.tool) return 0;
  return def.damagePerHit * (weapon.power ?? 1);
}

/** The tool class a harvestable wants, for prompts and animation selection. */
export const toolClassFor = (type) => HARVEST[type]?.tool ?? null;

export const TOOL_NAMES = {
  chop: 'an axe',
  mine: 'a pickaxe',
  salvage: 'a crowbar',
};

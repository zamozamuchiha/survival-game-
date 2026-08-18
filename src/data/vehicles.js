// Vehicle variants.
//
// A vehicle in the world is a body shell, a colour, a state of repair and a
// handful of things that fell off it. Keeping those four as data rather than as
// random numbers inside the generator is what makes the fleet tunable: the
// palette, how battered things are, and which ones can later be searched are all
// decided here, and the generator only carries them out.
//
// Decoration, collision and interaction are deliberately three separate fields.
// A vehicle that is only scenery still needs a collider so the player cannot
// walk through it, and may or may not be worth opening later — those are
// different questions and answering them in one flag is how a prop ends up
// solid but unsearchable by accident.
//
// Nothing here names or resembles a real manufacturer or model. The bodies are
// generic classes — saloon, estate van, pickup, four-by-four, box truck.

// ---------------------------------------------------------------- bodies

/**
 * `source` is the clean kit model the shell comes from. `length` is what the
 * vehicle measures nose to tail in metres, which is the one proportion every
 * player can judge on sight — a van that is saloon-sized reads as wrong
 * immediately, however good the texture is.
 */
export const BODIES = {
  saloon:  { id: 'saloon',  source: 'car_sedan',  length: 4.35, collide: 1.35, label: 'saloon' },
  estate:  { id: 'estate',  source: 'car_van',    length: 4.85, collide: 1.55, label: 'delivery van' },
  suv:     { id: 'suv',     source: 'car_suv',    length: 4.60, collide: 1.45, label: 'four-by-four' },
  pickup:  { id: 'pickup',  source: 'car_taxi',   length: 4.55, collide: 1.40, label: 'pickup' },
  box:     { id: 'box',     source: 'car_truck',  length: 5.40, collide: 1.75, label: 'box truck' },
  service: { id: 'service', source: 'car_ambo',   length: 5.10, collide: 1.65, label: 'service van' },
  patrol:  { id: 'patrol',  source: 'car_police', length: 4.45, collide: 1.40, label: 'patrol car' },
};

// ---------------------------------------------------------------- paint
//
// Muted throughout: a fleet of primary colours reads as a toy shop, and paint
// that has stood outside for years has no chroma left in it anyway. These are
// the colours the panels are tinted towards, not the colours they end up —
// dirt, rust and shading take them further down.

export const PAINTS = [
  { id: 'bone',    hex: 0xb9b3a4, name: 'faded white' },
  { id: 'ash',     hex: 0x8d9095, name: 'grey' },
  { id: 'olive',   hex: 0x6d7250, name: 'olive' },
  { id: 'navy',    hex: 0x46566a, name: 'dark blue' },
  { id: 'sand',    hex: 0xa8977a, name: 'beige' },
  { id: 'oxide',   hex: 0x8a5342, name: 'rusted red' },
  { id: 'moss',    hex: 0x5f6b5a, name: 'green' },
  { id: 'slate',   hex: 0x5a5e63, name: 'dark grey' },
];

export const paintById = (id) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];

// ---------------------------------------------------------------- condition
//
// Three states of repair, because "wrecked" is not one thing. A yard where every
// vehicle is equally destroyed reads as a texture; a yard where one looks like
// it might still start is a place where something happened.

// `flatTyres` and `missingWheels` are inclusive ranges. A range rather than a
// maximum matters for the derelicts: with a maximum, a third of them rolled zero
// and sat there on four good wheels, which is the one thing a stripped vehicle
// never does.
export const CONDITIONS = {
  // Parked and left. Dusty, a little faded, everything still attached.
  used: {
    id: 'used',
    dents: 0.25, crumple: 0, rust: 0.28, grime: 0.5,
    flatTyres: [0, 1], missingWheels: [0, 0],
    glass: 'intact',
    bonnet: false, repairs: 0.15, debris: [0, 1],
  },
  // Been in something, or been stripped for parts. Still obviously a vehicle.
  damaged: {
    id: 'damaged',
    dents: 0.7, crumple: 0.55, rust: 0.6, grime: 0.75,
    flatTyres: [1, 3], missingWheels: [0, 1],
    glass: 'cracked',
    bonnet: true, repairs: 0.4, debris: [1, 3],
  },
  // Scenery. Not going anywhere again, but still reads as what it was.
  derelict: {
    id: 'derelict',
    dents: 1, crumple: 1, rust: 0.9, grime: 0.9,
    flatTyres: [2, 3], missingWheels: [1, 2],
    glass: 'gone',
    bonnet: true, repairs: 0.25, debris: [2, 4],
  },
};

export const conditionById = (id) => CONDITIONS[id] ?? CONDITIONS.damaged;

// ---------------------------------------------------------------- variants
//
// The pool the world draws from. Baked once at boot and placed by reference, so
// a map with a dozen vehicles costs a dozen instanced draws rather than a dozen
// unique meshes — see the note on VARIANT_KEYS below.
//
// Spread deliberately: mostly `damaged`, a few `derelict` to carry the ruin, and
// a couple of `used` so the fleet is not uniformly finished.

export const VARIANTS = [
  { id: 'veh_a', body: 'saloon',  paint: 'bone',  condition: 'damaged',  loot: 'searchable' },
  { id: 'veh_b', body: 'saloon',  paint: 'navy',  condition: 'derelict', loot: 'none' },
  { id: 'veh_c', body: 'estate',  paint: 'olive', condition: 'damaged',  loot: 'searchable' },
  { id: 'veh_d', body: 'estate',  paint: 'ash',   condition: 'used',     loot: 'searchable' },
  { id: 'veh_e', body: 'suv',     paint: 'slate', condition: 'damaged',  loot: 'searchable' },
  { id: 'veh_f', body: 'suv',     paint: 'sand',  condition: 'derelict', loot: 'none' },
  { id: 'veh_g', body: 'pickup',  paint: 'oxide', condition: 'damaged',  loot: 'searchable' },
  { id: 'veh_h', body: 'pickup',  paint: 'moss',  condition: 'used',     loot: 'searchable' },
  { id: 'veh_i', body: 'box',     paint: 'bone',  condition: 'derelict', loot: 'none' },
  { id: 'veh_j', body: 'box',     paint: 'navy',  condition: 'damaged',  loot: 'searchable' },
  { id: 'veh_k', body: 'service', paint: 'bone',  condition: 'damaged',  loot: 'searchable' },
  { id: 'veh_l', body: 'patrol',  paint: 'slate', condition: 'derelict', loot: 'none' },
];

/** Model keys the world places. One per variant, registered in world/models.js. */
export const VARIANT_KEYS = VARIANTS.map((v) => v.id);

export const variantById = (id) => VARIANTS.find((v) => v.id === id) ?? null;

/** Everything the generator and the placer need, resolved in one call. */
export function resolveVariant(id) {
  const v = variantById(id);
  if (!v) return null;
  const body = BODIES[v.body];
  return {
    ...v,
    body,
    paint: paintById(v.paint),
    condition: conditionById(v.condition),
    // Collision is a plain circle, not the body shape: the player only needs to
    // be kept out of it, and a capsule per panel would cost more than the whole
    // vehicle is worth.
    collider: { radius: body.collide },
  };
}

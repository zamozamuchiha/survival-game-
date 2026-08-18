// The land your base may stand on.
//
// The build area is a grid of plots rather than one rectangle. The middle one is
// yours from the first minute; the eight around it are bought with $SURV. Buying
// ground you can see but cannot yet use is a clearer goal than an abstract
// "capacity" number, and it puts the reward somewhere the player already looks.
//
// Sizes are in build cells (see CELL in data/building.js — one cell is 2 m), so
// nothing here needs to know about metres or about how a wall is placed.

export const PLOT_CELLS = 5;          // a plot is 5x5 cells: 10 m x 10 m
export const PLOT_GRID = 1;           // plot coordinates run -1..1, so 3x3 plots

export const plotId = (px, pz) => `plot_${px}_${pz}`;
export const HOME_PLOT = plotId(0, 0);

/**
 * Which plot a build cell falls in.
 *
 * Plots are centred on multiples of PLOT_CELLS and reach half that either way,
 * so a cell's coordinate divided by the plot size lands within 0.4 of its own
 * plot and rounding is exact — no clamping, no off-by-one at the seams.
 */
export const plotCoordFor = (gx, gz) =>
  [Math.round(gx / PLOT_CELLS), Math.round(gz / PLOT_CELLS)];

// Price and level per plot. The four that share an edge with home are the cheap
// ones and come first; the corners cost more and are gated higher, because a
// corner doubles your frontage in two directions at once.
//
// Prices climb steeply on purpose: the first expansion should be reachable in
// the first session, the last should be something you work towards.
const TUNING = {
  '0,-1':  { price: 100,  lvl: 2, name: 'North Yard' },
  '1,0':   { price: 250,  lvl: 3, name: 'East Yard' },
  '0,1':   { price: 500,  lvl: 3, name: 'South Yard' },
  '-1,0':  { price: 900,  lvl: 4, name: 'West Yard' },
  '1,-1':  { price: 1500, lvl: 4, name: 'North-East Corner' },
  '1,1':   { price: 2400, lvl: 5, name: 'South-East Corner' },
  '-1,1':  { price: 3600, lvl: 5, name: 'South-West Corner' },
  '-1,-1': { price: 5200, lvl: 6, name: 'North-West Corner' },
};

function makePlots() {
  const out = [];
  const half = (PLOT_CELLS - 1) / 2;
  for (let px = -PLOT_GRID; px <= PLOT_GRID; px++) {
    for (let pz = -PLOT_GRID; pz <= PLOT_GRID; pz++) {
      const home = px === 0 && pz === 0;
      const tune = TUNING[`${px},${pz}`];
      out.push({
        id: plotId(px, pz),
        px, pz,
        name: home ? 'Home Plot' : tune?.name ?? `Plot ${px},${pz}`,
        // Inclusive cell bounds. Everything else derives position from these, so
        // there is one definition of where a plot is.
        min: { gx: px * PLOT_CELLS - half, gz: pz * PLOT_CELLS - half },
        max: { gx: px * PLOT_CELLS + half, gz: pz * PLOT_CELLS + half },
        price: home ? 0 : tune?.price ?? 1000,
        lvl: home ? 0 : tune?.lvl ?? 1,
        free: home,                      // unlocked from the start, never for sale
      });
    }
  }
  return out;
}

export const PLOTS = makePlots();
export const plotById = (id) => PLOTS.find((p) => p.id === id) ?? null;

/** How far the whole grid reaches, in cells — the hard edge of buildable ground. */
export const LAND_HALF_CELLS = PLOT_GRID * PLOT_CELLS + (PLOT_CELLS - 1) / 2;

export const inPlotBounds = (plot, gx, gz) =>
  gx >= plot.min.gx && gx <= plot.max.gx && gz >= plot.min.gz && gz <= plot.max.gz;

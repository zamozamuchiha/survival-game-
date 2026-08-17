import * as THREE from 'three';

// Procedural PBR maps.
//
// No image files ship with the project, so every surface is generated once at
// boot from a height field: the height drives a normal map, a roughness map and
// the shading of the base colour, which is what keeps bark, stone and cut timber
// from reading as flat painted plastic.
//
// Maps are cached by name — a hundred trees share one bark texture.

const cache = new Map();

// ---------------------------------------------------------------- noise

/** Deterministic 2D value hash in [0,1). */
function hash2(x, y, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** Fractal noise. `stretch` squashes the sample grid to get directional grain. */
function fbm(x, y, seed, octaves = 4, stretchX = 1, stretchY = 1) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq * stretchX, y * freq * stretchY, seed + o * 13) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

/** Ridged noise — the sharp creases that read as cracks and bark furrows. */
function ridge(x, y, seed, octaves = 3, stretchX = 1, stretchY = 1) {
  let sum = 0;
  let amp = 0.6;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = Math.abs(valueNoise(x * freq * stretchX, y * freq * stretchY, seed + o * 29) * 2 - 1);
    sum += (1 - n) * amp;
    norm += amp;
    amp *= 0.55;
    freq *= 2.13;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- map building

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function makeTexture(canvas, { srgb = false, repeat = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Turns a height field into a tangent-space normal map.
 *
 * Sobel over the neighbours, wrapped at the edges so the result tiles as
 * seamlessly as the height field does.
 */
function normalFromHeight(height, size, strength) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
               - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
               - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len;
      const nzn = nz / len;

      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nzn * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Writes a greyscale field (roughness, AO) into a canvas. */
function greyMap(field, size) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(255, field[i] * 255)) | 0;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Writes an RGB field into a canvas. `field` returns [r,g,b] in 0..1. */
function colorMap(size, fn) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rgb = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x, y, rgb);
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, rgb[0] * 255));
      img.data[i + 1] = Math.max(0, Math.min(255, rgb[1] * 255));
      img.data[i + 2] = Math.max(0, Math.min(255, rgb[2] * 255));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- surfaces

/**
 * Bark: vertical furrows with cross-breaking, so it reads as a trunk from any
 * angle rather than as combed stripes.
 */
function buildBark(size, seed, tint) {
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const s = 8;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * s;
      const v = (y / size) * s;
      // Furrows run along the trunk: stretched hard in V, tight in U.
      const furrow = ridge(u, v, seed, 4, 3.4, 0.42);
      const grain = fbm(u, v, seed + 5, 4, 6.0, 0.9) * 0.35;
      const knots = Math.pow(fbm(u * 0.4, v * 0.4, seed + 11, 2), 3) * 0.5;
      const h = furrow * 0.7 + grain + knots;
      const i = y * size + x;
      height[i] = h;
      rough[i] = 0.72 + h * 0.24;
    }
  }

  const base = colorMap(size, (x, y, out) => {
    const i = y * size + x;
    const h = height[i];
    // Deep furrows go darker and slightly cooler; ridges catch the light.
    const shade = mix(0.38, 1.12, Math.pow(h, 1.25));
    const patch = fbm((x / size) * 3, (y / size) * 3, seed + 21, 3) * 0.22 + 0.89;
    out[0] = tint[0] * shade * patch;
    out[1] = tint[1] * shade * patch;
    out[2] = tint[2] * shade * patch * 0.97;
  });

  return {
    map: makeTexture(base, { srgb: true }),
    normalMap: makeTexture(normalFromHeight(height, size, 2.6)),
    roughnessMap: makeTexture(greyMap(rough, size)),
  };
}

/** Cut timber: rings on the end grain plus long fibres along the length. */
function buildTimber(size, seed, tint) {
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const knots = new Float32Array(size * size);
  const late = new Float32Array(size * size);    // dense latewood bands
  const grime = new Float32Array(size * size);
  const s = 6;

  // Flat-sawn timber: the saw passes to one side of the pith, so the growth
  // rings surface as nested arcs — the "cathedral" figure that is the single
  // most recognisable thing about a real board. The pith sits off the plank, and
  // the rings are the level sets of the distance to it.
  const pithV = -1.7;                              // heart of the tree, off-board
  const ringFreq = 26;

  // A handful of knots per board, each with a position and a size. The grain has
  // to bend around these, not just darken: a knot with straight grain running
  // through it reads as a printed dot.
  const knotList = [];
  const knotCount = 2 + Math.floor(hash2(seed, 7, 3) * 3);
  for (let k = 0; k < knotCount; k++) {
    knotList.push({
      u: hash2(seed + k * 13, 1, 11) * s,
      v: hash2(seed + k * 13, 2, 17) * s,
      r: 0.10 + hash2(seed + k * 13, 3, 23) * 0.16,
    });
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let u = (x / size) * s;
      const v = (y / size) * s;

      // Pull the grain around each knot. Displacing the sample point is what
      // makes the rings sweep past it the way fibres divert around a branch.
      let knot = 0;
      for (const kn of knotList) {
        const du = u - kn.u;
        const dv = v - kn.v;
        const d = Math.hypot(du, dv);
        if (d < kn.r * 4.5) {
          const pull = Math.exp(-(d * d) / (kn.r * kn.r * 2.2));
          u += dv * pull * 1.7;                    // swirl the grain aside
          knot = Math.max(knot, Math.exp(-(d * d) / (kn.r * kn.r * 0.55)));
        }
      }
      knots[i] = knot;

      // Growth rings. Warping the distance before taking the ring phase gives
      // the wandering, non-concentric arcs of real timber instead of a rule.
      const warp = (fbm(u * 0.5, v * 0.5, seed + 5, 3) - 0.5) * 0.9;
      const dist = Math.hypot(u * 0.32 + warp, v - pithV);
      const ring = 0.5 - 0.5 * Math.cos(dist * ringFreq);
      // Latewood is the narrow dark half of each ring, and it is harder — so it
      // stands proud when the softer earlywood weathers back.
      const band = Math.pow(ring, 2.4);
      late[i] = band;

      // Fibres. Broad and soft on purpose: the visible grain of a board is its
      // growth rings, and piling fine streaks on top of them turns the whole
      // surface into corduroy rather than wood.
      const fibre = fbm(u, v, seed, 3, 6.5, 0.8);
      // Vessels: the open pores of a hardwood, scattered rather than combed.
      const pores = Math.pow(fbm(u * 2.4, v * 2.4, seed + 47, 2, 3.0, 1.0), 3.5) * 0.5;
      // Checks: splits that open along the grain as the board dries.
      const check = Math.pow(ridge(u * 1.1, v, seed + 3, 2, 2.2, 14.0), 6) * 0.8;

      grime[i] = Math.pow(fbm(u * 0.6, v * 0.6, seed + 61, 3), 2.0);

      // Rings carry the relief; everything else only breaks them up.
      const h = band * 0.52 + fibre * 0.16 - pores * 0.2 - check - knot * 0.45;
      height[i] = h;
      // Dense latewood and knots polish up; open earlywood and splits stay matt.
      rough[i] = 0.94 - band * 0.2 - knot * 0.14 + check * 0.08 + pores * 0.05 - grime[i] * 0.05;
    }
  }

  const base = colorMap(size, (x, y, out) => {
    const i = y * size + x;
    const h = height[i];
    const band = late[i];
    const k = knots[i];
    const dirt = grime[i];

    // Colour comes mostly from the rings: latewood is markedly darker and
    // warmer than the earlywood beside it. That contrast is the grain.
    const ringShade = mix(1.12, 0.62, band);
    // Broad drifts of lighter and darker timber down the length of the board.
    const drift = fbm((x / size) * 1.6, (y / size) * 1.6, seed + 31, 3, 6, 0.5) * 0.26 + 0.87;
    const relief = mix(0.9, 1.08, h);
    const shade = ringShade * drift * relief;

    // Knots: dark, red, and the heart of the knot darker still.
    const kd = 1 - k * 0.55;
    // Grime greys the timber down where hands and weather get at it.
    const g = 1 - dirt * 0.22;

    out[0] = tint[0] * shade * kd * g;
    out[1] = tint[1] * shade * (1 - k * 0.68) * (g - dirt * 0.02);
    out[2] = tint[2] * shade * (1 - k * 0.76) * (g - dirt * 0.03);
  });

  return {
    map: makeTexture(base, { srgb: true }),
    normalMap: makeTexture(normalFromHeight(height, size, 1.5)),
    roughnessMap: makeTexture(greyMap(rough, size)),
  };
}

/**
 * The cut end of a board or log: growth rings seen square on.
 *
 * Completely different from the face grain, and that difference is the whole
 * point — an end that shows the same long streaks as the face is the clearest
 * sign that a texture has simply been wrapped round a box.
 */
function buildTimberEnd(size, seed, tint) {
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const late = new Float32Array(size * size);
  const s = 2.4;
  // The pith is off centre. It always is — a tree grows towards the light, and a
  // stump with the heart dead in the middle is the first thing that reads as
  // drawn rather than cut.
  const cx = s * 0.5 + (hash2(seed, 1, 5) - 0.5) * 0.22;
  const cy = s * 0.5 + (hash2(seed, 2, 7) - 0.5) * 0.22;

  // One entry per year of growth, each with its own width. Wide near the heart
  // where the young tree raced up, narrowing as it aged, and every year scaled
  // by how good that year was. Evenly spaced rings are a target, not a tree.
  const bounds = [0];
  for (let k = 0; k < 90 && bounds[bounds.length - 1] < s; k++) {
    const age = 1 - Math.min(1, k / 70);                 // juvenile growth is wider
    const season = 0.35 + hash2(seed + 3, k, 13) * 1.3;  // good years and bad
    bounds.push(bounds[bounds.length - 1] + 0.012 + 0.052 * age * season);
  }

  // Reaction wood: a leaning trunk lays down more on one side, so the rings sit
  // off-centre as well as spaced unevenly.
  const leanAng = hash2(seed, 4, 17) * Math.PI * 2;
  const leanAmt = 0.1 + hash2(seed, 5, 19) * 0.16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x / size) * s;
      const v = (y / size) * s;
      const du = u - cx;
      const dv = v - cy;

      // Rings are never truly round: warp the radius and squash one axis.
      const warp = (fbm(u * 1.4, v * 1.4, seed + 9, 3) - 0.5) * 0.3;
      const ang = Math.atan2(dv, du);
      const lean = 1 - Math.cos(ang - leanAng) * leanAmt;
      const r = (Math.hypot(du * 1.06, dv * 0.94) + warp) * lean;

      // Which year's ring is this, and how far through it? Earlywood is the pale
      // open first half, latewood the dark dense band that closes it.
      let k = 1;
      while (k < bounds.length - 1 && bounds[k] < r) k++;
      const inner = bounds[k - 1];
      const span = Math.max(1e-4, bounds[k] - inner);
      const through = Math.min(1, Math.max(0, (r - inner) / span));
      const band = Math.pow(through, 3.0);
      late[i] = band;

      // Medullary rays: fine spokes running out from the pith.
      const rays = Math.pow(0.5 + 0.5 * Math.cos(ang * 46 + warp * 8), 6) * 0.35;
      // Radial checks: a cut end dries fastest and splits outward from the pith.
      const checkSeed = Math.pow(0.5 + 0.5 * Math.cos(ang * 7 + fbm(r * 2, 0, seed + 3, 2) * 5), 22);
      const check = checkSeed * Math.min(1, r * 1.6) * 0.85;
      // The pith itself: a soft dark centre.
      const pith = Math.exp(-(r * r) / 0.004);

      const h = band * 0.5 + rays * 0.3 - check - pith * 0.4;
      height[i] = h;
      rough[i] = 0.97 - band * 0.16 + check * 0.03;
    }
  }

  const base = colorMap(size, (x, y, out) => {
    const i = y * size + x;
    const band = late[i];
    // End grain is paler and more open than the face — it is raw cut fibre.
    const shade = mix(1.2, 0.66, band) * mix(0.94, 1.06, height[i]);
    out[0] = tint[0] * shade * 1.06;
    out[1] = tint[1] * shade * 1.02;
    out[2] = tint[2] * shade * 0.94;
  });

  return {
    map: makeTexture(base, { srgb: true }),
    normalMap: makeTexture(normalFromHeight(height, size, 2.0)),
    roughnessMap: makeTexture(greyMap(rough, size)),
  };
}

/** Stone: pitted surface with sharp cracks running through it. */
function buildStone(size, seed, tint) {
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const s = 5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * s;
      const v = (y / size) * s;
      const lumps = fbm(u, v, seed, 5);
      // Cracks: thin, dark, and deeper than the pitting around them.
      const crack = Math.pow(ridge(u * 0.9, v * 0.9, seed + 7, 3), 6);
      const pits = Math.pow(fbm(u * 3.5, v * 3.5, seed + 17, 3), 2.2) * 0.3;
      const h = lumps * 0.6 + pits - crack * 0.55;
      const i = y * size + x;
      height[i] = h;
      rough[i] = 0.78 + (1 - h) * 0.2;
    }
  }

  const base = colorMap(size, (x, y, out) => {
    const i = y * size + x;
    const h = height[i];
    const shade = mix(0.42, 1.1, Math.max(0, h));
    // Mineral banding so it isn't one flat grey.
    const band = fbm((x / size) * 1.6, (y / size) * 1.6, seed + 41, 3) * 0.26 + 0.87;
    const warm = fbm((x / size) * 4, (y / size) * 4, seed + 53, 2) * 0.1;
    out[0] = tint[0] * shade * band * (1 + warm);
    out[1] = tint[1] * shade * band;
    out[2] = tint[2] * shade * band * (1 - warm * 0.6);
  });

  return {
    map: makeTexture(base, { srgb: true }),
    normalMap: makeTexture(normalFromHeight(height, size, 2.2)),
    roughnessMap: makeTexture(greyMap(rough, size)),
  };
}

/**
 * Foliage: clumped leaf mass with light and dark patches, no hard tiling.
 *
 * Kept near-white on purpose. The species colour comes from the material, and
 * tinting here as well would multiply the two and turn every canopy black.
 */
function buildFoliage(size, seed, tint) {
  const height = new Float32Array(size * size);
  const s = 7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * s;
      const v = (y / size) * s;
      const clumps = fbm(u, v, seed, 4, 1.6, 1.6);
      const leaves = fbm(u * 5, v * 5, seed + 9, 2) * 0.4;
      height[y * size + x] = clumps * 0.7 + leaves;
    }
  }
  const base = colorMap(size, (x, y, out) => {
    const h = height[y * size + x];
    const shade = mix(0.68, 1.15, h);
    // Older leaves go yellow, shaded ones go blue-green.
    const age = fbm((x / size) * 2.5, (y / size) * 2.5, seed + 61, 3);
    out[0] = tint[0] * shade * (0.92 + age * 0.30);
    out[1] = tint[1] * shade * (0.98 + age * 0.10);
    out[2] = tint[2] * shade * (1.02 - age * 0.22);
  });
  return {
    map: makeTexture(base, { srgb: true }),
    normalMap: makeTexture(normalFromHeight(height, size, 1.2)),
  };
}

/**
 * Ground: soil with a short grass mat over it, plus the grit and litter that
 * stops a field reading as a painted plane — small stones, dry patches, dirt.
 *
 * The grass geometry sits on top of this; the texture has to hold up on its own
 * in the gaps between blades and in the distance where the blades stop.
 */
function buildGround(size, seed, soil, grass) {
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const grassMask = new Float32Array(size * size);
  const s = 6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * s;
      const v = (y / size) * s;
      const i = y * size + x;

      // Fine matted texture, plus coarse clumping so it isn't uniform.
      const mat = fbm(u * 6, v * 6, seed, 3);
      const clump = fbm(u, v, seed + 3, 4);
      // Grit: sparse, small, higher than the mat around it.
      const grit = Math.pow(fbm(u * 14, v * 14, seed + 8, 2), 5) * 2.2;
      // Bare patches where soil shows through. Kept rare and shallow: the blades
      // standing on this only cover so much, so anything the texture leaves bare
      // reads as a hole in the sward rather than as honest dirt.
      const bare = Math.pow(fbm(u * 1.6, v * 1.6, seed + 12, 3), 5.0);

      height[i] = mat * 0.5 + clump * 0.3 + grit;
      grassMask[i] = Math.max(0, Math.min(1, 0.55 + (clump * 0.7 + mat * 0.4) * 1.4 - bare * 1.1));
      rough[i] = 0.86 + (1 - height[i]) * 0.12;
    }
  }

  const base = colorMap(size, (x, y, out) => {
    const i = y * size + x;
    const h = height[i];
    const g = grassMask[i];
    // Centred near 1: this map is multiplied by the biome's vertex colour, so a
    // mean much below 1 drags the whole world dark.
    const shade = mix(0.86, 1.16, h);
    // Grass colour varies on its own, so patches read as growth not as noise.
    const hue = fbm((x / size) * 3, (y / size) * 3, seed + 21, 3);
    for (let c = 0; c < 3; c++) {
      const soilC = soil[c] * mix(0.78, 1.12, fbm((x / size) * 5, (y / size) * 5, seed + 31, 2));
      const grassC = grass[c] * (c === 1 ? 0.9 + hue * 0.35 : 0.85 + hue * 0.3);
      out[c] = mix(soilC, grassC, g) * shade;
    }
  });

  return {
    map: makeTexture(base, { srgb: true }),
    normalMap: makeTexture(normalFromHeight(height, size, 1.5)),
    roughnessMap: makeTexture(greyMap(rough, size)),
  };
}

/**
 * Worked metal: forged unevenness, grinding marks along one axis, scratches and
 * pitting from use.
 *
 * The roughness map does most of the work here. A blade that is uniformly shiny
 * reads as plastic; what makes metal look like metal is that worn spots, scratch
 * lines and pits all catch the light differently from the ground faces around
 * them.
 */
function buildMetal(size, seed, tint, { rust = 0 } = {}) {
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const wear = new Float32Array(size * size);
  const s = 5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * s;
      const v = (y / size) * s;
      const i = y * size + x;

      // Hammered/forged undulation, broad and soft.
      const forged = fbm(u, v, seed, 3) * 0.5;
      // Grinding: fine parallel lines from being dressed on a stone.
      const grind = fbm(u, v, seed + 4, 2, 22, 0.6) * 0.18;
      // Scratches: sparse, sharp, crossing the grind at an angle.
      const scratch = Math.pow(fbm(u * 1.4 + v * 0.5, v * 1.4, seed + 9, 2, 14, 1.1), 6) * 1.6;
      // Pitting where it has been knocked about.
      const pits = Math.pow(fbm(u * 7, v * 7, seed + 15, 2), 4) * 0.6;

      height[i] = forged + grind - pits * 0.5 - scratch * 0.2;
      wear[i] = Math.min(1, scratch + pits * 0.7);
      // Worn and pitted areas scatter light; dressed faces stay tighter.
      rough[i] = 0.28 + wear[i] * 0.45 + forged * 0.22;
    }
  }

  const base = colorMap(size, (x, y, out) => {
    const i = y * size + x;
    const shade = mix(0.72, 1.12, height[i] + 0.3);
    const w = wear[i];
    // Rust blooms in patches, strongest where the surface is already pitted.
    const bloom = rust > 0
      ? Math.min(1, Math.pow(fbm((x / size) * 2.5, (y / size) * 2.5, seed + 21, 3), 1.8) * 2.2 * rust + w * rust * 0.5)
      : 0;
    const r = mix(tint[0], 0.42, bloom);
    const g = mix(tint[1], 0.22, bloom);
    const b = mix(tint[2], 0.12, bloom);
    // Scratches show bright bare metal.
    out[0] = (r + w * 0.18) * shade;
    out[1] = (g + w * 0.18) * shade;
    out[2] = (b + w * 0.18) * shade;
  });

  return {
    map: makeTexture(base, { srgb: true }),
    normalMap: makeTexture(normalFromHeight(height, size, 1.6)),
    roughnessMap: makeTexture(greyMap(rough, size)),
  };
}

// ---------------------------------------------------------------- public

const BUILDERS = {
  bark:      (size, seed) => buildBark(size, seed, [0.42, 0.33, 0.25]),
  barkDark:  (size, seed) => buildBark(size, seed, [0.30, 0.24, 0.19]),
  barkPale:  (size, seed) => buildBark(size, seed, [0.55, 0.48, 0.38]),
  timber:    (size, seed) => buildTimber(size, seed, [0.66, 0.50, 0.33]),
  // Sawn ends. Same timber, seen across the fibres instead of along them.
  timberEnd: (size, seed) => buildTimberEnd(size, seed, [0.70, 0.55, 0.38]),
  stone:     (size, seed) => buildStone(size, seed, [0.52, 0.51, 0.49]),
  stoneWarm: (size, seed) => buildStone(size, seed, [0.55, 0.48, 0.40]),
  foliage:   (size, seed) => buildFoliage(size, seed, [0.92, 0.95, 0.86]),
  // Near-white tints for the same reason as foliage: the biome supplies the
  // colour through vertex colours, these maps only supply detail and contrast.
  ground:    (size, seed) => buildGround(size, seed, [1.02, 0.92, 0.76], [0.86, 1.05, 0.70]),
  groundDry: (size, seed) => buildGround(size, seed, [1.05, 0.98, 0.84], [0.98, 1.02, 0.78]),
  // Steel, well used but maintained.
  metal:     (size, seed) => buildMetal(size, seed, [0.66, 0.68, 0.71], { rust: 0.18 }),
  // Salvaged iron: neglected, rusting through.
  metalRust: (size, seed) => buildMetal(size, seed, [0.58, 0.56, 0.54], { rust: 0.7 }),
  // Knapped stone for the first tools — no grinding marks, heavy pitting.
  flint:     (size, seed) => buildStone(size, seed, [0.46, 0.45, 0.44]),
};

/**
 * A blade-cluster alpha mask: a handful of tapered blades on a transparent quad.
 * Used by the grass field so one quad reads as several blades.
 */
export function bladeAlpha(size = 128, seed = 1) {
  const key = `blades:${size}:${seed}`;
  if (cache.has(key)) return cache.get(key);

  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const baseX = (i + 0.5) / blades * size + (hash2(i, 3, seed) - 0.5) * size * 0.10;
    // Only a slight lean: these are blades standing up, not fronds flopping over.
    const lean = (hash2(i, 7, seed) - 0.5) * size * 0.16;
    const tipY = size * (0.04 + hash2(i, 11, seed) * 0.16);
    const halfW = size * (0.024 + hash2(i, 13, seed) * 0.016);
    // Brighter at the tip so the mask doubles as a cheap ambient-occlusion ramp.
    const shade = 150 + Math.floor(hash2(i, 17, seed) * 105);

    ctx.beginPath();
    ctx.moveTo(baseX - halfW, size);
    ctx.quadraticCurveTo(baseX - halfW * 0.5 + lean * 0.5, size * 0.5, baseX + lean, tipY);
    ctx.quadraticCurveTo(baseX + halfW * 0.5 + lean * 0.5, size * 0.5, baseX + halfW, size);
    ctx.closePath();
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fill();
  }

  const tex = makeTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, tex);
  return tex;
}

/**
 * Returns the map set for a named surface, building it on first use.
 * @returns { map, normalMap, roughnessMap? }
 */
export function surface(name, { size = 512, seed = 1 } = {}) {
  const key = `${name}:${size}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const build = BUILDERS[name];
  if (!build) return {};
  const maps = build(size, seed);
  cache.set(key, maps);
  return maps;
}

/**
 * A PBR material for a named surface.
 *
 * `repeat` is in texture tiles per metre of model, so a big rock and a pebble
 * get the same grain size rather than the same number of tiles.
 */
export function surfaceMaterial(name, opts = {}) {
  const { repeat = 1, color = 0xffffff, roughness = 1, metalness = 0, seed = 1, size = 512, flatShading = false } = opts;
  const maps = surface(name, { size, seed });
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    flatShading,
    map: maps.map ?? null,
    normalMap: maps.normalMap ?? null,
    roughnessMap: maps.roughnessMap ?? null,
  });
  if (repeat !== 1) {
    // Textures are shared, so a different tiling needs its own view of them.
    for (const slot of ['map', 'normalMap', 'roughnessMap']) {
      if (!mat[slot]) continue;
      mat[slot] = mat[slot].clone();
      mat[slot].needsUpdate = true;
      mat[slot].repeat.set(repeat, repeat);
    }
  }
  if (mat.normalMap) mat.normalScale = new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
  return mat;
}

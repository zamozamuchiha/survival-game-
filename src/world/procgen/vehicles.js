import * as THREE from 'three';
import { surface } from '../textures.js';

// Turning a clean kit vehicle into one that has stood outside for years.
//
// The kit bodies are decent shapes — the rake of a screen and the curve over an
// arch are already there — but they ship showroom-clean and brightly painted,
// which is what makes them read as toys in a ruined world. Rebuilding the shell
// from scratch was tried and was worse: extruded profiles lose exactly the
// curvature that says "car" and come out as slabs.
//
// So the shape is kept and everything else is done to it, driven by the variant
// config in data/vehicles.js rather than by dice:
//
//   paint    the kit's atlas is re-tinted to one muted body colour, then dirtied
//            and rusted per-vertex — heavier low down, where water sits
//   panels   dents, and a crumpled end on anything worse than `used`. Geometry,
//            not a decal, so damage holds up from every angle
//   glass    intact, cracked or gone
//   wheels   flat or missing to the variant's rule, and it settles onto what is left
//   extras   a bonnet propped open, a plank lashed over a window
//
// What is not done: doors are not cut out of the body mesh. The kit ships the
// shell as one piece, so a genuinely missing door would mean surgery on the
// geometry. A detached door leaning against the wing reads the same and costs
// nothing — see the debris pass in world/location.js.

// ---------------------------------------------------------------- noise

const hash = (x, y, z, s) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 3.3) * 43758.5453;
  return n - Math.floor(n);
};

function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const mix = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz, s);
  return mix(
    mix(mix(c(0, 0, 0), c(1, 0, 0), u), mix(c(0, 1, 0), c(1, 1, 0), u), v),
    mix(mix(c(0, 0, 1), c(1, 0, 1), u), mix(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// ---------------------------------------------------------------- paint

/**
 * A neutral copy of the kit's colour atlas.
 *
 * Vertex colours multiply the map, and multiplication can only darken — it can
 * never take the saturation out of a bright green van. So the atlas is stripped
 * to greyscale once and shared; the body colour then comes entirely from vertex
 * colours, which is what lets one shell be eight different faded paints.
 *
 * The atlas still separates glass from lamp from tyre, so those regions keep
 * their own value even after the colour is gone.
 */
let greyAtlas = null;
function neutralAtlas(source) {
  if (greyAtlas) return greyAtlas;
  const img = source?.image;
  if (!img || !img.width) return null;

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const grey = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    // Lifted towards white so the vertex colour has room to work: multiplying a
    // dark grey by a paint colour just gives a darker grey.
    const lifted = Math.min(255, grey * 0.55 + 118);
    px[i] = px[i + 1] = px[i + 2] = lifted;
  }
  ctx.putImageData(data, 0, 0);

  greyAtlas = new THREE.CanvasTexture(canvas);
  greyAtlas.colorSpace = source.colorSpace;
  greyAtlas.flipY = source.flipY;
  greyAtlas.wrapS = source.wrapS;
  greyAtlas.wrapT = source.wrapT;
  greyAtlas.needsUpdate = true;
  return greyAtlas;
}

/**
 * Body colour, then everything the weather has done to it.
 *
 * Rust blooms from the bottom because that is where water sits; dust settles on
 * the upward faces because that is where it lands. Getting those two the right
 * way round does more for believability than any amount of texture detail.
 */
function weather(geo, rng, { paint, rust, grime, glass, tintOnly = false }) {
  const pos = geo.attributes.position;
  const normals = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const height = Math.max(0.001, bb.max.y - bb.min.y);

  const base = new THREE.Color(paint.hex);
  const rusty = new THREE.Color(0x7a4526);
  const dust = new THREE.Color(0x9c9080);
  const WHITE = new THREE.Color(0xffffff);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const seed = rng() * 60;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const up = (v.y - bb.min.y) / height;

    // On a model with a real albedo the vertex colour multiplies it, so it has
    // to start at white — starting at the body colour would paint the car twice
    // and bury whatever the texture artist did.
    c.copy(tintOnly ? WHITE : base);

    // Sun-bleached on the upper surfaces, where a decade of light has fallen.
    c.lerp(new THREE.Color(0xd8d2c6), up * (tintOnly ? 0.1 : 0.18));

    // Rust, patchy and heavier low down.
    const patch = noise3(v.x * 2.7 + seed, v.y * 2.7, v.z * 2.7, 3);
    const bloom = Math.max(0, (patch - 0.4) * 2.3) * (1.3 - up * 0.85);
    c.lerp(rusty, Math.min(1, bloom * rust));

    // Dust and road dirt: on the horizontal faces, and thrown up the sills.
    const facing = normals ? Math.max(0, normals.getY(i)) : 0.5;
    const splash = Math.max(0, 1 - up * 3.2);
    c.lerp(dust, Math.min(0.55, (facing * 0.5 + splash * 0.45) * grime));

    // Glass.
    //
    // The kit ships the shell and its windows as one mesh, so a pane cannot be
    // deleted. What can be done is darken the band where the glass sits — an
    // opening with nothing in it and no light coming back out of it reads as
    // empty far better than a clean pane does as broken. Side glass is the upper
    // third with a roughly horizontal normal; the roof above it is not.
    if (glass !== 'intact') {
      const sideways = normals ? 1 - Math.abs(normals.getY(i)) : 0;
      const band = up > 0.62 ? Math.min(1, (up - 0.62) / 0.25) : 0;
      const pane = band * sideways;
      c.lerp(new THREE.Color(0x14181a), pane * (glass === 'gone' ? 0.85 : 0.45));
    }

    // Fine variation, so a flat panel is never one flat tone.
    const j = 0.9 + noise3(v.x * 12, v.y * 12, v.z * 12, 17) * 0.2;
    colors[i * 3] = c.r * j;
    colors[i * 3 + 1] = c.g * j;
    colors[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------- surface detail
//
// Triplanar projection, because these shells have no usable UV space.
//
// The kit's atlas is a palette: a saloon body carries 59 distinct UV coordinates
// across 1072 vertices, so every face samples a flat swatch. There is nowhere to
// put a grain, a scratch or a rust edge — a detail map hung on those UVs would
// smear one texel across a whole panel.
//
// So the detail is projected instead. The fragment shader samples a rust texture
// three times, once down each axis, and blends them by the surface normal. UVs
// are never consulted. It costs three extra samples per fragment on a handful of
// objects, and it is the only way to get real surface texture onto geometry that
// was never unwrapped.
//
// What it cannot do is change the silhouette. A body with two thousand triangles
// is still a body with two thousand triangles.

let detailMaps = null;
function detail() {
  if (!detailMaps) {
    // The same rusting-steel generator the salvage props use.
    detailMaps = surface('metalRust', { size: 512, seed: 7 });
    for (const key of ['map', 'roughnessMap']) {
      const t = detailMaps[key];
      if (!t) continue;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
    }
  }
  return detailMaps;
}

/**
 * Adds world-scale triplanar grime to a standard material.
 *
 * @param strength how much of the detail reaches the final colour; heavier on a
 *                 derelict than on something merely parked
 * @param scale    projection scale in metres — the size of the grain on the panel
 */
function addTriplanarDetail(material, { strength, bump, scale = 0.7 }) {
  const maps = detail();
  if (!maps.map) return material;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: maps.map };
    shader.uniforms.uDetailRough = { value: maps.roughnessMap ?? maps.map };
    shader.uniforms.uDetailNrm = { value: maps.normalMap ?? null };
    shader.uniforms.uDetailAmt = { value: strength };
    shader.uniforms.uDetailBump = { value: bump };
    shader.uniforms.uDetailScale = { value: scale };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTriPos = position;
        vTriNrm = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail;
        uniform sampler2D uDetailRough;
        uniform sampler2D uDetailNrm;
        uniform float uDetailAmt;
        uniform float uDetailBump;
        uniform float uDetailScale;
        varying vec3 vTriPos;
        varying vec3 vTriNrm;

        // Blend the three projections by how squarely each axis faces the
        // surface. Raised to a power so the seams stay narrow instead of
        // smearing across the whole panel.
        vec3 triWeights(vec3 n) {
          vec3 w = pow(abs(normalize(n)), vec3(4.0));
          return w / max(w.x + w.y + w.z, 1e-4);
        }
        vec3 triSample(sampler2D tex, vec3 p, vec3 w) {
          vec3 t = p / uDetailScale;
          return texture2D(tex, t.yz).rgb * w.x
               + texture2D(tex, t.xz).rgb * w.y
               + texture2D(tex, t.xy).rgb * w.z;
        }
        // Surface relief, and the whole reason these bodies stop reading as
        // slabs. Each projection contributes its tangent-space wobble in the two
        // axes it spans; there is no tangent basis on this geometry to do it
        // properly, and at this scale nobody can tell.
        vec3 triBump(vec3 p, vec3 w, vec3 n) {
          vec3 t = p / uDetailScale;
          vec3 nx = texture2D(uDetailNrm, t.yz).rgb * 2.0 - 1.0;
          vec3 ny = texture2D(uDetailNrm, t.xz).rgb * 2.0 - 1.0;
          vec3 nz = texture2D(uDetailNrm, t.xy).rgb * 2.0 - 1.0;
          vec3 off = vec3(0.0, nx.x, nx.y) * w.x
                   + vec3(ny.x, 0.0, ny.y) * w.y
                   + vec3(nz.x, nz.y, 0.0) * w.z;
          return normalize(n + off * uDetailBump);
        }`)
      // Weights are recomputed in each block rather than shared: the chunks are
      // injected at points whose order three is free to change between releases,
      // and a variable declared in the wrong one is a compile error.
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 w = triWeights(vTriNrm);
          vec3 grime = triSample(uDetail, vTriPos, w);
          // Overlay, not multiply: multiplying only darkens, and worn metal has
          // bright scratches in it as well as dark pitting.
          vec3 overlaid = mix(
            2.0 * diffuseColor.rgb * grime,
            1.0 - 2.0 * (1.0 - diffuseColor.rgb) * (1.0 - grime),
            step(0.5, diffuseColor.rgb));
          diffuseColor.rgb = mix(diffuseColor.rgb, overlaid, uDetailAmt);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec3 w = triWeights(vTriNrm);
          float r = triSample(uDetailRough, vTriPos, w).g;
          roughnessFactor = clamp(mix(roughnessFactor, max(roughnessFactor, r), uDetailAmt), 0.05, 1.0);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uDetailBump > 0.0) {
          normal = triBump(vTriPos, triWeights(vTriNrm), normal);
        }`);
  };
  material.customProgramCacheKey = () =>
    `veh-tri-${strength.toFixed(2)}-${bump.toFixed(2)}-${scale.toFixed(2)}`;
  material.needsUpdate = true;
  return material;
}

// ---------------------------------------------------------------- source kind
//
// Two very different things can arrive here, and they need opposite treatment:
//
//   a palette kit   every face samples a flat swatch from a shared atlas. There
//                   is no albedo to preserve, so the paint is thrown away and
//                   rebuilt from vertex colours — that is what lets one shell be
//                   eight faded colours.
//   a proper model  a real unwrap with basecolor, normal and roughness maps.
//                   Those maps *are* the quality you paid for, so nothing is
//                   replaced: weathering rides on top as a tint and the
//                   triplanar grime layers over it.
//
// Detected rather than configured, so dropping a bought model into
// world/models.js under the same key needs no other change anywhere.

const hasPbrMaps = (m) => !!(m.normalMap || m.roughnessMap || m.metalnessMap || m.aoMap);

/**
 * Whether the geometry carries a real UV layout or a handful of palette points.
 *
 * A swatch atlas snaps thousands of vertices onto a few dozen coordinates; a
 * genuine unwrap gives nearly every vertex its own. Sampled rather than scanned
 * — the ratio is obvious long before the whole buffer has been read.
 */
function hasRealUVs(geo) {
  const uv = geo.attributes?.uv;
  if (!uv || uv.count < 24) return false;
  const step = Math.max(1, Math.floor(uv.count / 300));
  const seen = new Set();
  let sampled = 0;
  for (let i = 0; i < uv.count; i += step) {
    seen.add(`${uv.getX(i).toFixed(3)},${uv.getY(i).toFixed(3)}`);
    sampled++;
  }
  return seen.size > sampled * 0.5;
}

// ---------------------------------------------------------------- panels

/** Dents, and a folded end on anything worse than parked-and-left. */
function beat(geo, rng, { dents, crumple }) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const halfLen = (bb.max.z - bb.min.z) / 2;
  const midZ = (bb.max.z + bb.min.z) / 2;
  const v = new THREE.Vector3();
  const end = rng.chance(0.65) ? 1 : -1;

  const dishes = [];
  const count = Math.round(2 + dents * 4);
  for (let i = 0; i < count; i++) {
    dishes.push({
      z: rng.range(bb.min.z, bb.max.z),
      y: rng.range(bb.min.y, bb.max.y),
      r: rng.range(0.22, 0.55),
      depth: rng.range(0.02, 0.09) * dents,
    });
  }

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    if (crumple > 0) {
      const from = end < 0 ? (midZ - halfLen * 0.4) - v.z : v.z - (midZ + halfLen * 0.4);
      if (from > 0) {
        const t = Math.min(1, from / (halfLen * 0.6)) ** 2;
        v.z -= end * t * halfLen * 0.24 * crumple;
        v.y -= t * 0.05 * crumple;
        // Buckled steel ripples. Without this the fold is a smooth taper and
        // reads as a design choice rather than as damage.
        v.x += Math.sin(v.y * 24 + v.z * 15) * t * 0.03 * crumple;
      }
    }

    for (const d of dishes) {
      const dist = Math.hypot(v.z - d.z, v.y - d.y);
      if (dist > d.r) continue;
      const fall = (1 - dist / d.r) ** 2;
      v.x -= Math.sign(v.x || 1) * fall * d.depth;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

// ---------------------------------------------------------------- extras

// Wheels are found by name, not by a fixed list, because every kit names them
// differently: one ships four nodes called `wheel-front-left` and the like,
// another ships three — two singles and a fused rear axle called `BackWheels`.
// Matching on the word itself means a new model works without a code change.
const isWheel = (name) => /wheel/i.test(name ?? '');
// A fused axle is never taken off: removing it drops both rear corners at once,
// which reads as a car balanced on nothing rather than as one missing a wheel.
const isAxle = (name) => /wheels/i.test(name ?? '');

/** A bonnet left standing open — the clearest single read of "it stopped here". */
function propBonnet(root, bounds, rng, mats) {
  const w = (bounds.max.x - bounds.min.x) * 0.78;
  const d = (bounds.max.z - bounds.min.z) * 0.2;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mats.panel);
  lid.position.set(0, bounds.max.y * 0.72, bounds.max.z * 0.62);
  lid.rotation.x = -rng.range(0.75, 1.15);
  lid.castShadow = true;
  root.add(lid);
}

/** Boards lashed over an opening: somebody tried to keep the weather out. */
function makeshiftRepair(root, bounds, rng, mats) {
  const side = rng.chance(0.5) ? 1 : -1;
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, rng.range(0.16, 0.24), rng.range(0.9, 1.4)), mats.timber);
  plank.position.set(bounds.max.x * side * 0.96, bounds.max.y * 0.66, rng.range(-0.4, 0.4));
  plank.rotation.x = rng.range(-0.25, 0.25);
  plank.castShadow = true;
  root.add(plank);
}

let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    panel: new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 0.95, metalness: 0.15 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x6d5a41, roughness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x2b2b2d, roughness: 1 }),
  };
  return shared;
}

// ---------------------------------------------------------------- assembly

/**
 * Builds one vehicle from a resolved variant.
 *
 * @param source  the clean kit model; cloned, never modified
 * @param variant from data/vehicles.js — resolveVariant()
 */
export function makeVehicle(source, variant, rng) {
  if (!source || !variant) return new THREE.Group();
  const root = source.clone(true);
  const cond = variant.condition;
  const mats = materials();

  // Find the wheels this particular model actually has, then decide their fate.
  const wheelNames = [];
  root.traverse((o) => { if (o.isMesh && isWheel(o.name)) wheelNames.push(o.name); });
  const removable = wheelNames.filter((n) => !isAxle(n)).sort(() => rng() - 0.5);
  const shuffled = [...wheelNames].sort(() => rng() - 0.5);

  const pick = ([lo, hi]) => lo + ((rng() * (hi - lo + 1)) | 0);
  const goneCount = Math.min(pick(cond.missingWheels), Math.max(0, removable.length - 1));
  const gone = new Set(removable.slice(0, goneCount));
  const flat = new Set(shuffled.filter((n) => !gone.has(n)).slice(0, pick(cond.flatTyres)));

  // Whether this model is an authored asset or a palette kit is decided once for
  // the whole vehicle, weighted by vertex count. Deciding per mesh meant a
  // forty-vertex trim piece counted as "authored" and got a different treatment
  // from the two-thousand-vertex body beside it — one car, two finishes.
  let authoredVerts = 0;
  let totalVerts = 0;
  root.traverse((o) => {
    if (!o.isMesh || isWheel(o.name)) return;
    const n = o.geometry.attributes.position.count;
    totalVerts += n;
    if (hasPbrMaps(o.material) || hasRealUVs(o.geometry)) authoredVerts += n;
  });
  const authored = totalVerts > 0 && authoredVerts > totalVerts * 0.5;

  const bounds = new THREE.Box3();
  const dead = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name ?? '';

    if (isWheel(name)) {
      if (gone.has(name)) { dead.push(o); return; }
      if (flat.has(name)) { o.scale.y *= 0.7; o.position.y -= 0.08; }
      o.rotation.z += rng.range(-0.06, 0.06);
      o.material = o.material.clone();
      o.material.color = new THREE.Color(0x3c3a38);   // perished rubber, no shine
      o.material.roughness = 1;
      o.material.metalness = 0;
      return;
    }

    // The shell.
    o.geometry = o.geometry.clone();
    beat(o.geometry, rng, cond);

    weather(o.geometry, rng, {
      paint: variant.paint, rust: cond.rust, grime: cond.grime, glass: cond.glass,
      tintOnly: authored,
    });

    o.material = o.material.clone();
    if (!authored) {
      // Palette kit: the atlas carries no detail worth keeping, so it is
      // flattened to greyscale and the colour comes from the vertex tint.
      const neutral = neutralAtlas(o.material.map);
      if (neutral) o.material.map = neutral;
      o.material.roughness = 0.92;    // years of oxidation; no gloss left
      o.material.metalness = 0.12;
    } else {
      // Authored model: its maps stay exactly as they are. Only the gloss comes
      // down, because nothing outdoors for a decade is still polished.
      o.material.roughness = Math.max(o.material.roughness ?? 0.5, 0.7);
    }
    o.material.vertexColors = true;
    // Grime over both, but heavier on the kit shells — they have nothing else.
    // A model with no normal map of its own has no surface relief at all, which
    // is what makes a dense mesh still read as a slab. The projected bump is the
    // single biggest thing available here, so the palette kits get most of it
    // and an authored model — which brought its own — gets a light dusting.
    addTriplanarDetail(o.material, {
      strength: (authored ? 0.25 : 0.6) * (0.55 + cond.grime * 0.45),
      bump: authored ? 0.35 : 1.15,
      scale: authored ? 0.9 : 0.55,
    });
    bounds.expandByObject(o);
  });
  for (const o of dead) o.removeFromParent();

  if (cond.bonnet && rng.chance(0.55)) propBonnet(root, bounds, rng, mats);
  if (rng.chance(cond.repairs)) makeshiftRepair(root, bounds, rng, mats);

  // How it came to rest. A vehicle that is merely parked sits almost level; one
  // that has lost a wheel does not.
  const settle = gone.size > 0 ? 0.07 : flat.size > 1 ? 0.035 : 0.015;
  root.rotation.x += rng.range(-settle, settle);
  root.rotation.z += rng.range(-settle, settle);
  root.position.y -= rng.range(0.02, 0.07);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.vehicle = {
    variant: variant.id, body: variant.body.id, condition: cond.id, loot: variant.loot,
  };
  return root;
}

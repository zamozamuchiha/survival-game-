import * as THREE from 'three';

// Short grass built from real blades.
//
// Not billboards and not alpha-cut quads: every blade is a tapered strip with a
// raised centre line, so it has a curved cross-section, catches light along one
// side and shades along the other, and reads as a blade from any angle. Close up
// you can count them; at walking distance they merge into a sward.
//
// Three constraints shape the implementation:
//   - a map is thousands of square metres, so the field is a fixed budget of
//     clusters that follows the player and wraps around them
//   - bending every blade on the CPU would mean rewriting the instance buffer
//     each frame, so the bend lives in the vertex shader
//   - blades must not spring back the instant the player passes, so the shader
//     gets a second, lagging player position and eases between the two

// The field spans the whole view, not just the player's feet: at full zoom-out
// the camera sees roughly 25m of ground in front and 20m behind, so anything
// smaller than this leaves a visible ring of bare texture around the player.
// Density per square metre drops as the patch grows — that trade is deliberate,
// since a blade 20m away is a pixel wide and nobody counts them out there.
const PATCH = 52;            // metres across the live field
const CLUSTERS = 26000;      // cluster instances, split across the variants
const VARIANTS = 3;          // distinct cluster meshes, so the pattern doesn't repeat
const BLADES_PER_CLUSTER = 7;
// Two segments per blade rather than three. At 30cm tall the extra ring buys
// almost no visible curve, and spending those triangles on more blades instead
// is what closes the gaps between them.
const SEGMENTS = 2;
const BLADE_H = [0.24, 0.34];
// Slightly wider than life to hold the cover at the lower per-square-metre count
// the larger patch forces.
const BLADE_W = [0.013, 0.021];
const CLUSTER_R = 0.115;     // how far blades spread from the cluster centre

/**
 * One blade: a strip of `SEGMENTS` quads, three vertices per ring so the middle
 * can be lifted into a curved cross-section.
 *
 * Vertex colours run dark at the base to bright at the tip. That does the work of
 * ambient occlusion between blades — the parts buried in the sward read as being
 * in shadow without needing any occlusion pass.
 */
function pushBlade(target, rng, origin, yaw) {
  const h = rng.range(BLADE_H[0], BLADE_H[1]);
  const w = rng.range(BLADE_W[0], BLADE_W[1]);
  // Lean and curl: the blade tips over gradually rather than kinking.
  const lean = rng.range(0.10, 0.32) * (rng.chance(0.5) ? 1 : -1);
  const curl = rng.range(0.4, 1.0);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Slight hue shift per blade — a lawn is never one colour.
  const shade = rng.range(0.82, 1.06);
  const warm = rng.range(-0.04, 0.06);

  const base = target.position.length / 3;

  for (let s = 0; s <= SEGMENTS; s++) {
    const t = s / SEGMENTS;
    const y = h * t;
    // Quadratic fall-off: straight at the root, bending most near the tip.
    const drift = lean * h * Math.pow(t, 1.6) * curl;
    const halfW = (w * 0.5) * (1 - t * 0.92);      // taper to a point
    const rise = halfW * 0.85;                      // centre lifted = curved section

    // Blade runs along its local X, drifts along local Z.
    const dx = cos;
    const dz = sin;
    const px = origin.x + (-dz) * drift;
    const pz = origin.z + (dx) * drift;

    // left, centre, right across the blade
    const off = [-halfW, 0, halfW];
    for (let k = 0; k < 3; k++) {
      const o = off[k];
      target.position.push(px + dx * o, y + (k === 1 ? rise : 0), pz + dz * o);

      // Normals must be unit length and mostly upward. Grass is lit from the sky:
      // tip them too far sideways and every blade turns into a black needle.
      // Only a slight outward tilt. A blade seen edge-on is a couple of pixels
      // wide, so any real side-facing normal turns half the field into dark
      // spikes; keeping them near vertical lets the whole sward light evenly and
      // leaves just enough variation to give the blades body.
      const side = k === 1 ? 0 : Math.sign(o) * 0.22;
      const nx = -dz * side;
      const nz = dx * side;
      const len = Math.hypot(nx, 1, nz) || 1;
      target.normal.push(nx / len, 1 / len, nz / len);

      // Darker at the root, brighter at the tip — cheap ambient occlusion for the
      // parts buried in the sward. Centred near 1 so the material colour carries.
      const bright = (0.78 + t * 0.46) * shade;
      target.color.push(bright * (1 + warm), bright, bright * (1 - warm * 0.7));
    }
  }

  for (let s = 0; s < SEGMENTS; s++) {
    const a = base + s * 3;
    const b = a + 3;
    // two quads per segment: left half and right half of the curved strip
    target.index.push(a, b, a + 1, a + 1, b, b + 1);
    target.index.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
}

/** A clump of blades sharing one instance. */
function clusterGeometry(rng) {
  const target = { position: [], normal: [], color: [], index: [] };
  for (let i = 0; i < BLADES_PER_CLUSTER; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng()) * CLUSTER_R;
    pushBlade(target, rng,
      { x: Math.cos(a) * d, z: Math.sin(a) * d },
      rng.range(0, Math.PI * 2));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(target.position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(target.normal, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(target.color, 3));
  geo.setIndex(target.index);
  geo.computeBoundingSphere();
  return geo;
}

export class GrassField {
  constructor(scene, rng, radius, opts = {}) {
    this.radius = radius;
    this.centre = new THREE.Vector2(0, 0);
    this.time = 0;
    // Optional predicate: "is this spot built on?". Grass grows everywhere the
    // map allows and only gives way to actual construction, rather than being
    // kept off a whole region in advance.
    this.blocked = opts.blocked ?? null;
    this.lag = new THREE.Vector3();

    this.uniforms = {
      uTime: { value: 0 },
      uPlayer: { value: new THREE.Vector3() },
      uPlayerLag: { value: new THREE.Vector3() },
      uPushRadius: { value: 1.0 },
      uBladeH: { value: BLADE_H[1] },
    };

    const material = new THREE.MeshStandardMaterial({
      color: opts.color ?? 0x6e8446,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => this.patchShader(shader);
    material.customProgramCacheKey = () => 'grass-blades';
    this.material = material;

    const per = Math.ceil(CLUSTERS / VARIANTS);
    const side = Math.ceil(Math.sqrt(CLUSTERS));
    this.step = PATCH / side;

    this.layers = [];
    let placed = 0;
    for (let v = 0; v < VARIANTS; v++) {
      const mesh = new THREE.InstancedMesh(clusterGeometry(rng), material, per);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;      // short grass casting shadows is just noise
      // Nor does it receive them. A blade is about a centimetre across and the
      // sun's shadow map uses a 2.2cm normal bias, so the depth lookup lands off
      // the blade entirely and every one of them comes back shadowed — a field of
      // black needles. The ground underneath still takes shadows normally.
      mesh.receiveShadow = false;
      this.layers.push({ mesh, heights: new Float32Array(per), count: 0 });
      scene.add(mesh);
      placed += per;
    }

    this.scatter(rng, side);
  }

  /**
   * Injects the bend.
   *
   * Strength scales with height up the blade, so roots stay planted and only the
   * upper parts move. The lagging player position is what makes grass settle
   * behind you instead of snapping upright the moment you step off it.
   */
  patchShader(shader) {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        uniform float uTime;
        uniform vec3 uPlayer;
        uniform vec3 uPlayerLag;
        uniform float uPushRadius;
        uniform float uBladeH;

        vec2 pushFrom(vec3 who, vec3 base, float scale) {
          vec2 away = base.xz - who.xz;
          float dist = length(away);
          float fall = 1.0 - smoothstep(0.0, uPushRadius, dist);
          if (fall <= 0.0) return vec2(0.0);
          return (dist > 0.0001 ? away / dist : vec2(1.0, 0.0)) * fall * scale;
        }
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        {
          vec3 worldBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float bend = clamp(position.y / uBladeH, 0.0, 1.0);

          float phase = worldBase.x * 0.9 + worldBase.z * 0.7;
          vec2 wind = vec2(
            sin(uTime * 1.4 + phase) * 0.022,
            cos(uTime * 1.15 + phase * 1.3) * 0.016);

          // Current position parts the grass; the trailing one holds it down for
          // a moment afterwards, so it recovers rather than snapping back.
          vec2 push = pushFrom(uPlayer, worldBase, 0.40)
                    + pushFrom(uPlayerLag, worldBase, 0.22);

          vec2 offset = (wind + push) * bend;
          transformed.xz += offset;
          transformed.y -= length(offset) * bend * 0.30;
        }
      `);
  }

  /** Jittered grid across the patch, dealt round-robin into the variant layers. */
  scatter(rng, side) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();

    let n = 0;
    for (let gx = 0; gx < side && n < CLUSTERS; gx++) {
      for (let gz = 0; gz < side && n < CLUSTERS; gz++) {
        const layer = this.layers[n % VARIANTS];
        if (layer.count >= layer.mesh.count) { n++; continue; }

        const x = -PATCH / 2 + (gx + 0.5) * this.step + rng.range(-this.step * 0.5, this.step * 0.5);
        const z = -PATCH / 2 + (gz + 0.5) * this.step + rng.range(-this.step * 0.5, this.step * 0.5);
        // Uniform shortness: the clump scale barely varies, so nothing sticks up.
        const s = rng.range(0.85, 1.12);

        pos.set(x, 0, z);
        q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
        scale.set(s, s, s);
        m.compose(pos, q, scale);
        layer.mesh.setMatrixAt(layer.count, m);
        layer.heights[layer.count] = s;
        layer.count++;
        n++;
      }
    }
    for (const l of this.layers) {
      l.mesh.count = l.count;
      l.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Wraps clusters around the player so the same budget covers wherever you are.
   * Pass `force` to re-evaluate every cluster without the player having moved —
   * needed after something is built or removed.
   */
  follow(player, force = false) {
    const half = PATCH / 2;
    const dx = player.x - this.centre.x;
    const dz = player.z - this.centre.y;

    if (!force) {
      if (Math.abs(dx) < this.step && Math.abs(dz) < this.step) return;
      const shiftX = Math.round(dx / this.step) * this.step;
      const shiftZ = Math.round(dz / this.step) * this.step;
      if (shiftX === 0 && shiftZ === 0) return;
      this.centre.x += shiftX;
      this.centre.y += shiftZ;
    }

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();

    for (const layer of this.layers) {
      for (let i = 0; i < layer.count; i++) {
        layer.mesh.getMatrixAt(i, m);
        m.decompose(p, q, s);
        p.x = this.centre.x + wrap(p.x - this.centre.x, half);
        p.z = this.centre.y + wrap(p.z - this.centre.y, half);
        const outside = Math.hypot(p.x, p.z) > this.radius
          || (this.blocked !== null && this.blocked(p.x, p.z));
        // Shrink out towards the patch edge instead of ending on a hard circle.
        const edge = Math.max(Math.abs(p.x - this.centre.x), Math.abs(p.z - this.centre.y));
        const fade = THREE.MathUtils.clamp((half - edge) / 6, 0, 1);
        const k = outside ? 0 : layer.heights[i] * fade;
        s.set(k, k, k);
        m.compose(p, q, s);
        layer.mesh.setMatrixAt(i, m);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Re-evaluates every cluster in place — call after building or demolishing. */
  refresh(playerPos) {
    this.follow(playerPos, true);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uPlayer.value.copy(playerPos);
    // Exponential trail: catches up in about a third of a second.
    this.lag.lerp(playerPos, 1 - Math.exp(-dt * 3.2));
    this.uniforms.uPlayerLag.value.copy(this.lag);
    this.follow(playerPos);
  }

  dispose() {
    for (const l of this.layers) {
      l.mesh.geometry.dispose();
      l.mesh.removeFromParent();
    }
    this.material.dispose();
  }
}

/** Wraps v into [-half, half). */
function wrap(v, half) {
  const span = half * 2;
  return ((((v + half) % span) + span) % span) - half;
}

import * as THREE from 'three';
import { getModel, getAnimations, fitHeight, facingOffset } from '../world/models.js';

// Character creation. Renders a live, animated preview of the chosen body into
// the main canvas (no second WebGL context) while the options sit on the right.

const BODIES = [
  { id: 'female', label: 'FEMALE', model: 'char_player_female' },
  { id: 'male',   label: 'MALE',   model: 'char_player_male' },
];

const TINTS = [
  { hex: 0x4a6b7a, name: 'Slate' },
  { hex: 0x5c6b45, name: 'Olive' },
  { hex: 0x7a4a3f, name: 'Rust' },
  { hex: 0x4a4a55, name: 'Ash' },
  { hex: 0x6d5a3a, name: 'Sand' },
  { hex: 0x3f5c4a, name: 'Forest' },
];

const NAMES = ['Ash', 'Wren', 'Kade', 'Mira', 'Rook', 'Sable', 'Vale', 'Juno', 'Rhys', 'Nova'];

/**
 * Opens the creator and resolves with { body, name, tint }.
 * Drives its own render loop against the shared renderer, then hands it back.
 */
export function openCreator(renderer, hostCamera) {
  return new Promise((resolve) => {
    const el = document.getElementById('creator');
    el.classList.add('on');

    const choice = {
      body: 'female',
      tint: TINTS[0].hex,
      name: NAMES[Math.floor(Math.random() * NAMES.length)],
    };

    // ---- preview scene ------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x161d21);
    scene.add(new THREE.HemisphereLight(0xa8c4e0, 0x2a2f2a, 1.6));

    const key = new THREE.DirectionalLight(0xffeccc, 2.6);
    key.position.set(3, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb4d8, 1.5);
    rim.position.set(-4, 3, -5);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x232b30, roughness: 1 }));
    scene.add(floor);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    const pivot = new THREE.Group();
    scene.add(pivot);

    let mixer = null;
    let current = null;

    function showBody(bodyId) {
      if (current) { pivot.remove(current); current = null; }
      mixer = null;

      const def = BODIES.find((b) => b.id === bodyId);
      const model = getModel(def.model);
      if (!model) return;

      fitHeight(model, 1.75);
      model.rotation.y = facingOffset(def.model);
      applyTint(model, choice.tint);
      pivot.add(model);
      current = model;

      const clips = getAnimations(def.model);
      const idle = clips.find((c) => /^idle$/i.test(c.name)) ?? clips[0];
      if (idle) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idle).play();
      }
    }

    function applyTint(model, hex) {
      const c = new THREE.Color(hex);
      model.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const arr = Array.isArray(o.material);
        const out = (arr ? o.material : [o.material]).map((m) => {
          const cl = m.clone();
          if (cl.color) cl.color.lerp(c, 0.3);
          cl.roughness = 1;
          cl.metalness = 0;
          return cl;
        });
        o.material = arr ? out : out[0];
      });
    }

    // ---- options panel -------------------------------------------------
    const bodyRow = document.getElementById('cr-bodies');
    const tintRow = document.getElementById('cr-tints');
    const nameInput = document.getElementById('cr-name');
    const startBtn = document.getElementById('cr-start');

    bodyRow.innerHTML = BODIES.map((b) =>
      `<button class="cr-opt${b.id === choice.body ? ' on' : ''}" data-body="${b.id}">${b.label}</button>`).join('');
    tintRow.innerHTML = TINTS.map((t) =>
      `<button class="cr-swatch${t.hex === choice.tint ? ' on' : ''}" data-tint="${t.hex}"
        style="background:#${t.hex.toString(16).padStart(6, '0')}" title="${t.name}"></button>`).join('');
    nameInput.value = choice.name;

    bodyRow.querySelectorAll('[data-body]').forEach((b) => {
      b.addEventListener('click', () => {
        choice.body = b.dataset.body;
        bodyRow.querySelectorAll('.cr-opt').forEach((x) => x.classList.toggle('on', x === b));
        showBody(choice.body);
      });
    });
    tintRow.querySelectorAll('[data-tint]').forEach((b) => {
      b.addEventListener('click', () => {
        choice.tint = Number(b.dataset.tint);
        tintRow.querySelectorAll('.cr-swatch').forEach((x) => x.classList.toggle('on', x === b));
        showBody(choice.body);
      });
    });
    document.getElementById('cr-reroll').addEventListener('click', () => {
      nameInput.value = NAMES[Math.floor(Math.random() * NAMES.length)];
    });

    showBody(choice.body);

    // ---- preview loop ---------------------------------------------------
    const clock = new THREE.Clock();
    let running = true;

    function layout() {
      // Character occupies the left of the screen; the panel sits on the right.
      const w = innerWidth;
      const h = innerHeight;
      renderer.setSize(w, h);
      const previewW = w > 900 ? w * 0.52 : w;
      camera.aspect = previewW / h;
      camera.updateProjectionMatrix();
      camera.position.set(0, 1.15, 3.1);
      camera.lookAt(0, 0.95, 0);
      return previewW;
    }

    function frame() {
      if (!running) return;
      requestAnimationFrame(frame);
      const dt = clock.getDelta();
      pivot.rotation.y += dt * 0.5;
      mixer?.update(dt);

      const previewW = layout();
      renderer.setViewport(0, 0, previewW, innerHeight);
      renderer.setScissor(0, 0, previewW, innerHeight);
      renderer.setScissorTest(true);
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
    }
    frame();

    startBtn.addEventListener('click', () => {
      running = false;
      choice.name = (nameInput.value || 'Survivor').slice(0, 18);
      el.classList.remove('on');

      // Hand the renderer back exactly as we found it.
      renderer.setViewport(0, 0, innerWidth, innerHeight);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m?.dispose?.();
      });
      resolve(choice);
    }, { once: true });
  });
}

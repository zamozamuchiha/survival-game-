# Asset credits

All third-party assets in this project are CC0 / public domain. Attribution is
not legally required, but it is recorded here anyway.

## Kenney — https://kenney.nl (CC0)
- **Nature Kit** — 329 models: trees, rocks, bushes, grass, flowers, and
  `ground_grass` — the 1x1 tile the whole terrain plane is built from
- **Survival Kit** — 80 models: crates, barrels, chests, campfire, workbench, structures, tools
- **Car Kit** — 50 models: the debris parts (tyres, doors, bumpers, plates,
  cones) scattered around the wrecks. The cars themselves were replaced — see
  Quaternius below.
- **Blocky Characters** — downloaded, no longer used (replaced by skinned humanoids)

## Quaternius — https://quaternius.com (CC0)
- **Zombie Apocalypse Kit** — the three vehicle bodies (`q_Sports`, `q_Pickup`,
  `q_Truck`). Roughly 6,000 triangles each against the 2,000 of the kit they
  replaced, with a real body texture rather than a palette atlas. The armoured
  variants in the same pack are deliberately unused: spiked plating is a louder
  post-apocalypse than this game wants.
  Licence text shipped alongside at `assets/models/cars/QUATERNIUS_LICENSE.txt`.

## three.js examples — https://github.com/mrdoob/three.js
- **Soldier.glb**, **Xbot.glb** — Mixamo-derived skinned humanoids.
  Xbot is the lean player/zombie body; Soldier is the brute and the donor for
  the shared Idle / Walk / Run locomotion clips.

## Authored in-repo
- `src/entities/anim.js` — the swing, shamble and death clips are generated at
  runtime against the Mixamo skeleton, not shipped as files.

## Layout
```
assets/models/nature/     Kenney Nature Kit
assets/models/survival/   Kenney Survival Kit
assets/models/cars/       Kenney Car Kit
assets/models/people/     skinned humanoids
assets/raw/               unpacked source archives (not served)
assets/_zips/             downloaded archives + fetch.sh
```
`assets/raw/` and `assets/_zips/` are working directories — only
`assets/models/` is needed at runtime.

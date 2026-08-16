# Last Light — Prototype

A top-down survival prototype: gather, craft, build a camp, run raids on hostile
zones and get back before the timer runs out. Runs in the browser, no build step
and no dependencies to install.

## Running it

```bash
python3 serve.py 8123 .
```

Then open <http://localhost:8123>. Any static file server works — `serve.py` is
just a small one with the right MIME types and no caching, so edits show up on
reload.

There is nothing to compile: the game is ES modules loaded directly by the
browser, with three.js vendored under `vendor/`.

## Layout

```text
src/core/       state, input, inventory, saving, audio
src/data/       tuning tables — items, recipes, locations, loot, harvesting
src/entities/   player, zombies, character rig, animation clips
src/world/      terrain, grass, base building, models, procedural generators
src/ui/         HUD, panels, character creator
assets/models/  Kenney CC0 packs and the character meshes
vendor/         three.js and loaders
```

## How the visuals are made

Most of the world is generated in code rather than loaded from files. Trees,
rocks, bushes, grass, ground litter and the timber pieces you build all come out
of `src/world/procgen/`, using procedural PBR textures from
`src/world/textures.js`.

The model registry in `src/world/models.js` serves a key from either source:
`MODELS` for a file on disk, `GENERATED` for something grown at boot. Generators
run last and win, so replacing a generated asset with a bought or authored model
means deleting one `GENERATED` entry and pointing the same key at a file.

## Assets

Third-party assets are CC0 — see `assets/CREDITS.md`.

The downloaded archives (`assets/_zips/`) and their unpacked contents
(`assets/raw/`) are not in the repository; only `assets/models/` is needed to
run. To get the raw packs back:

```bash
./assets/_zips/fetch.sh
```

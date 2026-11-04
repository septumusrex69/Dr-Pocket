# Dr Pocket

The whole human body in 3D, in the browser. Turn it, show or hide body systems, make layers
see-through, tap any part to name it, and search for parts or whole organs (liver, heart, brain…).

The Shoulder walkthrough lives at `/shoulder/` (moved here from the Shoulder Lab artifact).

## Run it

```bash
npm install
npm run dev
```

`npm run build` makes the site in `dist/`. Vercel builds it the same way.

## Where the anatomy comes from

The body is [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/), © The Database
Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan. The shoulder
walkthrough uses [Z-Anatomy](https://github.com/Z-Anatomy/The-blend) (CC BY-SA 4.0), which is
built on BodyParts3D. Shapes are simplified for the web.

The ready-made model files are in `public/models/` (one file per body system, about 9 MB in
total). To rebuild them from the original download:

1. From the BodyParts3D download page, get `isa_BP3D_4.0_obj_99.zip`, `isa_element_parts.txt`,
   `isa_inclusion_relation_list.txt` and `partof_element_parts.txt` into one folder, and unzip
   the zip into `raw/` inside it.
2. Install the tools: `pip install trimesh fast-simplification numpy` and `npm install`.
3. Run, with that folder as `SRC` and any scratch folder as `WORK`:

```bash
python3 tools/classify.py "$SRC" "$WORK/parts.json"
python3 tools/build_models.py "$SRC" "$WORK/parts.json" "$WORK/glb"
tools/pack_models.sh "$WORK/glb"
python3 tools/build_groups.py "$SRC" public/models/index.json public/models/groups.json
```

- `classify.py` names every part and sorts it into a body system.
- `build_models.py` simplifies each system to its triangle budget and writes one model per system.
- `pack_models.sh` compresses those models into `public/models/`.
- `build_groups.py` lists whole organs and regions made of several parts, for search.

This is for learning only and does not replace advice from a doctor.

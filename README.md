# Dr Pocket

The whole human body in 3D, in the browser. Turn it, show or hide body systems, make layers
see-through, tap any part to name it, and search for parts or whole organs (liver, heart, brain…).

The Shoulder walkthrough lives at `/shoulder/` (moved here from the Shoulder Lab artifact).
`/shoulder/?case=cuff` opens it on a case (`healthy`, `bankart`, `slap`, `cuff`, `oa`, `tight`).

## Explain my scan report

Paste a radiology report (or upload a photo or PDF of it) and get a plain-language explanation,
with each finding lit up on the 3D body, a glossary and questions for the doctor.

- `api/explain.js` is a Vercel function that sends the report to Claude and returns structured JSON.
  It needs the `ANTHROPIC_API_KEY` environment variable in the Vercel project settings.
- Reports are not stored or logged. Each visitor gets a few explanations per hour; the real cost cap
  is the monthly spend limit set in the Anthropic Console.
- **Narrated walkthrough** (`src/film.js`): an intro, one scene per finding and a closing scene with
  the questions. Each finding scene colours the part by the kind of change, pins a pulsing marker where
  the part meets its neighbour (e.g. where a tendon attaches to bone), flies the camera there and reads
  the explanation aloud with subtitles. The voice is the browser's built-in speech (free).
- Claude may only name structures from `api/_vocab.js` (the parts the 3D model has), so findings
  always map onto the model. `tools/build_vocab.mjs` rebuilds that list and `public/models/vocab.json`
  whenever the model files change.

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
2. Install the tools: `pip install trimesh fast-simplification numpy scipy rtree` and `npm install`.
3. Run, with that folder as `SRC` and any scratch folder as `WORK`:

```bash
python3 tools/classify.py "$SRC" "$WORK/parts.json"
python3 tools/build_models.py "$SRC" "$WORK/parts.json" "$WORK/glb"
python3 tools/build_added.py "$SRC" "$WORK/glb"
tools/pack_models.sh "$WORK/glb"
python3 tools/build_groups.py "$SRC" public/models/index.json public/models/groups.json
node tools/build_vocab.mjs
```

- `classify.py` names every part and sorts it into a body system.
- `build_models.py` simplifies each system to its triangle budget and writes one model per system.
- `build_added.py` draws the structures BodyParts3D lacks (labrum, cruciate and collateral ligaments,
  menisci, joint cartilage, patellar tendon, ankle ligaments, spinal cord, cauda equina, nerve roots C2–S1)
  from the bones around them. They are approximate shapes, marked as drawn in the app.
- `pack_models.sh` compresses those models into `public/models/`.
- `build_groups.py` lists whole organs and regions made of several parts, for search.

This is for learning only and does not replace advice from a doctor.

"""Name every BodyParts3D part file and sort it into a body system.

Usage: python3 tools/classify.py <bodyparts3d download folder> <output parts.json>

The download folder holds the unzipped isa_BP3D_4.0_obj_99 set and isa_element_parts.txt
from https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
"""
import collections
import json
import os
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
OBJ = os.path.join(SRC, 'raw', 'isa_BP3D_4.0_obj_99')

# Every concept that uses each part file. The most specific one (left/right, longest) names the part.
raw = collections.defaultdict(list)
for line in open(os.path.join(SRC, 'isa_element_parts.txt'), encoding='utf-8').read().splitlines()[1:]:
    cid, name, fj = line.split('\t')
    raw[fj].append((cid, name))
has_child = collections.defaultdict(set)  # concept -> its direct children
for line in open(os.path.join(SRC, 'isa_inclusion_relation_list.txt'), encoding='utf-8').read().splitlines()[1:]:
    p, _, c, _ = line.split('\t')
    has_child[p].add(c)
# Keep only the most specific concepts for each file: drop any concept that is a parent of another one listed.
concepts = {}
for fj, pairs in raw.items():
    ids = {c for c, _ in pairs}
    concepts[fj] = [n for c, n in pairs if not (has_child[c] & ids)]


def best_name(fj, header_name):
    names = concepts.get(fj, [])
    sided = [n for n in names if re.match(r'(left|right) ', n, re.I)]
    pool = sided or names
    if header_name and (not pool or re.match(r'(left|right) ', header_name, re.I)):
        return header_name
    return max(pool, key=len) if pool else (header_name or fj)


SYSTEMS = [
    ('skin', 'Skin'),
    ('skeleton', 'Bones'),
    ('cartilage', 'Cartilage and discs'),
    ('joints', 'Ligaments and fascia'),
    ('muscles', 'Muscles'),
    ('heart', 'Heart'),
    ('arteries', 'Arteries'),
    ('veins', 'Veins'),
    ('nerves', 'Brain and nerves'),
    ('senses', 'Eyes and ears'),
    ('lungs', 'Lungs and airways'),
    ('gut', 'Digestive organs'),
    ('urinary', 'Kidneys and bladder'),
    ('genital', 'Reproductive organs'),
    ('glands', 'Glands'),
]

# Checked in order; the first rule whose pattern matches the name wins.
RULES = [
    ('nerves', r'(lateral|third|fourth) ventricle$|ventricle of brain'),
    ('skin', r'\bskin\b|eyebrow|\bhair\b|\bnail\b'),
    ('heart', r'\bheart\b|atrium|ventric(le|ular)(?! of brain)|\bvalve\b|\bcusp\b|leaflet|papillary muscle|chordae|myocardi|pericardi|interatrial|interventricular septum|conus arteriosus|moderator band|crista terminalis|trabecula'),
    ('senses', r'eyeball|external ear|corona ciliaris|cornea|\biris\b|\blens\b|sclera|choroid|retina|vitreous|lacrimal|eyelid|tarsal plate|ciliary|\b(superior|inferior|lateral|medial) rectus\b|\b(superior|inferior) oblique\b|levator palpebrae|\bcochlea|tympan|auricle|external acoustic|semicircular|vestibul(e|ar) of|malleus|incus|stapes|ossicle|nasal cavity|olfactory'),
    ('arteries', r'arter(y|ies|ial)|palmar arch|plantar arch|aorta|arterial arcade|pulmonary trunk|brachiocephalic trunk|celiac trunk|thyrocervical trunk|costocervical trunk|circle of willis'),
    ('veins', r'\bvein|vena cava|venous|\bsinus\b(?! of (kidney|ethmoid|maxill|sphenoid|frontal))|confluence of sinuses|\bplexus\b(?=.*ven)'),
    ('nerves', r'nerve|commissure|habenula|interpeduncular|lamina terminalis|septum of telencephalon|tuber cinereum|geniculate body|stria terminalis|brain|cerebr|cerebell|medulla oblongata|\bpons\b|spinal cord|gyrus|sulcus|thalam|hippocamp|amygdal|caudate nucleus|putamen|globus pallidus|nucleus|colliculus|corpus callosum|fornix|internal capsule|external capsule|claustrum|ventricle of brain|lateral ventricle|third ventricle|fourth ventricle|cerebral aqueduct|central canal|cauda equina|ganglion|chiasm|optic tract|mammillary|pineal|insula|lobule|cuneus|precuneus|uncus|vermis|peduncle|tegmentum|substantia nigra|red nucleus|tectum|meninges|dura mater|pia mater|arachnoid|choroid plexus|septum pellucidum|operculum|hypothalamus|subthalamus|epithalamus|cingul'),
    ('lungs', r'lung|conus elasticus|bronch|trachea|larynx|laryngeal|epiglott|thyroid cartilage|cricoid|arytenoid|corniculate|cuneiform cartilage|vocal|glottis|pleura|\bnasal concha\b(?=x)|lobe of (left|right) lung|segment of (left|right) lung|alveol(?!ar (process|bone))'),
    ('urinary', r'kidney|renal|ureter|urinary bladder|urethra|bladder'),
    ('genital', r'deferent duct|testis|testicle|epididym|ductus deferens|seminal|prostat|penis|scrot|ovary|uter|vagin|vulva|clitor|labium|fallopian|mammary|breast|spermatic'),
    ('glands', r'thyroid gland|parathyroid|adrenal|suprarenal gland|pituitary|hypophysis|thymus|lobe of thymus|spleen|lymph'),
    ('gut', r'cystic duct|ileocecal|taenia|\blip\b|esophag|oesophag|stomach|duoden|jejun|ileum|ileal|cecum|caecum|appendix|colon|sigmoid|rectum|anal canal|anus|liver|hepat|hepatovenous|gallbladder|gall bladder|bile|biliary|pancrea|pharyn|tongue|tooth|teeth|incisor|canine|premolar|molar|gingiva|palat|uvula|tonsil|salivary|parotid|submandibular gland|sublingual gland|mesocolon|mesentery|omentum|peritone|portal|lingual|oral'),
    ('cartilage', r'cartilage|intervertebral dis[ck]|meniscus|articular disc|labrum|pubic symphysis|nucleus pulposus|annulus fibrosus'),
    ('joints', r'ligament|linea alba|tendinous ring|raphe|symphysis|retinaculum|tract\b|aponeurosis|fascia|tendon(?! of)|capsule|bursa|membrane|syndesmosis|sheath'),
    ('muscles', r'muscle|rotator\b|coccygeus|puborectalis|cricothyroid|\b(biceps|triceps|deltoid|trapezius|pectoralis|latissimus|rhomboid|serratus|levator|depressor|sphincter|diaphragm|platysma|masseter|temporalis|buccinator|orbicularis|zygomaticus|risorius|mentalis|procerus|nasalis|occipitofrontalis|frontalis|occipitalis|sternocleidomastoid|scalen|longus|longissimus|iliocostalis|spinalis|semispinalis|multifid|rotatores|interspinal|intertransvers|splenius|obliquus|oblique|rectus|transversus|quadratus|psoas|iliacus|iliopsoas|gluteus|piriformis|gemellus|obturator|tensor|sartorius|gracilis|adductor|abductor|pectineus|vastus|femoris|semitendinosus|semimembranosus|gastrocnemius|soleus|plantaris|popliteus|tibialis|peroneus|fibularis|extensor|flexor|lumbrical|interosse|opponens|palmaris|pronator|supinator|brachialis|brachioradialis|coracobrachialis|anconeus|supraspinatus|infraspinatus|subscapularis|teres|subclavius|intercostal|subcostal|levatores|cremaster|mylohyoid|geniohyoid|digastric|stylohyoid|sternohyoid|omohyoid|thyrohyoid|sternothyroid|pterygoid|genioglossus|hyoglossus|styloglossus|palatoglossus|constrictor|stapedius|corrugator|auricular|dorsi|hallucis|pollicis|digiti|minimi|indicis|carpi|radialis|ulnaris|tibialis|perone)'),
    ('skeleton', r'bone|vertebra|\brib\b|sternum|manubrium|xiphoid|sacrum|coccyx|skull|cranium|mandible|maxilla|clavicle|scapula|humerus|radius|ulna|carpal|metacarpal|phalanx|femur|patella|tibia|fibula|tarsal|metatarsal|calcaneus|talus|navicular|cuboid|cuneiform|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid|capitate|hamate|hip bone|ilium|ischium|pubis|atlas|axis|hyoid|concha|vomer|ethmoid|sphenoid|occipital|parietal|temporal bone|frontal bone|zygomatic|lacrimal bone|palatine bone|nasal bone|sesamoid|acromion|coracoid|olecranon|epicondyle|condyle|trochanter|tuberosity|malleolus'),
]
RULES = [(k, re.compile(p, re.I)) for k, p in RULES]


def classify(name):
    for key, rx in RULES:
        if rx.search(name):
            return key
    return 'other'


parts, counts, unsorted = [], collections.Counter(), []
for f in sorted(x for x in os.listdir(OBJ) if x.endswith('.obj')):
    fj = f[:-4]
    with open(os.path.join(OBJ, f), encoding='utf-8', errors='replace') as fh:
        head = ''.join(next(fh, '') for _ in range(20))
    m = re.search(r'English name : (\S.*)', head)
    name = best_name(fj, m.group(1).strip() if m else '')
    name = name[0].upper() + name[1:]
    key = classify(name)
    counts[key] += 1
    if key == 'other':
        unsorted.append(name)
    parts.append({'file': fj, 'name': name, 'sys': key})

systems = [{'key': k, 'label': l} for k, l in SYSTEMS] + [{'key': 'other', 'label': 'Other'}]
json.dump({'systems': systems, 'parts': parts}, open(OUT, 'w'), indent=0)
print(dict(counts))
print('unsorted:', sorted(set(unsorted)))

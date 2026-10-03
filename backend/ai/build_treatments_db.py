"""
KisanShakti — Disease Treatments Database Builder
===================================================
Creates and populates the SQLite treatments database used by the Upaj app.
All 38 PlantVillage classes are covered. Indian crops (Tomato, Potato, Corn)
include Kannada names and locally available product names.

Usage:
    python build_treatments_db.py
"""

import pathlib
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = pathlib.Path(__file__).parent.resolve()
REPO_ROOT  = SCRIPT_DIR.parent.parent
DB_PATH    = REPO_ROOT / "apps" / "upaj" / "assets" / "disease_treatments.db"

CREATE_SQL = """
DROP TABLE IF EXISTS diseases;
CREATE TABLE diseases (
    id                  INTEGER PRIMARY KEY,
    class_id            INTEGER NOT NULL UNIQUE,
    class_label         TEXT    NOT NULL,
    name                TEXT    NOT NULL,
    scientific_name     TEXT,
    severity            TEXT    NOT NULL,
    affected_crop       TEXT    NOT NULL,
    organic_treatment   TEXT,
    organic_dosage      TEXT,
    chemical_treatment  TEXT,
    chemical_dosage     TEXT,
    store_product       TEXT,
    kannada_name        TEXT,
    kannada_organic     TEXT,
    kannada_chemical    TEXT,
    prevention          TEXT
);
"""


@dataclass
class Disease:
    class_id:           int
    class_label:        str
    name:               str
    scientific_name:    Optional[str]
    severity:           str   # Low | Medium | High | Critical
    affected_crop:      str
    organic_treatment:  Optional[str]  = field(default=None)
    organic_dosage:     Optional[str]  = field(default=None)
    chemical_treatment: Optional[str]  = field(default=None)
    chemical_dosage:    Optional[str]  = field(default=None)
    store_product:      Optional[str]  = field(default=None)
    kannada_name:       Optional[str]  = field(default=None)
    kannada_organic:    Optional[str]  = field(default=None)
    kannada_chemical:   Optional[str]  = field(default=None)
    prevention:         Optional[str]  = field(default=None)


# ── Disease Data (all 38 PlantVillage classes) ────────────────────────────────
DISEASES: list[Disease] = [
    Disease(
        class_id=0, class_label="Apple_scab",
        name="Apple Scab", scientific_name="Venturia inaequalis",
        severity="Medium", affected_crop="Apple",
        organic_treatment="Neem oil spray",
        organic_dosage="5 ml per litre of water, spray every 7 days",
        chemical_treatment="Captan 50% WP",
        chemical_dosage="2 g per litre of water",
        store_product="Captaf (BAYER)",
        prevention="Prune infected branches; rake fallen leaves; ensure good air circulation.",
    ),
    Disease(
        class_id=1, class_label="Apple_black_rot",
        name="Apple Black Rot", scientific_name="Botryosphaeria obtusa",
        severity="High", affected_crop="Apple",
        organic_treatment="Bordeaux mixture (1%)",
        organic_dosage="Apply 10 litres per tree at bud break",
        chemical_treatment="Thiophanate-methyl 70% WP",
        chemical_dosage="1 g per litre of water",
        store_product="Topsin-M (UPL)",
        prevention="Remove mummified fruits and dead wood; disinfect pruning tools.",
    ),
    Disease(
        class_id=2, class_label="Apple_cedar_apple_rust",
        name="Cedar Apple Rust", scientific_name="Gymnosporangium juniperi-virginianae",
        severity="Medium", affected_crop="Apple",
        organic_treatment="Sulfur-based fungicide",
        organic_dosage="Spray at bud break, repeat every 10 days for 4 applications",
        chemical_treatment="Myclobutanil 10% WP",
        chemical_dosage="1 g per litre of water",
        store_product="Rally (Dow AgroSciences)",
        prevention="Remove nearby cedar/juniper trees; plant resistant apple varieties.",
    ),
    Disease(
        class_id=3, class_label="Apple_healthy",
        name="Healthy Apple Plant", scientific_name=None,
        severity="Low", affected_crop="Apple",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        kannada_name="ಆಪಲ್ ಮರ (ಆರೋಗ್ಯಕರ)",
        prevention="Maintain regular watering and balanced fertilisation.",
    ),
    Disease(
        class_id=4, class_label="Blueberry_healthy",
        name="Healthy Blueberry Plant", scientific_name=None,
        severity="Low", affected_crop="Blueberry",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Ensure acidic soil pH (4.5–5.5); mulch to retain moisture.",
    ),
    Disease(
        class_id=5, class_label="Cherry_powdery_mildew",
        name="Cherry Powdery Mildew", scientific_name="Podosphaera clandestina",
        severity="Medium", affected_crop="Cherry",
        organic_treatment="Potassium bicarbonate spray",
        organic_dosage="5 g per litre of water; spray weekly",
        chemical_treatment="Sulfur 80% WG",
        chemical_dosage="2 g per litre of water",
        store_product="Sulphex (Coromandel)",
        prevention="Avoid overhead irrigation; prune to improve air circulation.",
    ),
    Disease(
        class_id=6, class_label="Cherry_healthy",
        name="Healthy Cherry Plant", scientific_name=None,
        severity="Low", affected_crop="Cherry",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Regular pruning after harvest; balanced NPK fertilisation.",
    ),
    Disease(
        class_id=7, class_label="Corn_cercospora_leaf_spot",
        name="Cercospora Leaf Spot / Gray Leaf Spot", scientific_name="Cercospora zeae-maydis",
        severity="High", affected_crop="Corn (Maize)",
        organic_treatment="Trichoderma viride biocontrol",
        organic_dosage="4 g per litre; drench and foliar spray",
        chemical_treatment="Propiconazole 25% EC",
        chemical_dosage="1 ml per litre of water",
        store_product="Tilt (Syngenta)",
        kannada_name="ಜೋಳದ ಸೆರ್ಕೋಸ್ಪೋರಾ ಎಲೆ ಚುಕ್ಕೆ ರೋಗ",
        prevention="Use resistant hybrids; rotate with non-host crops; avoid dense planting.",
    ),
    Disease(
        class_id=8, class_label="Corn_common_rust",
        name="Corn Common Rust", scientific_name="Puccinia sorghi",
        severity="Medium", affected_crop="Corn (Maize)",
        organic_treatment="Neem seed kernel extract (NSKE) 5%",
        organic_dosage="50 ml per litre of water; spray at disease onset",
        chemical_treatment="Mancozeb 75% WP",
        chemical_dosage="2.5 g per litre of water",
        store_product="Dithane M-45 (UPL)",
        kannada_name="ಜೋಳದ ಸಾಮಾನ್ಯ ತುಕ್ಕು ರೋಗ",
        prevention="Plant early; use rust-resistant hybrids; avoid late planting.",
    ),
    Disease(
        class_id=9, class_label="Corn_northern_leaf_blight",
        name="Northern Leaf Blight", scientific_name="Exserohilum turcicum",
        severity="High", affected_crop="Corn (Maize)",
        organic_treatment="Pseudomonas fluorescens spray",
        organic_dosage="10 g per litre of water; spray at early disease sign",
        chemical_treatment="Azoxystrobin 23% SC",
        chemical_dosage="1 ml per litre of water",
        store_product="Amistar (Syngenta)",
        kannada_name="ಜೋಳದ ಉತ್ತರ ಎಲೆ ಬೂದು ರೋಗ",
        prevention="Use certified disease-free seed; practice crop rotation; remove crop debris.",
    ),
    Disease(
        class_id=10, class_label="Corn_healthy",
        name="Healthy Corn Plant", scientific_name=None,
        severity="Low", affected_crop="Corn (Maize)",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        kannada_name="ಆರೋಗ್ಯಕರ ಜೋಳ",
        prevention="Balanced fertilisation; adequate spacing; timely weeding.",
    ),
    Disease(
        class_id=11, class_label="Grape_black_rot",
        name="Grape Black Rot", scientific_name="Guignardia bidwellii",
        severity="High", affected_crop="Grape",
        organic_treatment="Bordeaux mixture (1%)",
        organic_dosage="Spray before bloom and after petal fall",
        chemical_treatment="Captan 50% WP",
        chemical_dosage="2 g per litre of water",
        store_product="Captaf (BAYER)",
        prevention="Remove mummified berries; ensure good canopy air flow.",
    ),
    Disease(
        class_id=12, class_label="Grape_esca",
        name="Grape Esca (Black Measles)", scientific_name="Phaeomoniella chlamydospora",
        severity="Critical", affected_crop="Grape",
        organic_treatment="Potassium silicate foliar spray",
        organic_dosage="5 g per litre; spray monthly during growing season",
        chemical_treatment="Fosetyl-Al 80% WP",
        chemical_dosage="2.5 g per litre of water",
        store_product="Aliette (Bayer)",
        prevention="Protect pruning wounds with fungicidal paste; avoid water stress.",
    ),
    Disease(
        class_id=13, class_label="Grape_leaf_blight",
        name="Grape Leaf Blight", scientific_name="Isariopsis clavispora",
        severity="Medium", affected_crop="Grape",
        organic_treatment="Sulfur dust (3%)",
        organic_dosage="Apply 15 kg per hectare",
        chemical_treatment="Carbendazim 50% WP",
        chemical_dosage="1 g per litre of water",
        store_product="Bavistin (BASF)",
        prevention="Remove infected leaves promptly; maintain open canopy.",
    ),
    Disease(
        class_id=14, class_label="Grape_healthy",
        name="Healthy Grape Vine", scientific_name=None,
        severity="Low", affected_crop="Grape",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Annual pruning; balanced irrigation; proper trellising.",
    ),
    Disease(
        class_id=15, class_label="Orange_haunglongbing",
        name="Citrus Greening (Huanglongbing)", scientific_name="Candidatus Liberibacter asiaticus",
        severity="Critical", affected_crop="Orange (Citrus)",
        organic_treatment="Neem oil + garlic extract spray",
        organic_dosage="5 ml neem oil + 10 g garlic per litre; spray to control psyllid vector",
        chemical_treatment="Imidacloprid 17.8% SL",
        chemical_dosage="0.5 ml per litre; drench to control Asian citrus psyllid",
        store_product="Confidor (BAYER)",
        prevention="Use certified disease-free nursery plants; remove infected trees immediately.",
    ),
    Disease(
        class_id=16, class_label="Peach_bacterial_spot",
        name="Peach Bacterial Spot", scientific_name="Xanthomonas arboricola pv. pruni",
        severity="High", affected_crop="Peach",
        organic_treatment="Copper hydroxide (50%)",
        organic_dosage="2 g per litre; spray at dormancy break",
        chemical_treatment="Oxytetracycline 22% SP",
        chemical_dosage="0.5 g per litre of water",
        store_product="Mycoshield (Nufarm)",
        prevention="Plant resistant varieties; avoid overhead irrigation.",
    ),
    Disease(
        class_id=17, class_label="Peach_healthy",
        name="Healthy Peach Tree", scientific_name=None,
        severity="Low", affected_crop="Peach",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Prune to open canopy; balanced potassium application for resistance.",
    ),
    Disease(
        class_id=18, class_label="Pepper_bacterial_spot",
        name="Pepper Bacterial Spot", scientific_name="Xanthomonas euvesicatoria",
        severity="High", affected_crop="Bell Pepper",
        organic_treatment="Copper oxychloride 50% WP",
        organic_dosage="3 g per litre; spray every 7 days during wet weather",
        chemical_treatment="Streptomycin sulfate 90% + Tetracycline 10%",
        chemical_dosage="0.5 g per litre of water",
        store_product="Agrimycin-100 (Bayer)",
        prevention="Use disease-free seed; avoid overhead watering; practice crop rotation.",
    ),
    Disease(
        class_id=19, class_label="Pepper_healthy",
        name="Healthy Bell Pepper Plant", scientific_name=None,
        severity="Low", affected_crop="Bell Pepper",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Balanced NPK; stake plants to avoid soil contact; regular scouting.",
    ),
    Disease(
        class_id=20, class_label="Potato_early_blight",
        name="Potato Early Blight", scientific_name="Alternaria solani",
        severity="Medium", affected_crop="Potato",
        organic_treatment="Neem oil spray (3%)",
        organic_dosage="30 ml per litre; spray every 10 days from first signs",
        chemical_treatment="Mancozeb 75% WP",
        chemical_dosage="2.5 g per litre of water",
        store_product="Dithane M-45 (UPL)",
        kannada_name="ಆಲೂಗಡ್ಡೆ ಆರಂಭಿಕ ಸುಳಿ ರೋಗ",
        prevention="Avoid overhead irrigation; remove infected leaves; ensure proper spacing.",
    ),
    Disease(
        class_id=21, class_label="Potato_late_blight",
        name="Potato Late Blight", scientific_name="Phytophthora infestans",
        severity="Critical", affected_crop="Potato",
        organic_treatment="Trichoderma viride (biocontrol)",
        organic_dosage="4 g per litre; spray at first sign of disease",
        chemical_treatment="Metalaxyl 8% + Mancozeb 64% WP",
        chemical_dosage="2.5 g per litre of water; repeat every 7 days",
        store_product="Ridomil Gold (Syngenta)",
        kannada_name="ಆಲೂಗಡ್ಡೆ ತಡ ಸುಳಿ ರೋಗ (ಫೈಟೋಫ್ತೋರಾ)",
        prevention="Use certified disease-free seed tubers; destroy crop debris after harvest; avoid waterlogging.",
    ),
    Disease(
        class_id=22, class_label="Potato_healthy",
        name="Healthy Potato Plant", scientific_name=None,
        severity="Low", affected_crop="Potato",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        kannada_name="ಆರೋಗ್ಯಕರ ಆಲೂಗಡ್ಡೆ ಗಿಡ",
        prevention="Use certified seed tubers; earthing up; balanced fertilisation.",
    ),
    Disease(
        class_id=23, class_label="Raspberry_healthy",
        name="Healthy Raspberry Plant", scientific_name=None,
        severity="Low", affected_crop="Raspberry",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Regular pruning of old canes; mulching; well-drained soil.",
    ),
    Disease(
        class_id=24, class_label="Soybean_healthy",
        name="Healthy Soybean Plant", scientific_name=None,
        severity="Low", affected_crop="Soybean",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Use Rhizobium inoculant on seed; balanced K and P fertilisation.",
    ),
    Disease(
        class_id=25, class_label="Squash_powdery_mildew",
        name="Squash Powdery Mildew", scientific_name="Podosphaera xanthii",
        severity="Medium", affected_crop="Squash",
        organic_treatment="Potassium bicarbonate (5 g/L) or baking soda (10 g/L)",
        organic_dosage="Spray every 7 days from first signs",
        chemical_treatment="Triadimefon 25% WP",
        chemical_dosage="1 g per litre of water",
        store_product="Bayleton (Bayer)",
        prevention="Avoid overhead watering; ensure adequate plant spacing.",
    ),
    Disease(
        class_id=26, class_label="Strawberry_leaf_scorch",
        name="Strawberry Leaf Scorch", scientific_name="Diplocarpon earlianum",
        severity="Medium", affected_crop="Strawberry",
        organic_treatment="Copper sulfate (Bordeaux 1%)",
        organic_dosage="Apply 2 sprays 10 days apart at start of symptoms",
        chemical_treatment="Thiram 75% WP",
        chemical_dosage="2 g per litre of water",
        store_product="Thiride (UPL)",
        prevention="Remove infected leaves; plant on raised beds; ensure good drainage.",
    ),
    Disease(
        class_id=27, class_label="Strawberry_healthy",
        name="Healthy Strawberry Plant", scientific_name=None,
        severity="Low", affected_crop="Strawberry",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        prevention="Mulch with straw; drip irrigation; remove runners to improve fruiting.",
    ),
    Disease(
        class_id=28, class_label="Tomato_bacterial_spot",
        name="Tomato Bacterial Spot", scientific_name="Xanthomonas vesicatoria",
        severity="High", affected_crop="Tomato",
        organic_treatment="Copper oxychloride 50% WP",
        organic_dosage="3 g per litre; spray every 7 days",
        chemical_treatment="Streptomycin sulfate + Copper oxychloride",
        chemical_dosage="0.5 g streptomycin + 3 g copper per litre",
        store_product="Agrimycin-100 + Blitox-50 (Bayer)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಬ್ಯಾಕ್ಟೀರಿಯಲ್ ಚುಕ್ಕೆ ರೋಗ",
        prevention="Use disease-free transplants; avoid overhead irrigation; crop rotation.",
    ),
    Disease(
        class_id=29, class_label="Tomato_early_blight",
        name="Tomato Early Blight", scientific_name="Alternaria solani",
        severity="Medium", affected_crop="Tomato",
        organic_treatment="Neem oil spray (5 ml/L)",
        organic_dosage="5 ml neem oil per litre; spray every 10 days",
        chemical_treatment="Mancozeb 75% WP",
        chemical_dosage="2 g per litre of water",
        store_product="Dithane M-45 (UPL)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಆರಂಭಿಕ ಬೂದು ರೋಗ",
        prevention="Stake plants; remove lower infected leaves; avoid wetting foliage.",
    ),
    Disease(
        class_id=30, class_label="Tomato_late_blight",
        name="Tomato Late Blight", scientific_name="Phytophthora infestans",
        severity="Critical", affected_crop="Tomato",
        organic_treatment="Trichoderma viride 1% WP biocontrol",
        organic_dosage="4 g per litre; spray at onset of disease",
        chemical_treatment="Metalaxyl 8% + Mancozeb 64% WP",
        chemical_dosage="2.5 g per litre; spray every 7 days",
        store_product="Ridomil Gold MZ (Syngenta)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ತಡ ಬೂದು ರೋಗ",
        prevention="Destroy infected plants; avoid excessive nitrogen; ensure good drainage.",
    ),
    Disease(
        class_id=31, class_label="Tomato_leaf_mold",
        name="Tomato Leaf Mold", scientific_name="Passalora fulva",
        severity="Medium", affected_crop="Tomato",
        organic_treatment="Neem oil + garlic extract",
        organic_dosage="5 ml neem oil + 2 g garlic extract per litre",
        chemical_treatment="Chlorothalonil 75% WP",
        chemical_dosage="2 g per litre of water",
        store_product="Kavach (Syngenta)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಎಲೆ ಶಿಲೀಂಧ್ರ ರೋಗ",
        prevention="Reduce greenhouse humidity; improve ventilation; avoid leaf wetting.",
    ),
    Disease(
        class_id=32, class_label="Tomato_septoria_leaf_spot",
        name="Tomato Septoria Leaf Spot", scientific_name="Septoria lycopersici",
        severity="Medium", affected_crop="Tomato",
        organic_treatment="Copper-based fungicide (Bordeaux 1%)",
        organic_dosage="Spray every 10 days during wet weather",
        chemical_treatment="Mancozeb 75% WP",
        chemical_dosage="2.5 g per litre of water",
        store_product="Dithane M-45 (UPL)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಸೆಪ್ಟೋರಿಯಾ ಎಲೆ ಚುಕ್ಕೆ",
        prevention="Remove and destroy infected leaves; avoid overhead irrigation; stake plants.",
    ),
    Disease(
        class_id=33, class_label="Tomato_spider_mites",
        name="Tomato Spider Mites (Two-spotted)", scientific_name="Tetranychus urticae",
        severity="High", affected_crop="Tomato",
        organic_treatment="Neem oil spray + water jet",
        organic_dosage="5 ml neem oil per litre; forceful water spray to dislodge mites",
        chemical_treatment="Abamectin 1.8% EC",
        chemical_dosage="0.5 ml per litre of water",
        store_product="Vertimec (Syngenta)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಜೇಡ ಹುಳ ರೋಗ",
        prevention="Maintain soil moisture; avoid dusty conditions; release predatory mites.",
    ),
    Disease(
        class_id=34, class_label="Tomato_target_spot",
        name="Tomato Target Spot", scientific_name="Corynespora cassiicola",
        severity="Medium", affected_crop="Tomato",
        organic_treatment="Trichoderma viride",
        organic_dosage="4 g per litre; foliar spray at disease onset",
        chemical_treatment="Azoxystrobin 23% SC",
        chemical_dosage="1 ml per litre of water",
        store_product="Amistar (Syngenta)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಟಾರ್ಗೆಟ್ ಚುಕ್ಕೆ ರೋಗ",
        prevention="Stake plants; avoid overhead irrigation; remove infected plant debris.",
    ),
    Disease(
        class_id=35, class_label="Tomato_yellow_leaf_curl_virus",
        name="Tomato Yellow Leaf Curl Virus (TYLCV)", scientific_name="Tomato yellow leaf curl virus",
        severity="Critical", affected_crop="Tomato",
        organic_treatment="Neem oil + sticky yellow traps for whitefly control",
        organic_dosage="5 ml neem oil per litre; replace traps every 2 weeks",
        chemical_treatment="Imidacloprid 17.8% SL (whitefly vector control)",
        chemical_dosage="0.3 ml per litre; drench at transplanting",
        store_product="Confidor (BAYER)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಹಳದಿ ಎಲೆ ಸುರುಳಿ ವೈರಸ್",
        prevention="Remove infected plants immediately; control whitefly population; use virus-resistant varieties.",
    ),
    Disease(
        class_id=36, class_label="Tomato_mosaic_virus",
        name="Tomato Mosaic Virus (ToMV)", scientific_name="Tomato mosaic virus",
        severity="High", affected_crop="Tomato",
        organic_treatment="Milk spray (10%) as antiviral",
        organic_dosage="100 ml fresh milk per 900 ml water; spray weekly",
        chemical_treatment="No direct chemical cure; manage aphid vector with Thiamethoxam 25% WG",
        chemical_dosage="0.4 g per litre; spray to control aphids",
        store_product="Actara (Syngenta)",
        kannada_name="ಟೊಮ್ಯಾಟೊ ಮೊಸಾಯಿಕ್ ವೈರಸ್",
        prevention="Use virus-free seed; control aphid vectors; wash hands before handling plants.",
    ),
    Disease(
        class_id=37, class_label="Tomato_healthy",
        name="Healthy Tomato Plant", scientific_name=None,
        severity="Low", affected_crop="Tomato",
        organic_treatment=None, organic_dosage=None,
        chemical_treatment=None, chemical_dosage=None,
        store_product=None,
        kannada_name="ಆರೋಗ್ಯಕರ ಟೊಮ್ಯಾಟೊ ಗಿಡ",
        prevention="Regular scouting; balanced NPK; drip irrigation; proper staking.",
    ),
]


class TreatmentDBBuilder:
    """Builds and populates the disease treatments SQLite database."""

    def __init__(self, db_path: pathlib.Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def create_schema(self, conn: sqlite3.Connection) -> None:
        """Create the diseases table (idempotent)."""
        conn.executescript(CREATE_SQL)
        conn.commit()
        print("  Schema created (or already exists).")

    def populate(self, conn: sqlite3.Connection) -> None:
        """Insert all 38 disease records (fresh — table was dropped in create_schema)."""
        sql = """
        INSERT INTO diseases (
            class_id, class_label, name, scientific_name,
            severity, affected_crop,
            organic_treatment, organic_dosage,
            chemical_treatment, chemical_dosage,
            store_product, kannada_name, kannada_organic, kannada_chemical, prevention
        ) VALUES (
            :class_id, :class_label, :name, :scientific_name,
            :severity, :affected_crop,
            :organic_treatment, :organic_dosage,
            :chemical_treatment, :chemical_dosage,
            :store_product, :kannada_name, :kannada_organic, :kannada_chemical, :prevention
        )
        """
        rows = [
            {
                "class_id":           d.class_id,
                "class_label":        d.class_label,
                "name":               d.name,
                "scientific_name":    d.scientific_name,
                "severity":           d.severity,
                "affected_crop":      d.affected_crop,
                "organic_treatment":  d.organic_treatment,
                "organic_dosage":     d.organic_dosage,
                "chemical_treatment": d.chemical_treatment,
                "chemical_dosage":    d.chemical_dosage,
                "store_product":      d.store_product,
                "kannada_name":       d.kannada_name,
                "kannada_organic":    d.kannada_organic,
                "kannada_chemical":   d.kannada_chemical,
                "prevention":         d.prevention,
            }
            for d in DISEASES
        ]
        conn.executemany(sql, rows)
        conn.commit()
        print(f"  Inserted {len(DISEASES)} disease records.")

    def verify(self, conn: sqlite3.Connection) -> None:
        """Print a summary of the database contents."""
        cursor = conn.execute("SELECT COUNT(*) FROM diseases")
        count = cursor.fetchone()[0]
        cursor2 = conn.execute(
            "SELECT class_id, class_label, severity FROM diseases ORDER BY class_id"
        )
        print(f"\n  {'Idx':>3}  {'Label':<40}  Severity")
        print(f"  {'-'*3}  {'-'*40}  --------")
        for row in cursor2.fetchall():
            print(f"  {row[0]:>3}  {row[1]:<40}  {row[2]}")
        print(f"\n  Total records: {count}")

    def build(self) -> None:
        """Full pipeline: connect, create schema, populate, verify."""
        print("=" * 60)
        print("  KisanShakti — Disease Treatments DB Builder")
        print("=" * 60)
        print(f"\n  Output: {self.db_path}\n")

        conn = self._connect()
        try:
            self.create_schema(conn)
            self.populate(conn)
            self.verify(conn)
        finally:
            conn.close()

        print(f"\nDatabase built successfully at:\n  {self.db_path}\n")


if __name__ == "__main__":
    builder = TreatmentDBBuilder()
    builder.build()

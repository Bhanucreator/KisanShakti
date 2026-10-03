"""
KisanShakti — Crop Disease Model Trainer (38-class, uint8-quantised)
=====================================================================
Trains a MobileNetV2 transfer-learning classifier on the full PlantVillage
dataset (38 classes across 14 crops), optionally augmented with real
field photos from PlantDoc, and exports a TFLite model that matches the
on-device inference contract exactly.

I/O contract (MUST match apps/upaj/src/hooks/use-disease-detection.ts):
  input:  uint8   [1, 224, 224, 3]     raw pixel bytes 0-255
  output: uint8   [1, 38]              quantised softmax scores

Class order (0-37) is fixed by CLASS_LABELS below and MUST match:
  - CLASS_NAMES in apps/upaj/src/hooks/use-disease-detection.ts
  - class_id column in apps/upaj/assets/disease_treatments.db

Usage:
  cd C:/Users/Kiran/kisanshakti
  backend/venv/Scripts/python.exe backend/ai/train_disease_model.py

Options:
  --quick               Smoke test (1 epoch, tiny subset)
  --epochs 8            Frozen-head epochs (default 6)
  --fine-tune-epochs 4  Fine-tune epochs (default 3)
  --batch 32            Batch size
  --no-plantdoc         Skip PlantDoc merge (PlantVillage only)
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import time
from typing import Dict, List, Tuple

SCRIPT_DIR = pathlib.Path(__file__).parent.resolve()
REPO_ROOT  = SCRIPT_DIR.parent.parent
OUT_TFLITE = REPO_ROOT / "apps" / "upaj" / "assets" / "models" / "crop_disease_v1.tflite"

# PlantVillage cached from kagglehub. Download once:
#   python -c "import kagglehub; kagglehub.dataset_download('abdallahalidev/plantvillage-dataset')"
PLANTVILLAGE_ROOT = pathlib.Path.home() / ".cache" / "kagglehub" / "datasets" / \
    "abdallahalidev" / "plantvillage-dataset" / "versions" / "3" / \
    "plantvillage dataset" / "color"

# PlantDoc — first check for a manually-extracted folder in the repo root
# (see backend/ai/_extract_plantdoc.py — bypasses Windows filename issues in
# the GitHub source). If that's not there, fall back to a kagglehub cache.
PLANTDOC_ROOT_DIRECT = REPO_ROOT / "PlantDoc-Dataset"
PLANTDOC_CACHE_PARENT = pathlib.Path.home() / ".cache" / "kagglehub" / "datasets" / "pratikkayal"

# ── Canonical 38 classes (order = class_id 0-37) ─────────────────────────────
CLASS_LABELS: List[str] = [
    "Apple_scab",                       #  0
    "Apple_black_rot",                  #  1
    "Apple_cedar_apple_rust",           #  2
    "Apple_healthy",                    #  3
    "Blueberry_healthy",                #  4
    "Cherry_powdery_mildew",            #  5
    "Cherry_healthy",                   #  6
    "Corn_cercospora_leaf_spot",        #  7
    "Corn_common_rust",                 #  8
    "Corn_northern_leaf_blight",        #  9
    "Corn_healthy",                     # 10
    "Grape_black_rot",                  # 11
    "Grape_esca",                       # 12
    "Grape_leaf_blight",                # 13
    "Grape_healthy",                    # 14
    "Orange_haunglongbing",             # 15
    "Peach_bacterial_spot",             # 16
    "Peach_healthy",                    # 17
    "Pepper_bacterial_spot",            # 18
    "Pepper_healthy",                   # 19
    "Potato_early_blight",              # 20
    "Potato_late_blight",               # 21
    "Potato_healthy",                   # 22
    "Raspberry_healthy",                # 23
    "Soybean_healthy",                  # 24
    "Squash_powdery_mildew",            # 25
    "Strawberry_leaf_scorch",           # 26
    "Strawberry_healthy",               # 27
    "Tomato_bacterial_spot",            # 28
    "Tomato_early_blight",              # 29
    "Tomato_late_blight",               # 30
    "Tomato_leaf_mold",                 # 31
    "Tomato_septoria_leaf_spot",        # 32
    "Tomato_spider_mites",              # 33
    "Tomato_target_spot",               # 34
    "Tomato_yellow_leaf_curl_virus",    # 35
    "Tomato_mosaic_virus",              # 36
    "Tomato_healthy",                   # 37
]
NUM_CLASSES = len(CLASS_LABELS)
IMG_SIZE = 224

# PlantVillage folder → class_id
PLANTVILLAGE_MAP: Dict[str, int] = {
    "Apple___Apple_scab":                                       0,
    "Apple___Black_rot":                                        1,
    "Apple___Cedar_apple_rust":                                 2,
    "Apple___healthy":                                          3,
    "Blueberry___healthy":                                      4,
    "Cherry_(including_sour)___Powdery_mildew":                 5,
    "Cherry_(including_sour)___healthy":                        6,
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot":       7,
    "Corn_(maize)___Common_rust_":                              8,
    "Corn_(maize)___Northern_Leaf_Blight":                      9,
    "Corn_(maize)___healthy":                                  10,
    "Grape___Black_rot":                                       11,
    "Grape___Esca_(Black_Measles)":                            12,
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)":              13,
    "Grape___healthy":                                         14,
    "Orange___Haunglongbing_(Citrus_greening)":                15,
    "Peach___Bacterial_spot":                                  16,
    "Peach___healthy":                                         17,
    "Pepper,_bell___Bacterial_spot":                           18,
    "Pepper,_bell___healthy":                                  19,
    "Potato___Early_blight":                                   20,
    "Potato___Late_blight":                                    21,
    "Potato___healthy":                                        22,
    "Raspberry___healthy":                                     23,
    "Soybean___healthy":                                       24,
    "Squash___Powdery_mildew":                                 25,
    "Strawberry___Leaf_scorch":                                26,
    "Strawberry___healthy":                                    27,
    "Tomato___Bacterial_spot":                                 28,
    "Tomato___Early_blight":                                   29,
    "Tomato___Late_blight":                                    30,
    "Tomato___Leaf_Mold":                                      31,
    "Tomato___Septoria_leaf_spot":                             32,
    "Tomato___Spider_mites Two-spotted_spider_mite":           33,
    "Tomato___Target_Spot":                                    34,
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus":                  35,
    "Tomato___Tomato_mosaic_virus":                            36,
    "Tomato___healthy":                                        37,
}

# PlantDoc folder-name substrings → class_id.
# PlantDoc uses looser folder names ("Tomato Early blight leaf", "Potato leaf late blight"),
# so we match by lowercased substring containment. First match wins.
PLANTDOC_RULES: List[Tuple[Tuple[str, ...], int]] = [
    # each entry: (all-substrings-must-be-present, class_id)
    (("apple", "scab"),                              0),
    (("apple", "rust"),                              2),
    (("apple", "leaf"),                              3),   # generic apple leaf → healthy
    (("blueberry",),                                 4),
    (("cherry",),                                    6),   # PlantDoc has no cherry mildew
    (("corn", "gray"),                               7),
    (("corn", "rust"),                               8),
    (("corn", "blight"),                             9),
    (("corn", "leaf"),                              10),   # generic corn → healthy
    (("grape", "black"),                            11),
    (("grape", "leaf"),                             14),
    (("peach",),                                    17),   # peach leaf → healthy
    (("bell_pepper", "spot"),                       18),
    (("bell_pepper",),                              19),
    (("potato", "early"),                           20),
    (("potato", "late"),                            21),
    (("potato",),                                   22),
    (("raspberry",),                                23),
    (("soyabean",),                                 24),
    (("soybean",),                                  24),
    (("squash",),                                   25),
    (("strawberry",),                               27),
    (("tomato", "bacterial"),                       28),
    (("tomato", "early"),                           29),
    (("tomato", "late"),                            30),
    (("tomato", "mold"),                            31),
    (("tomato", "septoria"),                        32),
    (("tomato", "spider"),                          33),
    (("tomato", "mosaic"),                          36),
    (("tomato", "yellow"),                          35),
    (("tomato", "leaf"),                            37),   # generic tomato → healthy
]


def _scan_plantvillage() -> List[Tuple[str, int]]:
    """(abs_path, class_id) records from PlantVillage cache."""
    if not PLANTVILLAGE_ROOT.exists():
        sys.exit(
            f"[data] ERROR: PlantVillage not found at {PLANTVILLAGE_ROOT}\n"
            f"        python -c \"import kagglehub; "
            f"kagglehub.dataset_download('abdallahalidev/plantvillage-dataset')\""
        )
    records: List[Tuple[str, int]] = []
    per_folder: Dict[str, int] = {}
    for folder_name, cls in PLANTVILLAGE_MAP.items():
        folder = PLANTVILLAGE_ROOT / folder_name
        if not folder.exists():
            print(f"[data]   MISSING PlantVillage folder: {folder_name}")
            per_folder[folder_name] = 0
            continue
        files = [str(p) for p in folder.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png')]
        per_folder[folder_name] = len(files)
        for f in files:
            records.append((f, cls))
    total = sum(per_folder.values())
    print(f"[data] PlantVillage: {total} images across {len(PLANTVILLAGE_MAP)} folders")
    missing = [k for k, v in per_folder.items() if v == 0]
    if missing:
        print(f"[data]   {len(missing)} folders missing/empty: {missing[:5]}{'...' if len(missing) > 5 else ''}")
    return records


def _resolve_plantdoc_root() -> pathlib.Path | None:
    """Return the folder that contains PlantDoc train/ + test/ subfolders.
    Preference: PLANTDOC_ROOT_DIRECT (repo-root/PlantDoc-Dataset) if present,
    else auto-detect inside kagglehub cache.
    """
    if PLANTDOC_ROOT_DIRECT.is_dir() and (
        (PLANTDOC_ROOT_DIRECT / "train").is_dir() or (PLANTDOC_ROOT_DIRECT / "test").is_dir()
    ):
        return PLANTDOC_ROOT_DIRECT
    if not PLANTDOC_CACHE_PARENT.exists():
        return None
    # Find version dirs
    candidates: List[pathlib.Path] = []
    for ds_root in PLANTDOC_CACHE_PARENT.rglob("plantdoc-dataset"):
        candidates.append(ds_root)
    # If none matched, try any dir with 'train' or 'test' inside
    if not candidates:
        for versions_dir in PLANTDOC_CACHE_PARENT.rglob("versions"):
            for v in versions_dir.iterdir():
                candidates.append(v)
    # Pick the one with the most subfolders — likely the images root
    best = None
    best_count = 0
    for root in candidates:
        if not root.is_dir():
            continue
        # PlantDoc: train/ and test/ split, or flat class folders
        for sub in [root, root / "train", root / "test"]:
            if sub.is_dir():
                cls_count = sum(1 for p in sub.iterdir() if p.is_dir())
                if cls_count > best_count:
                    best_count = cls_count
                    best = sub
    return best


def _scan_plantdoc() -> List[Tuple[str, int]]:
    """(abs_path, class_id) from PlantDoc via substring rules. Skips unmatched folders."""
    root = _resolve_plantdoc_root()
    if root is None or not root.exists():
        print("[data] PlantDoc: not found in cache — skipping.")
        return []
    print(f"[data] PlantDoc root: {root}")
    # PlantDoc has train/ + test/ splits. If either exists, use them (skip
    # the parent to avoid scanning .git and other repo metadata). Otherwise
    # fall back to flat class folders at root.
    scan_dirs: List[pathlib.Path] = []
    for sub in [root / "train", root / "test"]:
        if sub.is_dir():
            scan_dirs.append(sub)
    if not scan_dirs:
        scan_dirs.append(root)

    records: List[Tuple[str, int]] = []
    unmatched: Dict[str, int] = {}
    matched: Dict[int, int] = {}
    for d in scan_dirs:
        for cls_folder in d.iterdir():
            if not cls_folder.is_dir():
                continue
            name_lc = cls_folder.name.lower().replace(" ", "_")
            cls_id = None
            for tokens, cid in PLANTDOC_RULES:
                if all(t in name_lc for t in tokens):
                    cls_id = cid
                    break
            if cls_id is None:
                unmatched[cls_folder.name] = unmatched.get(cls_folder.name, 0) + \
                    sum(1 for p in cls_folder.iterdir() if p.is_file())
                continue
            files = [str(p) for p in cls_folder.iterdir()
                     if p.suffix.lower() in ('.jpg', '.jpeg', '.png')]
            matched[cls_id] = matched.get(cls_id, 0) + len(files)
            for f in files:
                records.append((f, cls_id))
    print(f"[data] PlantDoc: {len(records)} images mapped to {len(matched)} classes")
    if unmatched:
        print(f"[data]   unmatched PlantDoc folders (skipped): {list(unmatched.keys())[:8]}")
    return records


def prepare_dataset(batch: int, quick: bool, use_plantdoc: bool):
    import tensorflow as tf
    import numpy as np

    all_records = _scan_plantvillage()
    pd_count = 0
    if use_plantdoc:
        pd = _scan_plantdoc()
        pd_count = len(pd)
        all_records.extend(pd)

    if not all_records:
        sys.exit("[data] ERROR: 0 total files.")

    rng = np.random.default_rng(42)
    rng.shuffle(all_records)
    if quick:
        all_records = all_records[:1500]
        print(f"[data] --quick: truncated to {len(all_records)}")

    n_val = max(1, len(all_records) // 8)
    val_records   = all_records[:n_val]
    train_records = all_records[n_val:]

    counts = [0] * NUM_CLASSES
    for _, y in train_records:
        counts[y] += 1
    print(f"[data] total train: {len(train_records)}  val: {len(val_records)}  (PlantDoc contributed {pd_count})")
    print(f"[data] per-class train counts:")
    for i, c in enumerate(counts):
        marker = "  <-- LOW" if c < 100 else ""
        print(f"[data]   {i:>2} {CLASS_LABELS[i]:<38} {c:>5}{marker}")

    def _decode(path: tf.Tensor, label: tf.Tensor):
        raw = tf.io.read_file(path)
        img = tf.io.decode_image(raw, channels=3, expand_animations=False)
        img = tf.image.resize(img, (IMG_SIZE, IMG_SIZE))
        img = tf.cast(img, tf.float32) / 255.0
        return img, label

    def _to_ds(records, shuffle: bool):
        paths  = tf.constant([r[0] for r in records], dtype=tf.string)
        labels = tf.constant([r[1] for r in records], dtype=tf.int32)
        d = tf.data.Dataset.from_tensor_slices((paths, labels))
        if shuffle:
            d = d.shuffle(min(4096, len(records)), seed=1, reshuffle_each_iteration=True)
        d = d.map(_decode, num_parallel_calls=tf.data.AUTOTUNE)
        # ignore_errors: PlantDoc occasionally has corrupt jpegs
        d = d.apply(tf.data.experimental.ignore_errors())
        d = d.batch(batch).prefetch(tf.data.AUTOTUNE)
        return d

    # Representative set for uint8 quantisation — balanced across classes
    rep_by_class: Dict[int, List[str]] = {}
    for path, y in train_records:
        rep_by_class.setdefault(y, []).append(path)
    rep_items = []
    per_class = max(4, 300 // NUM_CLASSES)
    for cid, paths in rep_by_class.items():
        for p in paths[:per_class]:
            try:
                b = open(p, 'rb').read()
                img = tf.io.decode_image(b, channels=3, expand_animations=False)
                img = tf.image.resize(img, (IMG_SIZE, IMG_SIZE))
                rep_items.append((img.numpy().astype(np.float32) / 255.0, cid))
            except Exception:
                pass
    print(f"[data] representative set: {len(rep_items)} images")

    return _to_ds(train_records, True), _to_ds(val_records, False), rep_items


def build_model():
    """Recipe that hit 95.49% val on 38-class PlantVillage. Do NOT add heavier
    augmentation or a bigger head — both were tried and consistently regressed
    val accuracy by 20-30 points (see project memory / earlier v2/v3 attempts).
    Weak-class robustness is handled at inference time by the safety gates in
    use-disease-detection.ts (stricter thresholds + same-crop ambiguity guard),
    not by more training tricks that empirically hurt.
    """
    import tensorflow as tf
    base = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )
    base.trainable = False
    inp = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3))
    x = tf.keras.layers.Rescaling(2.0, offset=-1.0)(inp)   # [0,1] -> [-1,1]
    x = tf.keras.layers.RandomFlip("horizontal")(x)
    x = tf.keras.layers.RandomRotation(0.1)(x)
    x = tf.keras.layers.RandomZoom(0.1)(x)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.25)(x)
    out = tf.keras.layers.Dense(NUM_CLASSES, activation="softmax")(x)
    return tf.keras.Model(inp, out), base


def convert_to_tflite(keras_model, rep_items):
    import tensorflow as tf
    import numpy as np

    aug_types = (
        tf.keras.layers.RandomFlip,
        tf.keras.layers.RandomRotation,
        tf.keras.layers.RandomZoom,
        tf.keras.layers.RandomTranslation,
        tf.keras.layers.RandomContrast,
        tf.keras.layers.RandomBrightness,
        tf.keras.layers.GaussianNoise,
        tf.keras.layers.InputLayer,
        tf.keras.layers.Rescaling,
    )
    inp = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), dtype=tf.float32)
    x = tf.keras.layers.Rescaling(2.0, offset=-1.0)(inp)
    for l in keras_model.layers:
        if isinstance(l, aug_types):
            continue
        x = l(x)
    infer_model = tf.keras.Model(inp, x)

    def rep_gen():
        for img, _y in rep_items[:300]:
            yield [np.expand_dims(img.astype("float32"), axis=0)]

    conv = tf.lite.TFLiteConverter.from_keras_model(infer_model)
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    conv.representative_dataset = rep_gen
    conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    conv.inference_input_type = tf.uint8
    conv.inference_output_type = tf.uint8
    print("[tflite] converting to full-integer uint8…")
    return conv.convert()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--fine-tune-epochs", type=int, default=3)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--no-plantdoc", action="store_true", help="Skip PlantDoc field-photo merge")
    args = ap.parse_args()

    import tensorflow as tf
    print(f"[env] TF {tf.__version__} · GPUs: {tf.config.list_physical_devices('GPU')}")

    train_ds, val_ds, rep_items = prepare_dataset(
        args.batch, args.quick, use_plantdoc=not args.no_plantdoc
    )

    model, base = build_model()
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=["accuracy"],
    )
    model.summary(line_length=110)

    # Checkpoint on best val — if training is killed we still have the best epoch.
    ckpt_dir = SCRIPT_DIR / "_ckpt"
    ckpt_dir.mkdir(exist_ok=True)
    ckpt_path = ckpt_dir / "best.weights.h5"
    ckpt_cb = tf.keras.callbacks.ModelCheckpoint(
        filepath=str(ckpt_path),
        monitor="val_accuracy", save_best_only=True, save_weights_only=True,
        verbose=1,
    )

    epochs = 1 if args.quick else args.epochs
    print(f"[train] frozen-head phase: {epochs} epochs, batch={args.batch}")
    t0 = time.time()
    model.fit(train_ds, validation_data=val_ds, epochs=epochs, callbacks=[ckpt_cb])

    if not args.quick and args.fine_tune_epochs > 0:
        base.trainable = True
        for l in base.layers[:-40]:
            l.trainable = False
        model.compile(
            optimizer=tf.keras.optimizers.Adam(1e-5),
            loss=tf.keras.losses.SparseCategoricalCrossentropy(),
            metrics=["accuracy"],
        )
        print(f"[train] fine-tune phase: {args.fine_tune_epochs} epochs")
        model.fit(train_ds, validation_data=val_ds, epochs=args.fine_tune_epochs, callbacks=[ckpt_cb])

    # Restore best-val weights before evaluation + export.
    if ckpt_path.exists():
        try:
            model.load_weights(str(ckpt_path))
            print(f"[train] restored best-val weights from {ckpt_path}")
        except Exception as e:
            print(f"[train] could NOT restore checkpoint ({e}) — using final-epoch weights")

    val_loss, val_acc = model.evaluate(val_ds, verbose=0)
    print(f"[eval] val accuracy: {val_acc*100:.2f}%  loss: {val_loss:.3f}")
    if val_acc < 0.85:
        print("[eval] WARNING: val accuracy under 85% — consider upgrading backbone.")

    tflite_bytes = convert_to_tflite(model, rep_items)
    OUT_TFLITE.parent.mkdir(parents=True, exist_ok=True)
    OUT_TFLITE.write_bytes(tflite_bytes)
    print(f"[out] wrote {OUT_TFLITE}  ({len(tflite_bytes)/1024:.0f} KB)")
    print(f"[out] elapsed: {(time.time()-t0)/60:.1f} min")
    print("\nClass order (matches CLASS_NAMES in hook + class_id in DB):")
    for i, n in enumerate(CLASS_LABELS):
        print(f"  {i:>2}: {n}")


if __name__ == "__main__":
    main()

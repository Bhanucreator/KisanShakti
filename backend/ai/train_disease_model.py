"""
KisanShakti - Crop Disease Model Trainer
========================================
Trains a MobileNetV2-based classifier on the PlantVillage dataset (38 classes)
and exports a TFLite model (INT8 weight quantization, float32 I/O) that matches
the on-device inference contract in `apps/upaj/src/hooks/use-disease-detection.ts`.

I/O contract (must match the RN hook):
  input:  float32  [1, 224, 224, 3]   pixel values in [0, 1]
  output: uint8    [1, 38]            quantized softmax scores

Class order:
  The 38 dataset folders are sorted alphabetically. This matches the alphabetical
  ordering assumed by `CLASS_NAMES` in use-disease-detection.ts (Apple_scab first
  ... Tomato_healthy last). If you rename dataset folders or add classes, run
  `python train_disease_model.py --print-classes` and update CLASS_NAMES to match.

Usage:
    # 1) Install ML deps into the backend venv
    pip install -r backend/ai/requirements-ml.txt

    # 2) (Optional) set up Kaggle API (~/.kaggle/kaggle.json) — see README

    # 3) Smoke test (1 epoch, tiny subset — a few minutes on CPU)
    python train_disease_model.py --quick

    # 4) Full training (hours on CPU, ~30 min on GPU)
    python train_disease_model.py --epochs 15 --batch 32
"""

from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import subprocess
import sys
import zipfile
from typing import Optional

import numpy as np

# TF is imported lazily inside main() so `--print-classes` works without TF.


# --- Paths ------------------------------------------------------------------
SCRIPT_DIR  = pathlib.Path(__file__).parent.resolve()
REPO_ROOT   = SCRIPT_DIR.parent.parent
DEFAULT_DATA_DIR = SCRIPT_DIR / "data" / "plantvillage"
MODEL_DIR   = REPO_ROOT / "apps" / "upaj" / "assets" / "models"
CHECKPOINT  = SCRIPT_DIR / "checkpoints" / "disease_model.weights.h5"
SAVED_MODEL = SCRIPT_DIR / "saved_model" / "crop_disease_v1"
TFLITE_OUT  = MODEL_DIR / "crop_disease_v1.tflite"

IMG_SIZE    = 224
NUM_CLASSES = 38

# Kaggle dataset candidates, tried in order.
KAGGLE_CANDIDATES = [
    # (slug, subfolder inside the extracted zip that contains the class folders)
    ("abdallahalidev/plantvillage-dataset", "plantvillage dataset/color"),
    ("arjuntejaswi/plant-village",          "PlantVillage"),
    ("emmarex/plantdisease",                "PlantVillage"),
]


# --- Dataset download -------------------------------------------------------

def _which_kaggle() -> Optional[str]:
    return shutil.which("kaggle")


def _try_kaggle_download(data_dir: pathlib.Path) -> Optional[pathlib.Path]:
    """
    Try to download PlantVillage via the Kaggle CLI. Returns the path to the
    directory that contains the 38 class folders, or None on failure.
    """
    kaggle = _which_kaggle()
    if not kaggle:
        print("  [kaggle] CLI not found on PATH. Skipping download.")
        return None

    kaggle_json = pathlib.Path.home() / ".kaggle" / "kaggle.json"
    if not kaggle_json.exists():
        print(f"  [kaggle] Credentials not found at {kaggle_json}. Skipping download.")
        return None

    data_dir.mkdir(parents=True, exist_ok=True)

    for slug, subfolder in KAGGLE_CANDIDATES:
        print(f"  [kaggle] Trying dataset: {slug}")
        try:
            subprocess.run(
                [kaggle, "datasets", "download", "-d", slug, "-p", str(data_dir), "--unzip"],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            print(f"  [kaggle] Download of {slug} failed: {e}")
            continue

        candidate = data_dir / subfolder
        if candidate.exists() and any(candidate.iterdir()):
            print(f"  [kaggle] Using class folders from: {candidate}")
            return candidate

        # Fall back: search for any folder containing >= 30 subfolders.
        for path in data_dir.rglob("*"):
            if path.is_dir():
                subdirs = [p for p in path.iterdir() if p.is_dir()]
                if len(subdirs) >= 30:
                    print(f"  [kaggle] Auto-detected class folders at: {path}")
                    return path

        print(f"  [kaggle] Expected subfolder not found for {slug}. Trying next.")

    return None


def resolve_data_dir(data_dir: pathlib.Path) -> pathlib.Path:
    """
    Ensure a directory containing the class subfolders is available.
    If it isn't, attempt to download via Kaggle.
    """
    if data_dir.exists() and any(p.is_dir() for p in data_dir.iterdir()):
        subdirs = [p for p in data_dir.iterdir() if p.is_dir()]
        if len(subdirs) >= 30:
            return data_dir
        # user pointed at parent of the real class dir - descend one level
        for sub in subdirs:
            more = [p for p in sub.iterdir() if p.is_dir()]
            if len(more) >= 30:
                return sub

    print(f"[data] No dataset found at {data_dir}. Attempting Kaggle download.")
    downloaded = _try_kaggle_download(data_dir)
    if downloaded is None:
        raise SystemExit(
            "\nERROR: Could not obtain PlantVillage dataset.\n"
            "Options:\n"
            "  1) Configure Kaggle API and re-run (see backend/ai/README.md).\n"
            "  2) Manually place the 38 class folders under:\n"
            f"     {data_dir}\n"
            "     Each folder name should exactly match a PlantVillage class\n"
            "     (e.g. `Apple___Apple_scab`, `Tomato___healthy`, ...).\n"
        )
    return downloaded


# --- Model ------------------------------------------------------------------

def build_model(tf):
    """MobileNetV2 backbone + custom classification head. Base is initially frozen."""
    base = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="image")
    x = base(inputs, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D(name="gap")(x)
    x = tf.keras.layers.Dense(256, activation="relu", name="dense_256")(x)
    x = tf.keras.layers.Dropout(0.3, name="dropout")(x)
    outputs = tf.keras.layers.Dense(NUM_CLASSES, activation="softmax", name="predictions")(x)

    model = tf.keras.Model(inputs, outputs, name="crop_disease_v1")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model, base


# --- Data pipeline ----------------------------------------------------------

def build_datasets(tf, data_root: pathlib.Path, batch_size: int, quick: bool):
    """
    Build train/val tf.data.Datasets from an on-disk folder of class subfolders.
    Class names are the folder names sorted alphabetically - this must match
    CLASS_NAMES in use-disease-detection.ts.
    """
    AUTOTUNE = tf.data.AUTOTUNE

    train_raw = tf.keras.utils.image_dataset_from_directory(
        str(data_root),
        validation_split=0.2,
        subset="training",
        seed=42,
        image_size=(IMG_SIZE, IMG_SIZE),
        batch_size=batch_size,
        label_mode="int",
        shuffle=True,
    )
    class_names = list(train_raw.class_names)
    print(f"[data] Detected {len(class_names)} classes:")
    for i, n in enumerate(class_names):
        print(f"       {i:>3}  {n}")

    if len(class_names) != NUM_CLASSES:
        print(
            f"\nWARNING: expected {NUM_CLASSES} classes but found {len(class_names)}. "
            "The output softmax will not match the RN hook."
        )

    val_raw = tf.keras.utils.image_dataset_from_directory(
        str(data_root),
        validation_split=0.2,
        subset="validation",
        seed=42,
        image_size=(IMG_SIZE, IMG_SIZE),
        batch_size=batch_size,
        label_mode="int",
        shuffle=False,
    )

    augment = tf.keras.Sequential([
        tf.keras.layers.RandomFlip("horizontal_and_vertical"),
        tf.keras.layers.RandomRotation(0.2),
        tf.keras.layers.RandomZoom(0.15),
    ], name="augmentation")

    def _normalize(x, y):
        return tf.cast(x, tf.float32) / 255.0, y

    def _augment(x, y):
        return augment(x, training=True), y

    train_ds = train_raw.map(_normalize, num_parallel_calls=AUTOTUNE)
    train_ds = train_ds.map(_augment, num_parallel_calls=AUTOTUNE)
    val_ds   = val_raw.map(_normalize, num_parallel_calls=AUTOTUNE)

    if quick:
        # Tiny subset for smoke testing - keeps run under a couple of minutes.
        train_ds = train_ds.take(20)
        val_ds   = val_ds.take(5)

    train_ds = train_ds.prefetch(AUTOTUNE)
    val_ds   = val_ds.prefetch(AUTOTUNE)
    return train_ds, val_ds, class_names


# --- Training ---------------------------------------------------------------

def train(tf, model, base, train_ds, val_ds, epochs_head: int, epochs_finetune: int):
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(CHECKPOINT),
            save_weights_only=True,
            save_best_only=True,
            monitor="val_accuracy",
            verbose=1,
        ),
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=4,
            restore_best_weights=True,
            verbose=1,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=2,
            verbose=1,
        ),
    ]

    if epochs_head > 0:
        print(f"[train] Phase 1: head warmup for {epochs_head} epochs (base frozen).")
        model.fit(train_ds, validation_data=val_ds, epochs=epochs_head, callbacks=callbacks)

    if epochs_finetune > 0:
        print(f"[train] Phase 2: fine-tuning top-50 layers for {epochs_finetune} epochs.")
        base.trainable = True
        for layer in base.layers[:-50]:
            layer.trainable = False
        model.compile(
            optimizer=tf.keras.optimizers.Adam(1e-5),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"],
        )
        model.fit(train_ds, validation_data=val_ds, epochs=epochs_finetune, callbacks=callbacks)

    SAVED_MODEL.parent.mkdir(parents=True, exist_ok=True)
    model.export(str(SAVED_MODEL))  # Keras 3: writes SavedModel
    print(f"[train] Saved SavedModel to {SAVED_MODEL}")


# --- TFLite export ----------------------------------------------------------

def convert_to_tflite(tf, val_ds) -> int:
    """
    INT8 weight quantization with float32 input and uint8 output.
      - input float32 matches Float32Array sent from the RN hook
      - uint8 output is handled by the hook (it re-normalizes)
    Returns the size of the produced tflite file in bytes.
    """
    print("[export] Converting to INT8-quantized TFLite ...")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    def representative_dataset():
        # Uses up to 200 real calibration samples if available.
        count = 0
        for batch in val_ds:
            images = batch[0] if isinstance(batch, tuple) else batch
            for i in range(images.shape[0]):
                yield [tf.cast(images[i:i+1], tf.float32)]
                count += 1
                if count >= 200:
                    return

    converter = tf.lite.TFLiteConverter.from_saved_model(str(SAVED_MODEL))
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [
        tf.lite.OpsSet.TFLITE_BUILTINS_INT8,
        tf.lite.OpsSet.TFLITE_BUILTINS,  # fallback for unsupported ops
    ]
    converter.inference_input_type  = tf.float32  # matches RN hook
    converter.inference_output_type = tf.uint8

    tflite_bytes = converter.convert()
    TFLITE_OUT.write_bytes(tflite_bytes)
    return len(tflite_bytes)


def verify_tflite(tf) -> None:
    """Load the produced tflite, sanity-check I/O shapes."""
    interpreter = tf.lite.Interpreter(model_path=str(TFLITE_OUT))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    print(f"[verify] input : shape={list(inp['shape'])}, dtype={inp['dtype']}")
    print(f"[verify] output: shape={list(out['shape'])}, dtype={out['dtype']}")

    if list(inp["shape"]) != [1, IMG_SIZE, IMG_SIZE, 3]:
        raise SystemExit(f"ERROR: unexpected input shape {list(inp['shape'])}")
    if list(out["shape"]) != [1, NUM_CLASSES]:
        raise SystemExit(f"ERROR: unexpected output shape {list(out['shape'])}")
    if TFLITE_OUT.stat().st_size == 0:
        raise SystemExit("ERROR: exported tflite is 0 bytes")
    print(f"[verify] OK ({TFLITE_OUT.stat().st_size:,} bytes)")


# --- CLI --------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="KisanShakti crop disease trainer.")
    p.add_argument("--data_dir", type=pathlib.Path, default=DEFAULT_DATA_DIR,
                   help="Directory containing the 38 class subfolders "
                        "(will attempt Kaggle download if empty).")
    p.add_argument("--epochs", type=int, default=15,
                   help="Total epochs (split as 5 head + rest fine-tune).")
    p.add_argument("--batch", type=int, default=32, help="Batch size.")
    p.add_argument("--quick", action="store_true",
                   help="Smoke test: 1 epoch on a tiny subset (minutes, no GPU needed).")
    p.add_argument("--print-classes", action="store_true",
                   help="Print the alphabetical class order derived from --data_dir and exit.")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "1")

    if args.print_classes:
        data_root = resolve_data_dir(args.data_dir)
        classes = sorted(p.name for p in data_root.iterdir() if p.is_dir())
        for i, n in enumerate(classes):
            print(f"{i:>3}  {n}")
        return

    try:
        import tensorflow as tf  # noqa: F401
    except ImportError:
        raise SystemExit(
            "\nERROR: tensorflow is not installed in this Python environment.\n"
            "Run:  pip install -r backend/ai/requirements-ml.txt\n"
        )

    print("=" * 60)
    print("  KisanShakti Crop Disease Trainer")
    print("=" * 60)

    data_root = resolve_data_dir(args.data_dir)
    print(f"[data] Using: {data_root}")

    if args.quick:
        epochs_head, epochs_finetune, batch = 1, 0, min(args.batch, 16)
        print("[mode] --quick: 1 head epoch, no fine-tune, tiny subset.")
    else:
        epochs_head = min(5, args.epochs)
        epochs_finetune = max(0, args.epochs - epochs_head)
        batch = args.batch

    train_ds, val_ds, class_names = build_datasets(tf, data_root, batch, args.quick)

    model, base = build_model(tf)
    model.summary()

    train(tf, model, base, train_ds, val_ds, epochs_head, epochs_finetune)

    size = convert_to_tflite(tf, val_ds)
    print(f"[export] Wrote {TFLITE_OUT}  ({size/1024:.1f} KB)")
    verify_tflite(tf)

    print("\nDone. Deployed to:", TFLITE_OUT)


if __name__ == "__main__":
    main()

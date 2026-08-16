"""
Build a placeholder crop_disease_v1.tflite so the RN app can load the model and
run end-to-end while the real training pipeline is still cooking.

The model is a randomly-initialised MobileNetV2 head:
  input  : float32 [1, 224, 224, 3]   (pixel values in [0, 1])
  output : uint8   [1, 38]            (quantized softmax scores)

This exactly matches the on-device inference contract in
  apps/upaj/src/hooks/use-disease-detection.ts

Usage:
    .\\backend\\venv\\Scripts\\pip.exe install -r backend\\ai\\requirements-ml.txt
    .\\backend\\venv\\Scripts\\python.exe backend\\ai\\build_placeholder_tflite.py
"""

from __future__ import annotations

import pathlib
import numpy as np

SCRIPT_DIR = pathlib.Path(__file__).parent.resolve()
REPO_ROOT  = SCRIPT_DIR.parent.parent
OUT_PATH   = REPO_ROOT / "apps" / "upaj" / "assets" / "models" / "crop_disease_v1.tflite"

IMG_SIZE    = 224
NUM_CLASSES = 38


def build() -> int:
    try:
        import tensorflow as tf
    except ImportError:
        raise SystemExit(
            "tensorflow is not installed. Run:\n"
            "  .\\backend\\venv\\Scripts\\pip.exe install -r backend\\ai\\requirements-ml.txt"
        )

    print("[placeholder] Building MobileNetV2 with ImageNet weights + random head ...")
    base = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )
    inputs  = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="image")
    x = base(inputs, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dense(256, activation="relu")(x)
    outputs = tf.keras.layers.Dense(NUM_CLASSES, activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs, name="crop_disease_v1_placeholder")

    saved_dir = SCRIPT_DIR / "saved_model" / "placeholder"
    saved_dir.parent.mkdir(parents=True, exist_ok=True)
    if saved_dir.exists():
        import shutil
        shutil.rmtree(saved_dir)
    model.export(str(saved_dir))

    print("[placeholder] Converting to INT8-quantized TFLite (float32 in, uint8 out) ...")

    def rep_data():
        for _ in range(50):
            yield [np.random.rand(1, IMG_SIZE, IMG_SIZE, 3).astype(np.float32)]

    converter = tf.lite.TFLiteConverter.from_saved_model(str(saved_dir))
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = rep_data
    converter.target_spec.supported_ops = [
        tf.lite.OpsSet.TFLITE_BUILTINS_INT8,
        tf.lite.OpsSet.TFLITE_BUILTINS,
    ]
    converter.inference_input_type  = tf.float32
    converter.inference_output_type = tf.uint8

    tflite_bytes = converter.convert()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_bytes(tflite_bytes)

    # Sanity check
    interpreter = tf.lite.Interpreter(model_path=str(OUT_PATH))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    print(f"[placeholder] input : shape={list(inp['shape'])}, dtype={inp['dtype']}")
    print(f"[placeholder] output: shape={list(out['shape'])}, dtype={out['dtype']}")
    assert list(inp["shape"]) == [1, IMG_SIZE, IMG_SIZE, 3]
    assert list(out["shape"]) == [1, NUM_CLASSES]

    size = OUT_PATH.stat().st_size
    print(f"[placeholder] Wrote {OUT_PATH}  ({size:,} bytes, {size/1024/1024:.2f} MB)")
    return size


if __name__ == "__main__":
    build()

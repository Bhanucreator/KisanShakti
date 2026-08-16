"""
KisanShakti — Crop Disease Model Trainer
=========================================
Trains a MobileNetV2-based classifier on the PlantVillage dataset (38 classes)
and exports an INT8-quantized TFLite model.

Usage:
    pip install tensorflow tensorflow-datasets
    python train_disease_model.py
"""

import os
import pathlib
import numpy as np
import tensorflow as tf
import tensorflow_datasets as tfds

# ── Configuration ──────────────────────────────────────────────────────────────
IMG_SIZE       = 224
BATCH_SIZE     = 32
EPOCHS_FROZEN  = 10     # train only the head
EPOCHS_FINETUNE = 10    # unfreeze top layers and fine-tune
NUM_CLASSES    = 38
AUTOTUNE       = tf.data.AUTOTUNE

# Paths (relative to this script)
SCRIPT_DIR   = pathlib.Path(__file__).parent.resolve()
REPO_ROOT    = SCRIPT_DIR.parent.parent
MODEL_DIR    = REPO_ROOT / "apps" / "upaj" / "assets" / "models"
CHECKPOINT   = SCRIPT_DIR / "checkpoints" / "disease_model.weights.h5"
SAVED_MODEL  = SCRIPT_DIR / "saved_model" / "crop_disease_v1"
TFLITE_OUT   = MODEL_DIR / "crop_disease_v1.tflite"

# PlantVillage class order (38 classes, matching the treatments DB)
CLASS_NAMES = [
    "Apple___Apple_scab",
    "Apple___Black_rot",
    "Apple___Cedar_apple_rust",
    "Apple___healthy",
    "Blueberry___healthy",
    "Cherry_(including_sour)___Powdery_mildew",
    "Cherry_(including_sour)___healthy",
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
    "Corn_(maize)___Common_rust_",
    "Corn_(maize)___Northern_Leaf_Blight",
    "Corn_(maize)___healthy",
    "Grape___Black_rot",
    "Grape___Esca_(Black_Measles)",
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)",
    "Grape___healthy",
    "Orange___Haunglongbing_(Citrus_greening)",
    "Peach___Bacterial_spot",
    "Peach___healthy",
    "Pepper,_bell___Bacterial_spot",
    "Pepper,_bell___healthy",
    "Potato___Early_blight",
    "Potato___Late_blight",
    "Potato___healthy",
    "Raspberry___healthy",
    "Soybean___healthy",
    "Squash___Powdery_mildew",
    "Strawberry___Leaf_scorch",
    "Strawberry___healthy",
    "Tomato___Bacterial_spot",
    "Tomato___Early_blight",
    "Tomato___Late_blight",
    "Tomato___Leaf_Mold",
    "Tomato___Septoria_leaf_spot",
    "Tomato___Spider_mites Two-spotted_spider_mite",
    "Tomato___Target_Spot",
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
    "Tomato___Tomato_mosaic_virus",
    "Tomato___healthy",
]


class DiseaseModelTrainer:
    """End-to-end trainer for the PlantVillage crop disease classifier."""

    def __init__(self) -> None:
        self.train_ds: tf.data.Dataset | None = None
        self.val_ds:   tf.data.Dataset | None = None
        self.model:    tf.keras.Model | None  = None

        # Create output directories
        CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
        SAVED_MODEL.parent.mkdir(parents=True, exist_ok=True)
        MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # ── 1. Dataset ────────────────────────────────────────────────────────────

    def prepare_dataset(self) -> None:
        """Download PlantVillage via tensorflow_datasets and build tf.data pipelines."""
        print("[1/4] Preparing dataset …")

        # plant_village comes with a single split; we create our own 80/20 split
        ds_full, info = tfds.load(
            "plant_village",
            split="train",
            as_supervised=True,
            with_info=True,
        )
        total = info.splits["train"].num_examples
        val_size = int(total * 0.2)

        ds_full = ds_full.shuffle(10_000, seed=42, reshuffle_each_iteration=False)
        val_raw  = ds_full.take(val_size)
        train_raw = ds_full.skip(val_size)

        # Data augmentation (applied only to the training set)
        augment = tf.keras.Sequential([
            tf.keras.layers.RandomFlip("horizontal_and_vertical"),
            tf.keras.layers.RandomRotation(0.2),
            tf.keras.layers.RandomZoom(0.15),
        ], name="augmentation")

        def preprocess(image: tf.Tensor, label: tf.Tensor, training: bool = False):
            image = tf.image.resize(image, [IMG_SIZE, IMG_SIZE])
            image = tf.cast(image, tf.float32) / 255.0
            if training:
                image = augment(image, training=True)
            return image, label

        self.train_ds = (
            train_raw
            .map(lambda x, y: preprocess(x, y, True), num_parallel_calls=AUTOTUNE)
            .batch(BATCH_SIZE)
            .prefetch(AUTOTUNE)
        )
        self.val_ds = (
            val_raw
            .map(lambda x, y: preprocess(x, y, False), num_parallel_calls=AUTOTUNE)
            .batch(BATCH_SIZE)
            .prefetch(AUTOTUNE)
        )
        print(f"   Total examples : {total}  |  Val: {val_size}  |  Train: {total - val_size}")

    # ── 2. Model ──────────────────────────────────────────────────────────────

    def build_model(self) -> None:
        """Build MobileNetV2 with custom classification head."""
        print("[2/4] Building model …")

        base = tf.keras.applications.MobileNetV2(
            input_shape=(IMG_SIZE, IMG_SIZE, 3),
            include_top=False,
            weights="imagenet",
        )
        base.trainable = False  # freeze for warm-up

        inputs = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="image")
        x = base(inputs, training=False)
        x = tf.keras.layers.GlobalAveragePooling2D(name="gap")(x)
        x = tf.keras.layers.Dense(256, activation="relu", name="dense_256")(x)
        x = tf.keras.layers.Dropout(0.3, name="dropout")(x)
        outputs = tf.keras.layers.Dense(NUM_CLASSES, activation="softmax", name="predictions")(x)

        self.model = tf.keras.Model(inputs, outputs, name="crop_disease_v1")
        self.model.compile(
            optimizer=tf.keras.optimizers.Adam(1e-3),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"],
        )
        self.model.summary()

    # ── 3. Training ───────────────────────────────────────────────────────────

    def train(self) -> None:
        """Two-phase training: frozen head warm-up, then fine-tune."""
        assert self.model is not None and self.train_ds is not None

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

        # Phase 1 — train head only
        print(f"[3/4] Phase 1: training classification head for {EPOCHS_FROZEN} epochs …")
        self.model.fit(
            self.train_ds,
            validation_data=self.val_ds,
            epochs=EPOCHS_FROZEN,
            callbacks=callbacks,
        )

        # Phase 2 — unfreeze top 50 layers and fine-tune with lower LR
        print(f"[3/4] Phase 2: fine-tuning top layers for {EPOCHS_FINETUNE} epochs …")
        base_model: tf.keras.Model = self.model.get_layer("mobilenetv2_1.00_224")
        base_model.trainable = True
        for layer in base_model.layers[:-50]:
            layer.trainable = False

        self.model.compile(
            optimizer=tf.keras.optimizers.Adam(1e-5),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"],
        )
        self.model.fit(
            self.train_ds,
            validation_data=self.val_ds,
            epochs=EPOCHS_FINETUNE,
            callbacks=callbacks,
        )

        # Save the Keras saved model
        self.model.save(str(SAVED_MODEL))
        print(f"   Saved Keras model → {SAVED_MODEL}")

    # ── 4. TFLite Export ──────────────────────────────────────────────────────

    def convert_to_tflite(self) -> None:
        """Convert saved Keras model to INT8-quantized TFLite."""
        print("[4/4] Converting to INT8 TFLite …")
        assert self.val_ds is not None

        # Build a representative dataset generator (calibration)
        def representative_dataset():
            for images, _ in self.val_ds.unbatch().batch(1).take(200):
                yield [tf.cast(images, tf.float32)]

        converter = tf.lite.TFLiteConverter.from_saved_model(str(SAVED_MODEL))
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.representative_dataset = representative_dataset
        converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
        converter.inference_input_type  = tf.uint8
        converter.inference_output_type = tf.uint8

        tflite_model = converter.convert()

        TFLITE_OUT.write_bytes(tflite_model)
        size_kb = len(tflite_model) / 1024
        print(f"   TFLite model saved → {TFLITE_OUT}  ({size_kb:.1f} KB)")

    # ── Orchestrator ──────────────────────────────────────────────────────────

    def run(self) -> None:
        """Full pipeline: dataset → model → train → tflite."""
        print("=" * 60)
        print("  KisanShakti Crop Disease Model — Training Pipeline")
        print("=" * 60)
        self.prepare_dataset()
        self.build_model()
        self.train()
        self.convert_to_tflite()
        print("\nDone! Model ready for deployment.")


if __name__ == "__main__":
    # Suppress TF info logs
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "1"
    trainer = DiseaseModelTrainer()
    trainer.run()

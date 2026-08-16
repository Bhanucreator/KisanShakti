import os
import tensorflow as tf
import numpy as np

# Path to export the quantized model
EXPORT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../apps/upaj/assets/models'))
MODEL_PATH = os.path.join(EXPORT_DIR, 'crop_disease_v1.tflite')

# Hyperparameters
IMG_SIZE = (224, 224)
BATCH_SIZE = 16
NUM_CLASSES = 5 # Example classes

def build_model():
    """
    Builds the MobileNetV2 architecture for Edge-AI inference.
    """
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(224, 224, 3),
        include_top=False,
        weights='imagenet'
    )
    base_model.trainable = False # Freeze base model

    model = tf.keras.Sequential([
        base_model,
        tf.keras.layers.GlobalAveragePooling2D(),
        tf.keras.layers.Dense(NUM_CLASSES, activation='softmax')
    ])
    
    model.compile(
        optimizer='adam',
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    return model

def representative_dataset_gen():
    """
    Generator function used during INT8 quantization to calibrate the model.
    Yields representative input data.
    """
    for _ in range(100):
        # Yielding dummy data for calibration.
        # In production, yield actual images from the training dataset.
        yield [np.random.rand(1, 224, 224, 3).astype(np.float32)]

def train_and_export():
    print(f"Creating directories: {EXPORT_DIR}")
    os.makedirs(EXPORT_DIR, exist_ok=True)

    print("Building MobileNetV2 model...")
    model = build_model()

    print("Training model... (Using dummy data for scaffolding)")
    # Generate dummy data for 1 epoch to ensure structural integrity
    x_train = np.random.rand(BATCH_SIZE, 224, 224, 3).astype(np.float32)
    y_train = np.random.randint(0, NUM_CLASSES, BATCH_SIZE)
    model.fit(x_train, y_train, epochs=1, batch_size=BATCH_SIZE)

    print("Quantizing model to INT8...")
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset_gen
    
    # Ensure that if any ops can't be quantized, the converter throws an error
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    # Set the input and output tensors to uint8 (APIs added in r2.3)
    converter.inference_input_type = tf.uint8
    converter.inference_output_type = tf.uint8

    tflite_quant_model = converter.convert()

    print(f"Exporting quantized model to {MODEL_PATH}")
    with open(MODEL_PATH, 'wb') as f:
        f.write(tflite_quant_model)
    
    print("Export complete!")

if __name__ == '__main__':
    train_and_export()

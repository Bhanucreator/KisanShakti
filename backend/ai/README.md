# KisanShakti — ML Training Pipeline

This folder trains and exports the on-device crop-disease classifier used by the
Upaj React Native app (`apps/upaj`). The output is a single quantized TFLite
file consumed by `react-native-fast-tflite`:

```
apps/upaj/assets/models/crop_disease_v1.tflite
```

## Inference contract (must not drift)

The RN hook `apps/upaj/src/hooks/use-disease-detection.ts` expects:

| Tensor | Shape                 | dtype   | Notes                                    |
| ------ | --------------------- | ------- | ---------------------------------------- |
| input  | `[1, 224, 224, 3]`    | float32 | Pixel values normalised to `[0, 1]`.     |
| output | `[1, 38]`             | uint8   | Quantized softmax scores. Argmax → class.|

Class order is the alphabetical `CLASS_NAMES` array in the hook. The training
pipeline preserves that order by reading dataset folders sorted alphabetically.

---

## 1. Install ML dependencies (into the backend venv)

From the repo root (PowerShell):

```powershell
.\backend\venv\Scripts\pip.exe install -r backend\ai\requirements-ml.txt
```

This installs `tensorflow`, `numpy`, `pillow`, `kaggle`, and `tqdm`. Only the
backend venv is touched — nothing is installed globally.

TensorFlow on Windows is CPU-only by default; that is fine — the trainer works
without a GPU (just slower).

## 2. Set up Kaggle credentials (only needed for auto-download)

1. Create an API token at <https://www.kaggle.com/settings/account> → *Create New Token*.
2. Save the downloaded `kaggle.json` to `%USERPROFILE%\.kaggle\kaggle.json`
   (i.e. `C:\Users\<you>\.kaggle\kaggle.json`).
3. Optionally restrict permissions: `icacls "%USERPROFILE%\.kaggle\kaggle.json" /inheritance:r /grant:r "%USERNAME%:R"`.

The trainer tries these datasets in order and uses the first one that downloads
successfully:

1. `abdallahalidev/plantvillage-dataset` (recommended — full RGB set, ~2 GB)
2. `arjuntejaswi/plant-village`
3. `emmarex/plantdisease`

If Kaggle isn't configured you can manually drop the 38 class folders under
`backend/ai/data/plantvillage/` and re-run the trainer.

## 3. Smoke-test training (a few minutes on CPU)

Sanity-check the full pipeline end-to-end:

```powershell
.\backend\venv\Scripts\python.exe backend\ai\train_disease_model.py --quick
```

`--quick` uses 1 epoch on a tiny subset and skips fine-tuning. It writes a
valid (but weak) `crop_disease_v1.tflite`. Use it to verify that the app loads
the model and inference returns a class index in `[0, 38)`.

## 4. Full training

```powershell
.\backend\venv\Scripts\python.exe backend\ai\train_disease_model.py --epochs 15 --batch 32
```

Phases:

- **Phase 1 (head warmup):** 5 epochs with the MobileNetV2 backbone frozen.
- **Phase 2 (fine-tune):** remaining epochs unfreeze the top 50 layers with LR `1e-5`.

CLI flags:

| Flag              | Default                                 | Meaning                                  |
| ----------------- | --------------------------------------- | ---------------------------------------- |
| `--data_dir PATH` | `backend/ai/data/plantvillage`          | Folder containing the 38 class subdirs.  |
| `--epochs N`      | `15`                                    | Total epochs (5 head + rest fine-tune).  |
| `--batch N`       | `32`                                    | Batch size.                              |
| `--quick`         | off                                     | 1 epoch on tiny subset — smoke test.     |
| `--print-classes` | off                                     | Print detected alphabetical class order. |

### Expected artefacts

- `backend/ai/checkpoints/disease_model.weights.h5` — best val-accuracy weights
- `backend/ai/saved_model/crop_disease_v1/` — Keras SavedModel
- `apps/upaj/assets/models/crop_disease_v1.tflite` — deployed INT8 model, **~3–5 MB**

### Estimated training time

| Hardware               | 15 epochs full run |
| ---------------------- | ------------------ |
| CPU (modern laptop)    | 4–8 hours          |
| NVIDIA RTX 30-series   | 20–40 minutes      |
| Google Colab T4 (free) | 30–50 minutes      |

`--quick` finishes in 1–3 minutes on any hardware.

---

## 5. Placeholder model (for immediate testing)

If you need a valid `.tflite` file *right now* — before training — run:

```powershell
.\backend\venv\Scripts\pip.exe install -r backend\ai\requirements-ml.txt
.\backend\venv\Scripts\python.exe backend\ai\build_placeholder_tflite.py
```

This produces a ~3 MB INT8-quantized MobileNetV2 with random head weights that
matches the exact I/O contract. The app will load it and return an index in
`[0, 38)`, so the SQLite treatments lookup still works. Predictions will be
essentially random — replace with a trained model before shipping.

## 6. Rebuild the SQLite treatments DB

```powershell
.\backend\venv\Scripts\python.exe backend\ai\build_treatments_db.py
```

Produces `apps/upaj/assets/disease_treatments.db` with 38 rows (one per class).
No ML dependencies required — pure stdlib `sqlite3`.

---

## Troubleshooting

- **`kaggle: command not found`** — install the deps into the venv, then use the
  full path: `.\backend\venv\Scripts\kaggle.exe`.
- **`403 Forbidden` from Kaggle** — you probably haven't accepted the dataset
  rules. Open the dataset page in a browser once, click *Download*, then retry.
- **`ValueError: expected 38 classes but found 39`** — a dataset variant added
  `Background_without_leaves`. Delete that folder from `--data_dir` before
  training, or the softmax head will not align with `CLASS_NAMES` in the RN hook.
- **Output shape wrong** — do not change `NUM_CLASSES` without also updating
  `use-disease-detection.ts` and `build_treatments_db.py`.

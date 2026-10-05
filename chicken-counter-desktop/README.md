# Chicken Counter

Local desktop app: counts chickens across sets of 3 photos using a
Roboflow-hosted model, voting per set, and summing across sets for a
grand total.

## ⚠️ Before you do anything else

The Roboflow API key in `model_client.py` was shared in plain text
and should be treated as compromised:

1. Go to your Roboflow account and **rotate/regenerate** the key.
2. Set the new key as an environment variable:
   - Windows (PowerShell): `setx ROBOFLOW_API_KEY "your-new-key"`
   - `model_client.py` already reads `ROBOFLOW_API_KEY` from the
     environment first and only falls back to the old hardcoded key if
     that variable isn't set — once you `setx` the new key and open a
     fresh terminal, it'll be picked up automatically. Delete the
     hardcoded fallback value once you've confirmed this works.

## Setup (development)

```bash
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
python main.py
```

## Expected folder structure for images

```
my_photos/
  pen_1/
    img1.jpg
    img2.jpg
    img3.jpg
  pen_2/
    img1.jpg
    img2.jpg
    img3.jpg
```

Each subfolder = one "set". The app warns (but doesn't block) if a
set doesn't have exactly 3 images.

## Tuning accuracy

`CONFIDENCE_THRESHOLD` in `model_client.py` (default `0.4`) controls
how confident the model must be before a detection counts as a real
chicken. Run a few sets with a known true count and adjust this value
up (fewer false positives) or down (fewer missed birds) to match your
setup — lighting, camera angle, and flock density will all affect the
right threshold.

## Building the .exe

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --collect-all dearpygui --name ChickenCounter main.py
```

`--collect-all dearpygui` is important here — Dear PyGui ships internal
font/resource files that PyInstaller won't find automatically without it,
which otherwise shows up as a blank window or a font-loading crash at
runtime.

The executable will be in `dist/ChickenCounter.exe`. `model_client.py`
and `voting.py` are bundled in automatically since `main.py` imports
them directly — no need to copy them alongside the exe.

**Test on a machine without Python installed** before distributing —
this catches missing-DLL or hidden-import issues PyInstaller sometimes
misses.

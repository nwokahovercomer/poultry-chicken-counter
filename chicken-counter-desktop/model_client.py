"""
model_client.py

Wraps the chicken-counting model API. Everything else in the app calls
count_chickens_in_image(path) and doesn't need to know how it works
internally — so if you swap models or providers later, this is the
only file you touch.

NOTE: this calls Roboflow's serverless REST endpoint directly with
`requests` instead of the `inference-sdk` package. inference-sdk pins
dependencies that don't yet have Python 3.14 wheels; the SDK itself is
just a thin HTTP client (per Roboflow's own docs), so talking to the
REST endpoint directly gets the same result with no version pin
headaches. The key is sent ONLY as an `Authorization: Bearer` header
(matching api_key_transport="header") — not in the query string —
since this workspace's key did not authenticate over the legacy
query-parameter channel.
"""

import base64
import os
import requests

# --- Configuration -----------------------------------------------------
# SECURITY NOTE: any key pasted into chat should be treated as
# compromised once shared. Set it as an environment variable rather
# than hardcoding it, e.g. (PowerShell): setx ROBOFLOW_API_KEY "your-key"
# TEMPORARY: hardcoded fallback below is only here to isolate the auth
# issue from the env-var setup. Once a run succeeds, set
# ROBOFLOW_API_KEY properly and delete the fallback string.
API_KEY = os.environ.get("ROBOFLOW_API_KEY",)
MODEL_ID = "chicken-counting/5"  # dataset_slug/version


API_URL = f"https://serverless.roboflow.com/{MODEL_ID}"

# Minimum confidence for a detection to be counted as a real chicken.
# Roboflow detection models return every candidate box, including low-
# confidence noise, so this threshold matters a lot for accuracy.
# Tune it against a handful of your own images with a known true count.
CONFIDENCE_THRESHOLD = 0.4

REQUEST_TIMEOUT = 30  # seconds


def count_chickens_in_image(image_path: str) -> int:
    """
    Sends one local image to the model via REST and returns the number
    of chickens detected above CONFIDENCE_THRESHOLD.

    Raises RuntimeError (with the server's actual error message) or
    requests.RequestException on network/API failure — the caller
    (main.py) is responsible for catching this per-image so one bad
    call doesn't kill the whole batch.
    """
    with open(image_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("ascii")

    response = requests.post(
        API_URL,
        data=image_b64,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Bearer {API_KEY}",
        },
        timeout=REQUEST_TIMEOUT,
    )

    if not response.ok:
        # Surface the server's actual explanation rather than a bare
        # status code — the response body usually says exactly why
        # (bad key, wrong model scope, expired key, etc).
        raise RuntimeError(
            f"{response.status_code} {response.reason}: {response.text[:300]}"
        )

    result = response.json()
    predictions = result.get("predictions", [])
    return sum(
        1 for p in predictions
        if p.get("confidence", 0) >= CONFIDENCE_THRESHOLD
    )
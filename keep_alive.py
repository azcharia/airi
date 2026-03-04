"""
keep_alive.py - Flask dummy web server for Render.com deployment.

Runs a lightweight HTTP server on a background thread so Render
recognises the process as a "Web Service" and external cron-jobs
can ping / to prevent the free-tier instance from sleeping.
"""

import os
import threading
from flask import Flask

app = Flask(__name__)


@app.route("/")
def home():
    return "Airi is alive!", 200


@app.route("/health")
def health():
    return {"status": "ok"}, 200


def _run():
    port = int(os.getenv("FLASK_PORT", 8080))
    # Use 0.0.0.0 so Render can route traffic to the container
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


def keep_alive():
    """Start the Flask server in a daemon thread."""
    t = threading.Thread(target=_run, daemon=True)
    t.start()

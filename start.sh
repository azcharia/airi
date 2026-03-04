#!/usr/bin/env bash
# start.sh - Entry point for Render.com deployment
pip install --upgrade pip
pip install -r requirements.txt
python main.py

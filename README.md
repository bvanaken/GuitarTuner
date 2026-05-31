# Acoustic Guitar Tuner

A browser-based tuner for acoustic guitar in standard tuning (E A D G B E). Runs entirely client-side — no install, no server, just microphone access.

**Live demo:** https://bvanaken.github.io/GuitarTuner/

## Features

- Real-time pitch detection via the Web Audio API
- Auto-detect mode picks the nearest string, or choose one manually
- Cents meter (±50¢) showing how flat or sharp you are
- Visual headstock indicator

## Usage

1. Open the live demo (or `index.html` locally).
2. Click **Start** and allow microphone access.
3. Play a string — the detected note, frequency, and tuning offset appear.

Works best in a quiet room, with the guitar close to the mic.

## Run locally

Any static server works, e.g.:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

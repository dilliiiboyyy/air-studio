# Air Studio

Air Studio is a browser music studio you play with your hands in front of a webcam. It has five instruments, a recording library, a multitrack studio, a metronome, backing bands, guided lessons and performance reports. Hand tracking, audio and storage all run locally in the browser. No video or audio leaves the device.

## Live site

https://dilliiiboyyy.github.io/air-studio/ is deployed automatically from `main` by `.github/workflows/deploy.yml`.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview   # production build (http://localhost:4173)
```

The camera needs a secure page: `localhost` or `https://`. Use Chrome or Edge for the best performance (GPU delegate). Firefox and Safari 17+ also work, using the CPU delegate and without output-device selection.

If you have no camera, choose **No camera? Simulate** on any instrument. The mouse becomes your right hand, <kbd>Space</kbd> makes a fist, and <kbd>1</kbd>–<kbd>6</kbd> place your left hand. Simulated hands go through the same gesture pipeline as camera hands.

## What's in it

| Area | Implementation |
|---|---|
| Hand tracking | MediaPipe HandLandmarker (2 hands, GPU with CPU fallback), WASM and model served from `/public`. One-Euro smoothing, size-normalised velocity, fist/pinch/open detection, label stickiness, 160 ms drop-out grace. |
| Calibration | Distance and lighting check, both-hands check, stability test, reach capture (maps instruments to your comfortable area), sensitivity with a live speed meter and test taps, and a tap-along latency measurement. |
| Air Piano | Sampled Salamander grand (2 velocity layers), plus electric piano (FM), organ, synth and ambient presets. Key-line or air-tap gesture, scale lock, beginner layout, 1–2 octaves, chord assist, sustain gesture, glide, velocity from speed. |
| Air Drums | 9 pieces. Synthesised acoustic and vintage packs, plus a TR-808 sample pack. Strike detector with re-arm and refractory window, so a resting hand never retriggers. Three layouts, including left-handed. |
| Air Guitar | Sampled acoustic, electric clean, distorted (waveshaper + cab filter) and bass. Fretting-hand height picks the chord (or pinch to advance). Down/up strums play real voicings string by string. A fist palm-mutes. |
| Air Synth | Continuous pitch, filter or volume by height, motion-driven vibrato and filter modulation. Simple mode has two voices; advanced mode uses the left hand as a controller and adds full sound design. |
| Air Percussion | Bongos, congas, tambourine, clap, shaker, cowbell and electronic hits. A shake gesture (closed fist) plays the shaker. |
| Recording | AudioWorklet PCM capture, sample-accurate on the audio clock, with pause/resume. Every note, hit and strum is logged with timing. Takes are saved to IndexedDB. |
| Library | Play, rename, delete, WAV and MIDI export, performance report, and send to a multitrack project. |
| Multitrack | Tracks with volume, pan, mute, solo, offset nudge, delete and overdub (existing tracks play while you record). Automatic latency compensation, quantise + offline re-render, master volume, mixdown WAV and multi-track MIDI. |
| Metronome | Look-ahead scheduler, 2/4, 3/4, 4/4, 5/4 and 6/8, tempo presets, tap tempo, accents, visual beats, count-in. |
| Backing | Eight procedurally generated styles (pop, rock, jazz, blues, electronic, classical, hip-hop, ambient) that follow the transport tempo, loop, and can be included in recordings. |
| Practice | 16 lessons covering piano notes and chords, drum patterns, guitar chord changes and rhythm. Targets highlight on the instrument and scroll on a timeline. Live correct / incorrect / early / late / missed feedback. Beginner and advanced timing windows. Progress tracking. |
| Reports | Every metric is computed from the judged event log. Free recordings get timing metrics only when a metronome or backing grid existed; otherwise they are shown as "not applicable". |

The design rationale, including what was rejected and why, is in [`docs/DESIGN_REVIEW.md`](docs/DESIGN_REVIEW.md) (the three-person review).

## Source layout

```
src/audio        engine (graph, FX, capture worklet), instruments, transport, backing, player, offline render
src/tracking     MediaPipe tracker, One-Euro filter, gesture detectors
src/instruments  per-instrument controllers (gesture → sound + canvas overlay)
src/practice     lessons, real-time judge, scoring
src/lib          settings store, IndexedDB, WAV/MIDI encoders, music theory
src/ui, src/pages  React UI (renders controls only; tracking and drawing run outside React)
```

## Credits

- Salamander Grand Piano V3, Alexander Holm (CC BY 3.0)
- tonejs-instruments guitar and bass samples (MIT)
- TR-808 samples via @fluid-music/tr-808 (ISC)
- Google MediaPipe (Apache 2.0)

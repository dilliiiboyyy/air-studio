# Air Studio — Three-Person Design Review

This review was done before implementation. Each proposal from the Builder and Thinker was put
to the Judge and scored on user value (V), technical feasibility (F), performance impact (P,
higher = lighter), complexity (C, higher = simpler) and overall improvement. Only features that
passed were built.

---

## Person 1 — Builder

**Architecture**

- React 19 + TypeScript + Vite. React renders controls only. The tracking loop, the gesture
  detectors, the instrument canvas and the audio run outside React through refs and plain
  observers, so there are no React re-renders per video frame.
- **Hand tracking:** `@mediapipe/tasks-vision` HandLandmarker in VIDEO mode, `numHands: 2`, GPU
  delegate with an automatic CPU fallback. The WASM runtime and the `.task` model are served from
  the app itself (`/public`), so nothing depends on a third-party CDN and no video leaves the
  machine. Frames are pulled with `requestVideoFrameCallback`, so each camera frame is processed
  once. If that call is not available, `requestAnimationFrame` is used with a dedupe on frame time.
- **Smoothing:** a One-Euro filter on every landmark. It gives low jitter when the hand is still
  and little lag when it moves fast. Strike detection uses a separate, lighter EMA velocity, so
  smoothing never delays a drum hit.
- **Audio:** one `AudioContext({latencyHint:'interactive'})`. Signal path: instrument bus → chorus
  insert → (reverb send, delay send) → master → limiter. Backing tracks and the metronome have
  their own buses.
- **Samples:** Salamander Grand Piano (2 velocity layers), tonejs-instruments acoustic guitar,
  electric guitar and electric bass, and TR-808 one-shots. All are vendored in `/public/samples`
  and loaded lazily per instrument. Acoustic drums and hand percussion are synthesised with
  modelled membranes, noise and metal partials. No free acoustic kit with crash, ride and open
  hat was available under a clear licence, and synthesis lets the timbre follow strike velocity
  continuously.
- **Recording:** an AudioWorklet taps the record bus and captures PCM, sample-accurate against
  `AudioContext.currentTime`. *MediaRecorder was rejected for timing:* its start offset relative
  to the audio clock is unspecified (often 20–80 ms), which breaks multitrack alignment.
  Performance timing (every note, hit and strum) is captured at the same time as structured
  events.
- **Storage:** IndexedDB for recordings and projects (WAV blobs + event lists). localStorage for
  settings and lesson progress (small, synchronous).
- **Exports:** 16-bit WAV (encoded in the app) and Standard MIDI File type 1 (written in the app,
  no dependency). Both are produced from real data.

**Browser compatibility:** Chrome/Edge (full, including GPU delegate and `setSinkId` output
selection). Firefox (CPU delegate, no output-device selection). Safari 17+ (works; the GPU
delegate may fall back to CPU).

**Storage estimate:** stereo 16-bit 48 kHz is about 11.5 MB per minute. That is fine for
IndexedDB quotas, and the library shows each item's size.

## Person 2 — Thinker

1. **Reach calibration:** map instruments to the user's comfortable reach box instead of the
   whole frame, so a user sitting far away doesn't have to stretch.
2. **Latency calibration:** "tap along with the click" measures the real camera → gesture → sound
   delay and compensates recordings and practice judging.
3. **Palm-mute strumming:** a closed fist on the strumming hand plays muted, percussive strums.
4. **Shaker by shaking:** a rapid side-to-side shake of a closed hand plays the shaker in any
   zone.
5. **Glide across piano keys:** sliding a pressed finger sideways re-triggers the new key, like
   a glissando.
6. **Velocity normalised by hand size:** the same physical motion gives the same loudness at any
   distance from the camera.
7. **Procedural backing bands:** genre arrangements (drums, bass, keys or pad) generated live in
   the app, so tempo changes are exact and the tracks loop seamlessly.
8. **Quantise and re-render a track:** snap a take's notes to the grid and re-synthesise the
   audio offline.
9. **Hand-pose chord switching** (finger counting for chords).
10. **Per-finger piano** (each fingertip plays its own key).
11. **AR visuals** (particles, 3D instruments).
12. **Cloud sharing / social feed.**

## Person 3 — Judge

| # | Proposal | V | F | P | C | Verdict |
|---|----------|---|---|---|---|---------|
| 1 | Reach calibration | 5 | 5 | 5 | 4 | **Build.** Cheap linear remap and a big comfort gain. |
| 2 | Latency calibration | 5 | 4 | 5 | 4 | **Build.** Without it, multitrack takes and practice scores are skewed by about 100 ms. |
| 3 | Palm-mute strum | 4 | 5 | 5 | 5 | **Build.** Reuses the fist detector that already exists. |
| 4 | Shake → shaker | 4 | 4 | 5 | 4 | **Build** as a percussion option. Direction-reversal counting is reliable. |
| 5 | Piano glide | 3 | 5 | 5 | 5 | **Build.** A few lines in the key-press state machine. |
| 6 | Size-normalised velocity | 4 | 5 | 5 | 5 | **Build.** |
| 7 | Procedural backing | 5 | 4 | 4 | 3 | **Build.** Licensing for real backing recordings is unavailable, and live generation gives exact tempo control and looping. |
| 8 | Quantise and re-render | 4 | 4 | 4 | 3 | **Build** for note-based tracks (piano, drums, percussion, guitar). Offline render reuses the same instrument code. |
| 9 | Finger-count chords | 2 | 2 | 4 | 3 | **Reject.** Finger counts flicker under motion blur, which is exactly when the player is strumming. Hand height is more reliable. A "pinch to advance" option covers one-hand use. |
| 10 | Per-finger piano | 3 | 1 | 3 | 2 | **Reject.** Webcam fingertip depth is too noisy to tell press from hover per finger. Chord assist gives chords reliably. |
| 11 | AR visuals | 1 | 3 | 1 | 2 | **Reject.** It distracts from playing and costs GPU time that hand tracking needs. |
| 12 | Cloud sharing | 2 | 2 | 5 | 1 | **Reject.** It conflicts with local-only privacy, and the user can export files instead. |

**Further Judge rulings on the brief**

- *MediaRecorder vs PCM capture:* PCM through an AudioWorklet. Timing correctness beats a smaller
  file size.
- *Two velocity layers of piano vs all 16:* two layers. 16 layers would be about 80 MB to
  download for a marginal gain.
- *Mouse simulation:* keep it as an explicit "Simulated hands" mode. It lets people without a
  camera (or with a permission problem) still try every instrument, and it is how the app is
  tested automatically. It is clearly labelled and never replaces the camera silently.
- *Scoring:* every number in a report must come from the event log of that take. Free-play
  reports include grid timing only when a metronome or backing track defined a grid. Otherwise
  those metrics are shown as "not applicable", not invented.
- *Multitrack scope:* tracks, volume, pan, mute, solo, offset nudge, delete, overdub, quantise,
  master and mixdown export. No clip editing, automation or plug-ins.

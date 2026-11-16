import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { InstrumentId } from '../lib/settings';
import { settings, useSettings, INSTRUMENT_LABELS } from '../lib/settings';
import { tracker, type TrackFrame } from '../tracking/tracker';
import { engine } from '../audio/engine';
import { createController } from '../instruments';
import { drawHands, type Controller } from '../instruments/common';
import { useTrackerLive, useTrackerStatus } from './hooks';

let sessionStarted = false;

export type DrawExtra = (g: CanvasRenderingContext2D, w: number, h: number, now: number) => void;

interface Props {
  inst: InstrumentId;
  controllerRef?: MutableRefObject<Controller | null>;
  drawExtra?: MutableRefObject<DrawExtra | null>;
  onFrame?: MutableRefObject<((f: TrackFrame) => void) | null>;
  maxHeight?: string;
  noController?: boolean;
  onReady?: () => void;
}

export function Stage({ inst, controllerRef, drawExtra, onFrame, maxHeight = 'calc(100vh - 230px)', noController, onReady }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ctrl = useRef<Controller | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [progress, setProgress] = useState(0);
  const status = useTrackerStatus();
  const live = useTrackerLive(5);
  const opacity = useSettings((s) => s.tracking.videoOpacity);
  const [readout, setReadout] = useState('');
  const [noHandsSince, setNoHandsSince] = useState(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const loadController = async (id: InstrumentId) => {
    ctrl.current?.dispose();
    ctrl.current = null;
    if (controllerRef) controllerRef.current = null;
    setReadout('');
    if (noController) return;
    const c = createController(id);
    setProgress(0);
    await c.load((f) => setProgress(f));
    ctrl.current = c;
    if (controllerRef) controllerRef.current = c;
    const s = settings.get()[id];
    engine.setInstrumentFx(s.fx);
    engine.instBus.gain.setTargetAtTime(s.volume, engine.now, 0.02);
  };

  const start = async (sim = false) => {
    setPhase('loading');
    try {
      await engine.ensure();
      await loadController(inst);
      if (sim) tracker.startSim();
      else await tracker.start();
      sessionStarted = true;
      setPhase('ready');
      onReadyRef.current?.();
    } catch (e) {
      console.error(e);
      setPhase('idle');
    }
  };

  // auto-start once the user has started the studio in this session
  useEffect(() => {
    if (sessionStarted && engine.ctx && phase === 'idle') start(tracker.simulating);
    return () => { tracker.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // instrument switch
  useEffect(() => {
    if (phase !== 'ready') return;
    let cancelled = false;
    setPhase('loading');
    loadController(inst).then(() => { if (!cancelled) setPhase('ready'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst]);

  useEffect(() => () => { ctrl.current?.dispose(); ctrl.current = null; }, []);

  // keep instrument fx / volume in sync with settings
  useEffect(() => settings.subscribe(() => {
    if (!engine.ctx || !ctrl.current) return;
    const s = settings.get()[inst];
    engine.setInstrumentFx(s.fx);
    engine.instBus.gain.setTargetAtTime(s.volume, engine.now, 0.02);
  }), [inst]);

  // tracking frames -> controller (runs at camera rate, outside React)
  useEffect(() => tracker.onFrame((f) => {
    ctrl.current?.update(f, f.time);
    onFrame?.current?.(f);
  }), [onFrame]);

  // attach the live stream to the visible video
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (tracker.stream && v.srcObject !== tracker.stream) { v.srcObject = tracker.stream; v.play().catch(() => {}); }
    if (!tracker.stream) v.srcObject = null;
  }, [status, phase]);

  // draw loop
  useEffect(() => {
    let id = 0;
    let lastReadout = '\u0000';
    let lastRo = 0;
    const loop = (now: number) => {
      id = requestAnimationFrame(loop);
      const cv = canvasRef.current, wrap = wrapRef.current;
      if (!cv || !wrap) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (phase !== 'ready') return;
      const pnow = performance.now();
      ctrl.current?.draw(g, w, h, pnow);
      drawExtra?.current?.(g, w, h, pnow);
      const f = tracker.frame;
      if (pnow - f.time < 300) drawHands(g, f, w, h, { point: inst === 'piano' || inst === 'synth' ? 'tip' : 'palm' });
      if (now - lastRo > 100) {
        lastRo = now;
        const r = ctrl.current?.readout() ?? '';
        if (r !== lastReadout) { lastReadout = r; setReadout(r); }
      }
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [phase, inst, drawExtra]);

  // hand-presence timer for the "show your hands" hint
  useEffect(() => {
    if (live.left || live.right) setNoHandsSince(0);
    else if (!noHandsSince) setNoHandsSince(performance.now());
  }, [live.left, live.right, noHandsSince]);

  // simulated hands: keyboard
  useEffect(() => {
    if (status !== 'sim') return;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); tracker.simFist(true); }
      const d = parseInt(e.key);
      if (d >= 1 && d <= 8) {
        const r = settings.get().tracking.reach;
        const slots = 6;
        tracker.simLeft(r.y0 + ((Math.min(d, slots) - 0.5) / slots) * (r.y1 - r.y0));
      }
      if (e.key === '0') tracker.simLeft(-1);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') tracker.simFist(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [status]);

  const sim = status === 'sim';
  const camErr = ['denied', 'nocamera', 'inuse', 'error'].includes(status);
  const showNoHands = phase === 'ready' && !sim && status === 'running' && noHandsSince && performance.now() - noHandsSince > 2500;
  const lowLight = phase === 'ready' && status === 'running' && live.brightness < 55;
  const unstable = phase === 'ready' && status === 'running' && (live.left || live.right) && (live.detectRate < 0.6 || live.fps < 14);
  const warn = camErr ? null : lowLight ? 'Lighting is too low for reliable tracking. Face a light source.' : unstable ? 'Tracking is unstable. Improve the lighting or slow down a little.' : showNoHands ? 'No hands detected. Raise your hands into the camera view.' : null;

  return (
    <div ref={wrapRef} className={`stage-wrap ${sim ? 'sim' : ''}`}
      style={{ aspectRatio: `${tracker.aspect}`, maxWidth: `calc((${maxHeight}) * ${tracker.aspect})`, margin: '0 auto' }}
      onPointerMove={(e) => {
        if (!sim) return;
        const r = e.currentTarget.getBoundingClientRect();
        tracker.simPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => sim && tracker.simHide()}>
      <video ref={videoRef} muted playsInline style={{ opacity: sim ? 0 : opacity }} />
      <canvas ref={canvasRef} />
      {phase === 'ready' && (
        <div className="hud">
          <span className="chip"><span className={`dot ${live.left ? 'ok' : ''}`} style={live.left ? { background: 'var(--left)' } : undefined} />L</span>
          <span className="chip"><span className={`dot ${live.right ? 'ok' : ''}`} style={live.right ? { background: 'var(--accent)' } : undefined} />R</span>
          <span className="chip"><b>{Math.round(live.fps)}</b> fps</span>
          {live.delegate && <span className="chip">{live.delegate}</span>}
          {!noController && readout && <span className="readout">{readout}</span>}
        </div>
      )}
      {warn && <div className="hud-warn">{warn}</div>}
      {phase === 'ready' && !sim && status === 'running' && <span className="cam-badge"><span className="dot live" />Camera on · processed locally</span>}
      {phase === 'ready' && sim && <span className="cam-badge">Simulated hands · move the mouse · <kbd>Space</kbd> fist · <kbd>1</kbd>–<kbd>6</kbd> left hand · <kbd>0</kbd> hide</span>}
      {(phase !== 'ready' || camErr || status === 'loading' || status === 'starting') && (
        <div className="stage-empty">
          <div className="col">
            {phase === 'loading' || status === 'loading' || status === 'starting' ? (
              <>
                <span className="label">{status === 'starting' ? 'Requesting camera…' : status === 'loading' ? 'Loading hand-tracking model…' : `Loading ${noController ? 'studio' : INSTRUMENT_LABELS[inst]}…`}</span>
                {progress > 0 && progress < 1 && <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>}
              </>
            ) : camErr ? (
              <>
                <h2>Camera unavailable</h2>
                <p className="muted">{tracker.error}</p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn primary" onClick={() => start(false)}>Try again</button>
                  <button className="btn" onClick={() => start(true)}>Use simulated hands</button>
                </div>
              </>
            ) : (
              <>
                <h2>{noController ? 'Start the camera' : INSTRUMENT_LABELS[inst]}</h2>
                <p className="muted">The camera turns on only while you play. Video is processed on this device and is never uploaded or stored.</p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn primary lg" onClick={() => start(false)}>Start playing</button>
                  <button className="btn lg" onClick={() => start(true)} title="Play with the mouse and keyboard instead of the camera">No camera? Simulate</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

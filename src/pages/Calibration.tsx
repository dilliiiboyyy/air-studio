import { useEffect, useRef, useState } from 'react';
import { settings, useSettings, DEFAULTS } from '../lib/settings';
import { tracker, strikeThreshold, type TrackFrame, type HandLabel } from '../tracking/tracker';
import { StrikeDetector } from '../tracking/gestures';
import { engine } from '../audio/engine';
import { DrumKit } from '../audio/instruments/drums';
import { Stage, type DrawExtra } from '../ui/Stage';
import { Panel, Slider, Toggle } from '../ui/controls';
import { useTrackerLive, useTrackerStatus } from '../ui/hooks';
import { C } from '../instruments/common';
import type { Nav } from '../App';

const STEPS = ['Position yourself', 'Show both hands', 'Test detection', 'Set your reach', 'Adjust sensitivity', 'Test triggering & latency'];

function Alert({ kind, children }: { kind: 'ok' | 'warn' | 'err' | 'info'; children: React.ReactNode }) {
  return <div className={`alert ${kind === 'info' ? '' : kind}`}><span className={`dot ${kind === 'info' ? '' : kind}`} /><div>{children}</div></div>;
}

export function CalibrationPage({ nav }: { nav: Nav }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<boolean[]>(STEPS.map(() => false));
  const live = useTrackerLive(8);
  const status = useTrackerStatus();
  const t = useSettings((s) => s.tracking);
  const onFrame = useRef<((f: TrackFrame) => void) | null>(null);
  const drawExtra = useRef<DrawExtra | null>(null);
  const [ready, setReady] = useState(false);

  // per-step measurement state
  const bothMs = useRef(0);
  const lastT = useRef(0);
  const [bothPct, setBothPct] = useState(0);
  const bothPctRef = useRef(0);
  const stab = useRef<{ start: number; frames: number; hands: number; fps: number[] } | null>(null);
  const [stabRes, setStabRes] = useState<{ rate: number; fps: number; jitter: number } | null>(null);
  const reach = useRef<{ until: number; xs: number[]; ys: number[] } | null>(null);
  const [reachLeft, setReachLeft] = useState(0);
  const reachLeftRef = useRef(0);
  const det = useRef({ Left: new StrikeDetector(), Right: new StrikeDetector() });
  const speed = useRef({ Left: 0, Right: 0 });
  const [hits, setHits] = useState(0);
  const kit = useRef<DrumKit | null>(null);
  const strikes = useRef<number[]>([]);
  const [lat, setLat] = useState<{ state: 'idle' | 'running' | 'done'; result?: number; matched?: number; clickAt?: number[] }>({ state: 'idle' });

  const mark = (i: number) => setDone((d) => d.map((x, k) => (k === i ? true : x)));

  onFrame.current = (f) => {
    const now = f.time;
    const dt = lastT.current ? Math.min(100, now - lastT.current) : 0;
    lastT.current = now;
    if (f.Left && f.Right) {
      bothMs.current += dt;
      const bp = Math.min(1, bothMs.current / 1500);
      if (Math.abs(bp - bothPctRef.current) > 0.05 || bp === 1) { bothPctRef.current = bp; setBothPct(bp); }
      if (bothMs.current > 1500) mark(1);
    }
    if (stab.current) {
      const s = stab.current;
      s.frames++;
      if (f.hands.length) s.hands++;
      s.fps.push(tracker.metrics.fps);
      if (now - s.start > 4000) {
        const res = { rate: s.hands / s.frames, fps: s.fps.reduce((a, b) => a + b, 0) / s.fps.length, jitter: tracker.metrics.jitter };
        setStabRes(res);
        stab.current = null;
        if (res.rate > 0.85 && res.fps >= 20) mark(2);
      }
    }
    if (reach.current) {
      for (const h of f.hands) { reach.current.xs.push(h.palm.x, h.tip.x); reach.current.ys.push(h.palm.y, h.tip.y); }
      const left = reach.current.until - now;
      if (Math.ceil(left / 1000) !== Math.ceil(reachLeftRef.current / 1000) || left <= 0) setReachLeft(Math.max(0, left));
      reachLeftRef.current = left;
      if (left <= 0) {
        const { xs, ys } = reach.current;
        reach.current = null;
        if (xs.length > 30) {
          const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
          const m = 0.04;
          const r = { x0: Math.max(0, q(xs, 0.03) - m), x1: Math.min(1, q(xs, 0.97) + m), y0: Math.max(0, q(ys, 0.03) - m), y1: Math.min(1, q(ys, 0.97) + m) };
          if (r.x1 - r.x0 > 0.3 && r.y1 - r.y0 > 0.3) { settings.update('tracking', { reach: r }); mark(3); }
          else alert('Your reach was too small to calibrate. Move your hands across a wider area and try again.');
        }
      }
    }
    const thr = strikeThreshold();
    for (const h of f.hands) {
      speed.current[h.label] = Math.max(h.vel.y, speed.current[h.label] * 0.92);
      const hit = det.current[h.label].update(h, now, thr);
      if (hit) {
        const v = Math.min(1, 0.4 + (hit.vel - thr) / (thr * 2));
        kit.current?.play('snare', v);
        strikes.current.push(engine.now);
        setHits((n) => n + 1);
        if (step === 4) mark(4);
      }
    }
  };

  drawExtra.current = (g, w, h) => {
    const r = settings.get().tracking.reach;
    g.strokeStyle = reach.current ? C.accent : 'rgba(242,240,234,0.35)';
    g.setLineDash([5, 5]);
    g.lineWidth = 1.5;
    g.strokeRect(r.x0 * w, r.y0 * h, (r.x1 - r.x0) * w, (r.y1 - r.y0) * h);
    g.setLineDash([]);
    g.fillStyle = C.text2;
    g.font = '500 11px Inter, system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('PLAY AREA', r.x0 * w + 6, r.y0 * h + 14);
    if (step === 4 || step === 5) {
      const thr = strikeThreshold();
      (['Left', 'Right'] as HandLabel[]).forEach((l, i) => {
        const x = 16 + i * 40, top = h * 0.25, hh = h * 0.5;
        const v = Math.max(0, speed.current[l]);
        const max = thr * 2.5;
        g.fillStyle = 'rgba(21,21,21,0.7)';
        g.fillRect(x, top, 22, hh);
        g.fillStyle = v > thr ? C.accent : C.text2;
        const vh = Math.min(1, v / max) * hh;
        g.fillRect(x + 4, top + hh - vh, 14, vh);
        g.fillStyle = C.text;
        g.fillRect(x - 2, top + hh - (thr / max) * hh, 26, 2);
        g.fillStyle = C.text2;
        g.textAlign = 'center';
        g.fillText(l[0], x + 11, top + hh + 14);
      });
    }
  };

  useEffect(() => { if (ready && !kit.current && engine.ctx) { kit.current = new DrumKit(engine.ctx, engine.instFx.input, 'acoustic'); engine.setInstrumentFx({ reverb: 0.1, delay: 0, delayTime: 0.3, feedback: 0.2, chorus: 0 }); engine.instBus.gain.value = 0.9; } }, [ready]);

  // step 1 auto-detection
  const sizes = [live.leftHand?.size, live.rightHand?.size].filter(Boolean) as number[];
  const avgSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const distMsg = !sizes.length ? null : avgSize < 0.065 ? 'You are a little far away. Move about 20 cm closer.' : avgSize > 0.2 ? 'You are too close. Lean back so both hands fit comfortably.' : 'Good distance.';
  useEffect(() => { if (avgSize >= 0.065 && avgSize <= 0.2 && live.brightness >= 55) mark(0); }, [avgSize, live.brightness]);

  const runLatency = async () => {
    const ctx = await engine.ensure();
    const bpm = 80, beat = 60 / bpm;
    const t0 = ctx.currentTime + 0.3;
    const clicks: number[] = [];
    for (let i = 0; i < 12; i++) {
      const when = t0 + i * beat;
      const o = ctx.createOscillator();
      o.frequency.value = i < 4 ? 1000 : 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.8, when + 0.001);
      g.gain.setTargetAtTime(0, when + 0.002, 0.02);
      o.connect(g).connect(engine.metroBus);
      o.start(when); o.stop(when + 0.2);
      if (i >= 4) clicks.push(when);
    }
    strikes.current = [];
    setLat({ state: 'running', clickAt: clicks });
    setTimeout(() => {
      const offs: number[] = [];
      for (const c of clicks) {
        const near = strikes.current.filter((s) => Math.abs(s - c) < beat * 0.45).sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0];
        if (near !== undefined) offs.push((near - c) * 1000);
      }
      if (offs.length >= 4) {
        offs.sort((a, b) => a - b);
        const med = offs[Math.floor(offs.length / 2)];
        const v = Math.round(Math.max(0, Math.min(300, med)));
        settings.update('tracking', { latencyMs: v, calibrated: true });
        setLat({ state: 'done', result: v, matched: offs.length });
        mark(5);
      } else setLat({ state: 'done', matched: offs.length });
    }, (t0 - ctx.currentTime + 12 * beat + 0.5) * 1000);
  };

  // global feedback
  const camErr = ['denied', 'nocamera', 'inuse', 'error'].includes(status);
  const alerts: { kind: 'ok' | 'warn' | 'err'; text: string }[] = [];
  if (camErr) alerts.push({ kind: 'err', text: `Camera unavailable: ${tracker.error}` });
  else if (ready && status === 'running') {
    if (live.left && live.right) alerts.push({ kind: 'ok', text: 'Both hands detected.' });
    else if (live.left || live.right) alerts.push({ kind: 'warn', text: `Only your ${live.left ? 'left' : 'right'} hand is detected. Raise the other hand into view.` });
    else alerts.push({ kind: 'warn', text: 'No hands detected. Hold your hands up, palms facing the camera.' });
    if (live.brightness < 55) alerts.push({ kind: 'err', text: `Lighting is insufficient (brightness ${Math.round(live.brightness)}/255). Turn on a light in front of you.` });
    else if (live.brightness < 80) alerts.push({ kind: 'warn', text: 'The lighting is a bit dim. More front light will make tracking steadier.' });
    if ((live.left || live.right) && (live.detectRate < 0.7 || live.fps < 15)) alerts.push({ kind: 'warn', text: `Tracking is unstable (${Math.round(live.detectRate * 100)}% detection, ${Math.round(live.fps)} fps). Improve the lighting, use a plain background, and close other camera apps.` });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Calibration</h1><p>Six short steps tune hand tracking to your camera, room and reach. It takes about a minute, and the results are saved in this browser.</p></div>
        <span className="spacer" />
        <button className="btn" onClick={() => { settings.update('tracking', { reach: DEFAULTS.tracking.reach }); }}>Reset play area</button>
        <button className="btn primary" onClick={() => { settings.update('tracking', { calibrated: true }); nav('instruments', 'piano'); }}>Finish & play</button>
      </div>
      <div className="play-layout" style={{ gridTemplateColumns: '340px minmax(0,1fr)' }}>
        <div className="side-stack">
          <Panel title="Steps" bodyClass="steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`step ${done[i] ? 'done' : ''} ${step === i ? 'cur' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setStep(i)}>
                <span className="n">{done[i] ? '✓' : i + 1}</span>
                <div className="col" style={{ gap: 6, flex: 1 }}>
                  <b style={{ fontWeight: 600 }}>{s}</b>
                  {step === i && stepBody()}
                </div>
              </div>
            ))}
          </Panel>
          <Panel title="Camera & lighting tips">
            <ul className="recs small muted">
              <li>Put the camera at chest or eye height, facing you straight on.</li>
              <li>Sit or stand 60–120 cm from the camera, so your raised hands fill the middle of the frame.</li>
              <li>Light your hands from the front. Avoid bright windows behind you.</li>
              <li>A plain, uncluttered background and sleeves above the wrist help detection.</li>
              <li>Close other apps that use the camera, and plug in your laptop for full performance.</li>
            </ul>
          </Panel>
        </div>
        <div className="col" style={{ gap: 10 }}>
          {alerts.map((a) => <Alert key={a.text} kind={a.kind}>{a.text}</Alert>)}
          <Stage inst="drums" noController onFrame={onFrame} drawExtra={drawExtra} onReady={() => setReady(true)} maxHeight="calc(100vh - 260px)" />
          {ready && <div className="row small muted wrap" style={{ gap: 18 }}>
            <span>Detection <b className="mono" style={{ color: 'var(--text)' }}>{Math.round(live.detectRate * 100)}%</b></span>
            <span>Frame rate <b className="mono" style={{ color: 'var(--text)' }}>{Math.round(live.fps)}</b> fps</span>
            <span>Inference <b className="mono" style={{ color: 'var(--text)' }}>{live.inferMs.toFixed(1)}</b> ms</span>
            <span>Brightness <b className="mono" style={{ color: 'var(--text)' }}>{Math.round(live.brightness)}</b></span>
            <span>Hand size <b className="mono" style={{ color: 'var(--text)' }}>{avgSize ? avgSize.toFixed(3) : '—'}</b></span>
            <span>Latency comp. <b className="mono" style={{ color: 'var(--text)' }}>{t.latencyMs} ms</b></span>
          </div>}
        </div>
      </div>
    </div>
  );

  function stepBody() {
    const next = <button className="btn sm" onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))}>Next</button>;
    if (!ready) return <span className="small muted">Start the camera on the right to begin.</span>;
    switch (step) {
      case 0:
        return (<>
          <span className="small muted">Raise one or both hands to shoulder height, palms toward the camera.</span>
          {distMsg && <span className="small" style={{ color: avgSize >= 0.065 && avgSize <= 0.2 ? 'var(--green)' : 'var(--amber)' }}>{distMsg}</span>}
          <span className="small" style={{ color: live.brightness < 55 ? 'var(--red)' : 'var(--text2)' }}>Lighting: {live.brightness < 55 ? 'insufficient' : live.brightness < 80 ? 'dim' : 'good'}</span>
          {next}
        </>);
      case 1:
        return (<>
          <span className="small muted">Hold both hands up and keep them steady.</span>
          <div className="row small"><span style={{ color: live.left ? 'var(--left)' : 'var(--text3)' }}>● Left {live.left ? 'detected' : 'not detected'}</span><span style={{ color: live.right ? 'var(--accent)' : 'var(--text3)' }}>● Right {live.right ? 'detected' : 'not detected'}</span></div>
          <div className="meter"><i style={{ width: `${bothPct * 100}%`, background: 'var(--green)' }} /></div>
          <Toggle label={<span className="small">Hands are swapped (fix left/right labels)</span>} value={t.swapHands} onChange={(v) => settings.update('tracking', { swapHands: v })} />
          {next}
        </>);
      case 2:
        return (<>
          <span className="small muted">Move your hands slowly around for 4 seconds while detection quality is measured.</span>
          <button className="btn sm" onClick={() => { stab.current = { start: performance.now(), frames: 0, hands: 0, fps: [] }; setStabRes(null); }} disabled={!!stab.current}>{stab.current ? 'Measuring…' : 'Run test'}</button>
          {stabRes && <span className="small" style={{ color: stabRes.rate > 0.85 && stabRes.fps >= 20 ? 'var(--green)' : 'var(--amber)' }}>
            {Math.round(stabRes.rate * 100)}% of frames had hands, {Math.round(stabRes.fps)} fps. {stabRes.rate > 0.85 && stabRes.fps >= 20 ? 'Tracking is stable.' : 'Tracking is unstable. See the tips below.'}
          </span>}
          {next}
        </>);
      case 3:
        return (<>
          <span className="small muted">Press Capture, then sweep both hands to the edges of your comfortable reach (left, right, up, down) for 6 seconds. Instruments will fit inside that area.</span>
          <button className="btn sm" onClick={() => { reach.current = { until: performance.now() + 6000, xs: [], ys: [] }; setReachLeft(6000); }} disabled={reachLeft > 0}>{reachLeft > 0 ? `Capturing… ${Math.ceil(reachLeft / 1000)}s` : 'Capture reach'}</button>
          <span className="tiny faint mono">x {t.reach.x0.toFixed(2)}–{t.reach.x1.toFixed(2)} · y {t.reach.y0.toFixed(2)}–{t.reach.y1.toFixed(2)}</span>
          {next}
        </>);
      case 4:
        return (<>
          <span className="small muted">Tap down in the air as if hitting a drum. Each detected tap plays a snare. The meters on the left show downward speed, and the white line is the trigger threshold.</span>
          <Slider label="Tracking sensitivity" value={t.sensitivity} min={0} max={100} step={1} onChange={(v) => settings.update('tracking', { sensitivity: v })} />
          <Slider label="Smoothing" value={t.smoothing} min={0} max={100} step={1} onChange={(v) => settings.update('tracking', { smoothing: v })} hint="More smoothing = steadier cursor, slightly more lag" />
          <span className="small">Taps detected: <b className="mono">{hits}</b></span>
          <span className="tiny faint">If small movements trigger by accident, lower the sensitivity. If hard taps are missed, raise it.</span>
          {next}
        </>);
      default:
        return (<>
          <span className="small muted">After 4 count-in clicks, tap along with the next 8 higher clicks. This measures your total camera-to-sound delay so recordings and lessons are timed correctly.</span>
          <button className="btn sm primary" onClick={runLatency} disabled={lat.state === 'running'}>{lat.state === 'running' ? 'Listening… tap on the beeps' : 'Start latency test'}</button>
          {lat.state === 'done' && (lat.result !== undefined
            ? <span className="small" style={{ color: 'var(--green)' }}>Measured {lat.result} ms from {lat.matched} taps. Saved.</span>
            : <span className="small" style={{ color: 'var(--amber)' }}>Only {lat.matched} taps matched the clicks. Try again and tap firmly on each beep.</span>)}
          <span className="tiny faint">Current compensation: {t.latencyMs} ms. You can also set it manually in Settings.</span>
        </>);
    }
  }
}

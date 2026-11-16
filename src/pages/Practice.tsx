import { useEffect, useRef, useState } from 'react';
import { settings, INSTRUMENT_LABELS, type Settings } from '../lib/settings';
import { LESSONS, getProgress, recordProgress, type Lesson } from '../practice/lessons';
import { LessonJudge, type Feedback } from '../practice/judge';
import { practiceReport, WINDOWS, type PerformanceReport } from '../practice/scoring';
import { playBus } from '../lib/events';
import { engine } from '../audio/engine';
import { transport } from '../audio/transport';
import { Stage, type DrawExtra } from '../ui/Stage';
import type { Controller } from '../instruments/common';
import { Modal, Panel, Seg } from '../ui/controls';
import { ReportView } from '../ui/ReportView';
import { BeatDots } from '../ui/TransportBar';
import type { Nav } from '../App';
import { PIECE_LABEL } from '../audio/instruments/drums';
import { noteName } from '../lib/music';

type Patch = Lesson['patch'];

function applyPatch(patch: Patch): Patch {
  if (!patch) return undefined;
  const prev: Record<string, Record<string, unknown>> = {};
  const cur = settings.get() as unknown as Record<string, Record<string, unknown>>;
  for (const [sec, vals] of Object.entries(patch)) {
    prev[sec] = {};
    for (const k of Object.keys(vals as object)) prev[sec][k] = cur[sec][k];
    settings.update(sec as keyof Settings, vals as never);
  }
  return prev as Patch;
}

const fallbackLabel = (k: string) => (PIECE_LABEL[k] ?? (/^\d+$/.test(k) ? noteName(Number(k)) : k));

export function PracticePage({ nav, initial }: { nav: Nav; initial?: string }) {
  const [lesson, setLesson] = useState<Lesson>(() => LESSONS.find((l) => l.id === initial) ?? LESSONS[0]);
  const [level, setLevel] = useState<'beginner' | 'advanced'>('beginner');
  const [running, setRunning] = useState(false);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [progress, setProgress] = useState(getProgress);
  const [counts, setCounts] = useState({ ok: 0, total: 0 });
  const ctrl = useRef<Controller | null>(null);
  const judge = useRef<LessonJudge | null>(null);
  const drawExtra = useRef<DrawExtra | null>(null);
  const laneRef = useRef<HTMLCanvasElement>(null);
  const prevPatch = useRef<Patch>(undefined);
  const startInfo = useRef({ t: 0, bpm: 0, prevBpm: 0, prevSig: '4/4' as Settings['metronome']['sig'] });

  // apply lesson settings while it is selected; restore afterwards
  useEffect(() => {
    prevPatch.current = applyPatch(lesson.patch);
    return () => { applyPatch(prevPatch.current); };
  }, [lesson]);

  const labelOf = (k: string) => (k === '*' ? 'Any pad' : ctrl.current?.label(k) ?? fallbackLabel(k));

  const stop = (finished: boolean) => {
    const j = judge.current;
    judge.current = null;
    transport.stop();
    ctrl.current?.setTargets([]);
    setRunning(false);
    setFb(null);
    settings.update('metronome', { bpm: startInfo.current.prevBpm, sig: startInfo.current.prevSig });
    if (finished && j) {
      j.tick(Infinity);
      const r = practiceReport({
        lessonId: lesson.id, title: lesson.title, level, judged: j.targets, extras: j.extras, wrongPairs: j.wrongPairs,
        duration: engine.now - startInfo.current.t, events: j.events, labelOf, bpm: startInfo.current.bpm, sensitivity: settings.get().tracking.sensitivity,
      });
      recordProgress(lesson.id, r.overall ?? 0, level);
      setProgress(getProgress());
      setReport(r);
    }
  };

  const start = async () => {
    await engine.ensure();
    const bpm = Math.round(lesson.bpm * WINDOWS[level].tempo);
    const m = settings.get().metronome;
    startInfo.current = { t: engine.now, bpm, prevBpm: m.bpm, prevSig: m.sig };
    settings.update('metronome', { bpm, sig: lesson.sig });
    const zero = await transport.start(1, true);
    judge.current = new LessonJudge(lesson, level, zero, 60 / bpm, settings.get().tracking.latencyMs / 1000, labelOf);
    setFb(null);
    setCounts({ ok: 0, total: lesson.targets.length });
    setRunning(true);
  };

  // judge played events
  useEffect(() => playBus.play((e) => {
    const j = judge.current;
    if (!j || e.inst !== lesson.inst) return;
    const f = j.onEvent(e);
    setFb(f);
    setCounts({ ok: j.targets.filter((t) => t.verdict && t.verdict !== 'miss').length, total: j.targets.length });
  }), [lesson]);

  // timing loop: misses, highlights, lane drawing, end of lesson
  useEffect(() => {
    let id = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const j = judge.current;
      const now = engine.now;
      if (j) {
        const missed = j.tick(now);
        if (missed.length) setFb({ verdict: 'miss', text: `Missed · ${labelOf(missed[missed.length - 1].key)}`, at: performance.now() });
        const next = j.next();
        ctrl.current?.setTargets(lesson.anyKey ? [] : next.filter((t) => t.time - now < 60 / startInfo.current.bpm * 2).map((t) => t.key));
        if (now > j.endTime + 0.4) stop(true);
      }
      drawLane(laneRef.current, j, now, lesson, labelOf);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, level]);

  useEffect(() => () => { if (judge.current) { judge.current = null; transport.stop(); settings.update('metronome', { bpm: startInfo.current.prevBpm || settings.get().metronome.bpm }); } }, []);

  // count-in banner on the stage
  drawExtra.current = (g, w) => {
    if (!running || !transport.running) return;
    const p = transport.position(engine.now);
    if (p.countIn) {
      g.fillStyle = 'rgba(21,21,21,0.75)';
      g.fillRect(w / 2 - 90, 60, 180, 64);
      g.fillStyle = '#C9A24A';
      g.font = '600 34px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(String(p.beatInBar + 1), w / 2, 106);
    }
  };

  const groups = [...new Set(LESSONS.map((l) => l.category))];
  const completed = Object.values(progress).filter((p) => p.completed).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Practice</h1>
          <p>Guided lessons show you what to play and when. Every hit is checked against the target note and the beat as you play.</p>
        </div>
        <span className="spacer" />
        <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
          <span className="label">Progress</span>
          <span className="mono">{completed} / {LESSONS.length} lessons completed</span>
        </div>
      </div>
      <div className="play-layout" style={{ gridTemplateColumns: '300px minmax(0,1fr)' }}>
        <Panel title="Lessons" bodyClass="" className="lesson-panel">
          {groups.map((g) => (
            <div key={g}>
              <div className="label" style={{ padding: '12px 14px 6px' }}>{g}</div>
              {LESSONS.filter((l) => l.category === g).map((l) => {
                const p = progress[l.id];
                return (
                  <div key={l.id} className={`lesson-item ${l.id === lesson.id ? 'active' : ''}`} onClick={() => { if (!running) { setLesson(l); setReport(null); setFb(null); } }}>
                    <div className="grow">
                      <div style={{ fontWeight: 550 }}>{l.title}</div>
                      <div className="tiny muted">{INSTRUMENT_LABELS[l.inst]} · {l.level} · {l.bpm} BPM</div>
                    </div>
                    {p?.completed && <span className="tag ok">Done</span>}
                    <span className="score-ring muted">{p ? p.best : '—'}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </Panel>
        <div className="col" style={{ gap: 12 }}>
          <div className="panel transport" style={{ gap: 14 }}>
            <div className="col" style={{ gap: 2 }}>
              <h2>{lesson.title}</h2>
              <span className="small muted">{lesson.desc}</span>
            </div>
            <span className="spacer" />
            <Seg value={level} onChange={(v) => !running && setLevel(v)} options={[{ value: 'beginner', label: 'Beginner' }, { value: 'advanced', label: 'Advanced' }]} label="Difficulty" />
            <BeatDots />
            {!running
              ? <button className="btn primary lg" onClick={start}>Start lesson</button>
              : <button className="btn lg" onClick={() => stop(false)}>Stop</button>}
          </div>
          <div className="lane"><canvas ref={laneRef} /></div>
          <div className="row" style={{ minHeight: 34 }}>
            {fb ? <span className={`feedback fb-${fb.verdict}`}>{fb.text}</span> : <span className="muted">{running ? 'Get ready. Count-in…' : 'Press Start lesson. A one-bar count-in plays first, then the targets scroll toward the NOW line.'}</span>}
            {fb?.offsetMs !== undefined && <span className="mono muted">{fb.offsetMs > 0 ? '+' : ''}{fb.offsetMs} ms</span>}
            <span className="spacer" />
            {running && <span className="mono muted">{counts.ok} / {counts.total}</span>}
          </div>
          <Stage inst={lesson.inst} controllerRef={ctrl} drawExtra={drawExtra} maxHeight="calc(100vh - 400px)" />
          <div className="small muted">Tip: {lesson.tip} Timing windows: ±{WINDOWS[level].perfect} ms counts as on time, ±{WINDOWS[level].max} ms is accepted. {level === 'advanced' && `Tempo +${Math.round((WINDOWS.advanced.tempo - 1) * 100)}%.`}</div>
        </div>
      </div>
      {report && (
        <Modal title="Performance report" onClose={() => setReport(null)}>
          <ReportView r={report} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={() => nav('instruments', lesson.inst)}>Free play</button>
            <button className="btn primary" onClick={() => { setReport(null); start(); }}>Try again</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function drawLane(cv: HTMLCanvasElement | null, j: LessonJudge | null, now: number, lesson: Lesson, labelOf: (k: string) => string) {
  if (!cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const nowX = w * 0.18;
  const pps = 170; // px per second
  const lat = settings.get().tracking.latencyMs / 1000;
  const t0 = now - lat;
  // beat grid
  if (transport.running) {
    const bd = transport.beatDur;
    const zero = transport.stepTime(0);
    const firstBeat = Math.floor((t0 - nowX / pps - zero) / bd);
    for (let b = firstBeat; ; b++) {
      const x = nowX + (zero + b * bd - t0) * pps;
      if (x > w) break;
      const bar = b % transport.sig.beatsPerBar === 0;
      g.fillStyle = bar ? '#474747' : '#2c2c2c';
      g.fillRect(x, 0, 1, h);
    }
  }
  g.fillStyle = '#D68A48';
  g.fillRect(nowX - 1, 0, 2, h);
  g.font = '600 10px Inter, system-ui, sans-serif';
  g.fillStyle = '#A5A5A5';
  g.textAlign = 'left';
  g.fillText('NOW', nowX + 5, 12);
  const targets = j ? j.targets : lesson.targets.map((t) => ({ beat: t.beat, time: Infinity, key: t.key, verdict: null }));
  if (!j) {
    g.fillStyle = '#6f6f6f';
    g.font = '500 12px Inter, system-ui, sans-serif';
    g.fillText(`${lesson.targets.length} targets · ${lesson.bpm} BPM · ${lesson.sig}`, nowX + 14, h / 2 + 4);
    return;
  }
  const keys = [...new Set(targets.map((t) => t.key))];
  const rowH = Math.min(26, (h - 20) / Math.max(1, keys.length));
  for (const t of targets) {
    const x = nowX + (t.time - t0) * pps;
    if (x < -40 || x > w + 40) continue;
    const row = keys.indexOf(t.key);
    const y = 18 + row * rowH + (h - 20 - rowH * keys.length) / 2;
    const col = t.verdict === 'perfect' ? '#86A86B' : t.verdict === 'early' || t.verdict === 'late' ? '#C9A24A' : t.verdict === 'miss' ? '#C2554B' : '#F2F0EA';
    g.fillStyle = t.verdict ? col : 'rgba(242,240,234,0.12)';
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(x - 3, y, Math.max(36, g.measureText(labelOf(t.key)).width + 14), rowH - 4, 3);
    g.fill();
    g.stroke();
    g.fillStyle = t.verdict ? '#151515' : '#F2F0EA';
    g.font = '600 11px Inter, system-ui, sans-serif';
    g.fillText(labelOf(t.key), x + 4, y + rowH / 2 + 2);
  }
}

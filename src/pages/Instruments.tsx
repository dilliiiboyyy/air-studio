import { useEffect, useMemo, useState } from 'react';
import { settings, INSTRUMENT_LABELS, type InstrumentId } from '../lib/settings';
import { INSTRUMENTS } from '../instruments';
import { Stage } from '../ui/Stage';
import { TransportBar, type TakeMeta } from '../ui/TransportBar';
import { InstrumentPanel } from '../ui/InstrumentPanel';
import { Modal, Panel } from '../ui/controls';
import { ReportView } from '../ui/ReportView';
import { db, type Recording } from '../lib/db';
import type { TakeResult } from '../audio/recorder';
import { freeReport } from '../practice/scoring';
import { uid } from '../lib/music';
import type { Nav } from '../App';

export async function saveTake(inst: InstrumentId, res: TakeResult, meta: TakeMeta): Promise<Recording> {
  const all = await db.listRecordings();
  const n = all.filter((r) => r.instrument === inst).length + 1;
  const name = `${INSTRUMENT_LABELS[inst].replace('Air ', '')} take ${n}`;
  const lat = settings.get().tracking.latencyMs;
  const report = freeReport({ title: name, events: res.events, duration: res.duration, bpm: meta.bpm, gridDefined: meta.gridDefined, latencyMs: lat });
  const s = settings.get()[inst] as { preset?: string; pack?: string; layout?: string };
  const rec: Recording = {
    id: uid(), name, instrument: inst, preset: s.preset ?? s.pack ?? s.layout ?? '', createdAt: Date.now(), duration: res.duration,
    sampleRate: res.sampleRate, wav: res.wav, events: res.events, bpm: meta.bpm, sig: meta.sig, gridDefined: meta.gridDefined, backing: meta.backing, report,
  };
  await db.putRecording(rec);
  return rec;
}

export function TakeSavedModal({ rec, onClose, nav }: { rec: Recording; onClose: () => void; nav: Nav }) {
  const [name, setName] = useState(rec.name);
  const url = useMemo(() => URL.createObjectURL(rec.wav), [rec]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const commit = async () => { if (name.trim() && name !== rec.name) await db.putRecording({ ...rec, name: name.trim() }); };
  return (
    <Modal title="Take saved" onClose={() => { commit(); onClose(); }}>
      <div className="col" style={{ gap: 16 }}>
        <div className="row">
          <label className="field grow"><span className="label">Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} /></label>
          <audio controls src={url} style={{ height: 36, marginTop: 18 }} />
        </div>
        {rec.report && <ReportView r={rec.report} />}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => { commit(); nav('library'); }}>Open library</button>
          <button className="btn" onClick={() => { commit(); nav('studio', `add:${rec.id}`); }}>Add to multitrack project</button>
          <button className="btn primary" onClick={() => { commit(); onClose(); }}>Keep playing</button>
        </div>
      </div>
    </Modal>
  );
}

export function InstrumentsPage({ inst, nav }: { inst: InstrumentId; nav: Nav }) {
  const [saved, setSaved] = useState<Recording | null>(null);
  const info = INSTRUMENTS.find((i) => i.id === inst)!;
  return (
    <div className="page">
      <div className="inst-tabs" role="tablist">
        {INSTRUMENTS.map((i) => (
          <button key={i.id} role="tab" aria-selected={i.id === inst} className={i.id === inst ? 'on' : ''} onClick={() => nav('instruments', i.id)}>{i.name}</button>
        ))}
        <span className="spacer" />
        <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => nav('calibrate')}>Calibrate</button>
      </div>
      <TransportBar recordable onTake={async (res, meta) => setSaved(await saveTake(inst, res, meta))} />
      <div className="play-layout">
        <div className="col" style={{ gap: 12 }}>
          <Stage inst={inst} />
          <div className="row small muted wrap" style={{ gap: 18 }}>
            {info.how.map((h, i) => <span key={i}><span className="mono faint">{i + 1}</span>&nbsp; {h}</span>)}
          </div>
        </div>
        <div className="side-stack">
          <InstrumentPanel inst={inst} />
          <Panel title="Exit">
            <div className="row">
              <button className="btn grow" onClick={() => nav('home')}>Stop & exit</button>
              <button className="btn grow" onClick={() => nav('practice')}>Practice lessons</button>
            </div>
          </Panel>
        </div>
      </div>
      {saved && <TakeSavedModal rec={saved} onClose={() => setSaved(null)} nav={nav} />}
    </div>
  );
}

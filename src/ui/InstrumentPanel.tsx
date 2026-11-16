import { settings, useSettings, type InstrumentId, type Settings, DEFAULTS } from '../lib/settings';
import { KEYS, SCALES, PROGRESSIONS, CHORD_SHAPES } from '../lib/music';
import { PIANO_PRESETS } from '../audio/instruments/piano';
import { DRUM_PACKS } from '../audio/instruments/drums';
import { GUITAR_PRESETS } from '../audio/instruments/guitar';
import { SYNTH_PRESETS, WAVES } from '../audio/instruments/synth';
import { DRUM_LAYOUTS } from '../instruments/drums';
import { PERC_LAYOUTS } from '../instruments/percussion';
import { Knob, Select, Seg, Slider, Toggle, Panel } from './controls';

const scaleOpts = Object.entries(SCALES).map(([value, s]) => ({ value, label: s.label }));
const pct = (v: number) => `${Math.round(v * 100)}`;

function FxSection({ inst }: { inst: InstrumentId }) {
  const s = useSettings((st) => st[inst]);
  const fx = s.fx;
  const setFx = (p: Partial<typeof fx>) => settings.update(inst, { fx: { ...fx, ...p } } as Partial<Settings[typeof inst]>);
  return (
    <div className="ctrl-section">
      <span className="label">Mix & effects</span>
      <div className="knob-row">
        <Knob label="Volume" value={s.volume} onChange={(v) => settings.update(inst, { volume: v } as Partial<Settings[typeof inst]>)} fmt={pct} def={DEFAULTS[inst].volume} />
        <Knob label="Reverb" value={fx.reverb} onChange={(v) => setFx({ reverb: v })} fmt={pct} def={DEFAULTS[inst].fx.reverb} />
        <Knob label="Chorus" value={fx.chorus} onChange={(v) => setFx({ chorus: v })} fmt={pct} def={0} />
        <Knob label="Delay" value={fx.delay} onChange={(v) => setFx({ delay: v })} fmt={pct} def={0} />
      </div>
      <div className="knob-row" style={{ justifyContent: 'flex-start', gap: 14 }}>
        <Knob label="Time" value={fx.delayTime} min={0.05} max={1} onChange={(v) => setFx({ delayTime: v })} fmt={(v) => `${Math.round(v * 1000)}ms`} def={0.33} />
        <Knob label="Feedback" value={fx.feedback} max={0.85} onChange={(v) => setFx({ feedback: v })} fmt={pct} def={0.3} />
      </div>
    </div>
  );
}

function PianoControls() {
  const s = useSettings((st) => st.piano);
  const u = (p: Partial<Settings['piano']>) => settings.update('piano', p);
  return (
    <>
      <div className="ctrl-section">
        <Select label="Sound" value={s.preset} onChange={(v) => u({ preset: v })} options={PIANO_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
        <Seg label="Layout" value={s.level} onChange={(v) => u({ level: v })} options={[{ value: 'beginner', label: 'Beginner · 8 keys' }, { value: 'advanced', label: 'Advanced' }]} />
        <div className="row">
          <div className="grow"><Select label="Key" value={s.key} onChange={(v) => u({ key: v })} options={KEYS} /></div>
          <div className="grow"><Select label="Octave" value={s.octave} onChange={(v) => u({ octave: v })} options={[2, 3, 4, 5, 6].map((o) => ({ value: o, label: `C${o}` }))} /></div>
        </div>
        <Select label={s.level === 'beginner' ? 'Scale' : 'Scale lock'} value={s.scale} onChange={(v) => u({ scale: v })} options={s.level === 'beginner' ? scaleOpts.filter((o) => o.value !== 'chromatic') : scaleOpts} />
        {s.level === 'advanced' && <Seg label="Range" value={s.octaves} onChange={(v) => u({ octaves: v })} options={[{ value: 1, label: '1 octave' }, { value: 2, label: '2 octaves' }]} />}
      </div>
      <div className="ctrl-section">
        <Seg label="Play gesture" value={s.activation} onChange={(v) => u({ activation: v })} options={[{ value: 'line', label: 'Key line' }, { value: 'tap', label: 'Air tap' }]} />
        {s.activation === 'line' && <Slider label="Key line height" value={s.lineY} min={0.3} max={0.85} onChange={(v) => u({ lineY: v })} fmt={pct} />}
        <Slider label="Note sensitivity" value={s.noteSens} min={0} max={100} step={1} onChange={(v) => u({ noteSens: v })} hint="Higher = smaller dip needed to press" />
        <Slider label="Velocity response" value={s.velocitySens} min={0} max={100} step={1} onChange={(v) => u({ velocitySens: v })} hint="0 = fixed loudness, 100 = fully speed-sensitive" />
        <Seg label="Chord assist" value={s.chordAssist} onChange={(v) => u({ chordAssist: v })} options={[{ value: 'off', label: 'Off' }, { value: 'triad', label: 'Triads' }, { value: 'power', label: 'Power' }]} />
        <Select label="Sustain gesture" value={s.sustain} onChange={(v) => u({ sustain: v })} options={[
          { value: 'off', label: 'Off' }, { value: 'leftFist', label: 'Left hand fist holds sustain' }, { value: 'rightFist', label: 'Right hand fist holds sustain' }, { value: 'pinch', label: 'Pinch (either hand)' },
        ]} />
        <Toggle label="Glide between keys while pressed" value={s.glide} onChange={(v) => u({ glide: v })} />
      </div>
    </>
  );
}

function DrumControls() {
  const s = useSettings((st) => st.drums);
  const u = (p: Partial<Settings['drums']>) => settings.update('drums', p);
  return (
    <div className="ctrl-section">
      <Select label="Sound pack" value={s.pack} onChange={(v) => u({ pack: v })} options={DRUM_PACKS.map((p) => ({ value: p.id, label: p.label }))} />
      <Select label="Kit layout" value={s.layout} onChange={(v) => u({ layout: v })} options={Object.entries(DRUM_LAYOUTS).map(([value, l]) => ({ value: value as Settings['drums']['layout'], label: l.label }))} />
      <Slider label="Hit sensitivity (offset)" value={s.sensOffset} min={-30} max={30} step={1} onChange={(v) => u({ sensOffset: v })} fmt={(v) => (v > 0 ? `+${v}` : `${v}`)} hint="Added to the global tracking sensitivity" />
      <Slider label="Velocity response" value={s.velocitySens} min={0} max={100} step={1} onChange={(v) => u({ velocitySens: v })} />
    </div>
  );
}

function GuitarControls() {
  const s = useSettings((st) => st.guitar);
  const u = (p: Partial<Settings['guitar']>) => settings.update('guitar', p);
  const chordOpts = Object.keys(CHORD_SHAPES).map((c) => ({ value: c, label: c }));
  return (
    <div className="ctrl-section">
      <Select label="Sound" value={s.preset} onChange={(v) => u({ preset: v })} options={GUITAR_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
      <Select label="Chord progression" value={s.progression} onChange={(v) => u({ progression: v })} options={[...Object.entries(PROGRESSIONS).map(([value, p]) => ({ value, label: p.label })), { value: 'custom', label: 'Custom…' }]} />
      {s.progression === 'custom' && (
        <div className="col" style={{ gap: 6 }}>
          <span className="label">Custom chords (top to bottom)</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {s.custom.map((c, i) => (
              <Select key={i} value={c} onChange={(v) => { const n = [...s.custom]; n[i] = v; u({ custom: n }); }} options={chordOpts} style={{ width: 74 }} />
            ))}
            <button className="btn sm" disabled={s.custom.length >= 6} onClick={() => u({ custom: [...s.custom, 'G'] })}>+</button>
            <button className="btn sm" disabled={s.custom.length <= 2} onClick={() => u({ custom: s.custom.slice(0, -1) })}>−</button>
          </div>
        </div>
      )}
      <Seg label="Change chords by" value={s.chordSelect} onChange={(v) => u({ chordSelect: v })} options={[{ value: 'height', label: 'Hand height' }, { value: 'pinch', label: 'Pinch → next' }]} />
      <Slider label="Strum sensitivity" value={s.strumSens} min={0} max={100} step={1} onChange={(v) => u({ strumSens: v })} />
      <Toggle label="Left-handed (strum with left hand)" value={s.lefty} onChange={(v) => u({ lefty: v })} />
    </div>
  );
}

function SynthControls() {
  const s = useSettings((st) => st.synth);
  const u = (p: Partial<Settings['synth']>) => settings.update('synth', p);
  return (
    <>
      <div className="ctrl-section">
        <Seg label="Mode" value={s.level} onChange={(v) => u({ level: v })} options={[{ value: 'simple', label: 'Simple · two voices' }, { value: 'advanced', label: 'Advanced' }]} />
        <Select label="Preset" value={s.preset} onChange={(v) => { const p = SYNTH_PRESETS.find((x) => x.id === v); u({ preset: v, ...(p?.params ?? {}) }); }} options={SYNTH_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
        <div className="row">
          <div className="grow"><Select label="Key" value={s.key} onChange={(v) => u({ key: v })} options={KEYS} /></div>
          <div className="grow"><Select label="Octave" value={s.octave} onChange={(v) => u({ octave: v })} options={[1, 2, 3, 4, 5].map((o) => ({ value: o, label: `${o}` }))} /></div>
        </div>
        <Select label="Scale" value={s.scale} onChange={(v) => u({ scale: v })} options={scaleOpts} />
        <Toggle label="Snap pitch to scale" value={s.quantize} onChange={(v) => u({ quantize: v })} />
        <Seg label="Hand height controls" value={s.yAxis} onChange={(v) => u({ yAxis: v })} options={[{ value: 'filter', label: 'Filter' }, { value: 'volume', label: 'Volume' }]} />
      </div>
      {s.level === 'advanced' && (
        <div className="ctrl-section">
          <span className="label">Sound design · left hand: height = volume, sideways = modulation</span>
          <Seg value={s.wave} onChange={(v) => u({ wave: v })} options={WAVES.map((w) => ({ value: w.id, label: w.label }))} />
          <div className="knob-row">
            <Knob label="Cutoff" value={s.cutoff} onChange={(v) => u({ cutoff: v })} fmt={pct} />
            <Knob label="Reso" value={s.resonance} min={0.3} max={20} onChange={(v) => u({ resonance: v })} fmt={(v) => v.toFixed(1)} />
            <Knob label="Attack" value={s.attack} min={0.002} max={1.5} onChange={(v) => u({ attack: v })} fmt={(v) => `${Math.round(v * 1000)}`} />
            <Knob label="Release" value={s.release} min={0.02} max={3} onChange={(v) => u({ release: v })} fmt={(v) => v.toFixed(2)} />
          </div>
          <div className="knob-row">
            <Knob label="Glide" value={s.glide} max={0.5} onChange={(v) => u({ glide: v })} fmt={(v) => `${Math.round(v * 1000)}`} />
            <Knob label="Detune" value={s.detune} max={30} onChange={(v) => u({ detune: v })} fmt={(v) => `${Math.round(v)}c`} />
            <Knob label="Sub" value={s.sub} onChange={(v) => u({ sub: v })} fmt={pct} />
            <Knob label="Range" value={s.range} min={1} max={4} onChange={(v) => u({ range: Math.round(v) })} fmt={(v) => `${Math.round(v)} oct`} />
          </div>
          <div className="knob-row">
            <Knob label="Vibrato" value={s.vibrato} onChange={(v) => u({ vibrato: v })} fmt={pct} />
            <Knob label="LFO rate" value={s.lfoRate} min={0.1} max={12} onChange={(v) => u({ lfoRate: v })} fmt={(v) => `${v.toFixed(1)}Hz`} />
            <Knob label="Motion" value={s.motionMod} onChange={(v) => u({ motionMod: v })} fmt={pct} />
          </div>
        </div>
      )}
    </>
  );
}

function PercControls() {
  const s = useSettings((st) => st.percussion);
  const u = (p: Partial<Settings['percussion']>) => settings.update('percussion', p);
  return (
    <div className="ctrl-section">
      <Select label="Instrument set" value={s.layout} onChange={(v) => u({ layout: v })} options={Object.entries(PERC_LAYOUTS).map(([value, l]) => ({ value: value as Settings['percussion']['layout'], label: l.label }))} />
      <Toggle label="Shake a closed fist for shaker" value={s.shake} onChange={(v) => u({ shake: v })} />
      <Slider label="Hit sensitivity (offset)" value={s.sensOffset} min={-30} max={30} step={1} onChange={(v) => u({ sensOffset: v })} fmt={(v) => (v > 0 ? `+${v}` : `${v}`)} />
    </div>
  );
}

export function InstrumentPanel({ inst }: { inst: InstrumentId }) {
  return (
    <Panel title="Instrument" right={<button className="btn ghost sm" onClick={() => settings.reset(inst)} title="Restore default settings">Reset</button>}>
      <div className="col" style={{ gap: 0 }}>
        {inst === 'piano' && <PianoControls />}
        {inst === 'drums' && <DrumControls />}
        {inst === 'guitar' && <GuitarControls />}
        {inst === 'synth' && <SynthControls />}
        {inst === 'percussion' && <PercControls />}
        <FxSection inst={inst} />
      </div>
    </Panel>
  );
}

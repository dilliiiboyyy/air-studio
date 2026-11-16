import { useRef, type ReactNode, type CSSProperties } from 'react';

export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, fmt, hint }: {
  label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string; hint?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="field" title={hint}>
      <div className="row"><span className="label">{label}</span><span className="val">{fmt ? fmt(value) : value.toFixed(step < 1 ? 2 : 0)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))} aria-label={label} />
    </label>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange, style }: {
  label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; style?: CSSProperties;
}) {
  const sel = (
    <select value={String(value)} style={style} aria-label={label}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}>
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
  if (!label) return sel;
  return <label className="field"><span className="label">{label}</span>{sel}</label>;
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  const seg = (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
  if (!label) return seg;
  return <div className="field"><span className="label">{label}</span>{seg}</div>;
}

export function Toggle({ label, value, onChange, hint }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <span className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} tabIndex={0} title={hint}
      onClick={() => onChange(!value)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!value); } }}>
      <span className="sw" />{label}
    </span>
  );
}

/** Rotary knob: drag vertically, scroll, or use arrow keys. Double-click resets. */
export function Knob({ label, value, min = 0, max = 1, onChange, fmt, def }: {
  label: string; value: number; min?: number; max?: number; onChange: (v: number) => void; fmt?: (v: number) => string; def?: number;
}) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const norm = (value - min) / (max - min);
  const a0 = -135, a1 = 135;
  const ang = a0 + norm * (a1 - a0);
  const arc = (from: number, to: number, r: number) => {
    const p = (a: number) => [22 + r * Math.sin((a * Math.PI) / 180), 22 - r * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(from), [x1, y1] = p(to);
    return `M${x0} ${y0} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const set = (n: number) => onChange(min + Math.max(0, Math.min(1, n)) * (max - min));
  return (
    <div className="knob">
      <svg viewBox="0 0 44 44" role="slider" aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, v: norm }; }}
        onPointerMove={(e) => { if (drag.current) set(drag.current.v + (drag.current.y - e.clientY) / 160); }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => def !== undefined && onChange(def)}
        onWheel={(e) => set(norm - Math.sign(e.deltaY) * 0.03)}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(norm + 0.04); if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(norm - 0.04); }}>
        <path d={arc(a0, a1, 18)} stroke="#393939" strokeWidth="3" fill="none" strokeLinecap="round" />
        {norm > 0.005 && <path d={arc(a0, ang, 18)} stroke="#D68A48" strokeWidth="3" fill="none" strokeLinecap="round" />}
        <circle cx="22" cy="22" r="13" fill="#202020" stroke="#474747" />
        <line x1="22" y1="22" x2={22 + 10 * Math.sin((ang * Math.PI) / 180)} y2={22 - 10 * Math.cos((ang * Math.PI) / 180)} stroke="#F2F0EA" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="kv">{fmt ? fmt(value) : Math.round(norm * 100)}</span>
      <span className="kl">{label}</span>
    </div>
  );
}

export function Panel({ title, right, children, className, bodyClass }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className ?? ''}`}>
      {title !== undefined && <div className="panel-h"><span className="label">{title}</span><span className="spacer" />{right}</div>}
      <div className={bodyClass ?? 'panel-b'}>{children}</div>
    </section>
  );
}

export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="panel-h"><h3>{title}</h3><span className="spacer" /><button className="btn ghost sm" onClick={onClose} aria-label="Close">Close</button></div>
        <div className="panel-b">{children}</div>
      </div>
    </div>
  );
}

const P = (d: string) => <path d={d} />;
export const Icon = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{P('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z')}</svg>,
  inst: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="1" />{P('M8 5v9M12 5v9M16 5v9')}<path d="M7 5h2v6H7zM15 5h2v6h-2z" fill="currentColor" /></svg>,
  practice: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></svg>,
  studio: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{P('M4 6h16M4 12h16M4 18h16')}<rect x="7" y="4" width="3" height="4" fill="currentColor" /><rect x="14" y="10" width="3" height="4" fill="currentColor" /><rect x="9" y="16" width="3" height="4" fill="currentColor" /></svg>,
  library: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{P('M4 4v16M8 4v16M12 4l5 16M16 5l4 15')}</svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3" />{P('M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1')}</svg>,
  calib: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{P('M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4')}<circle cx="12" cy="12" r="3" /></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" /></svg>,
  download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{P('M12 4v11M7 10l5 5 5-5M5 20h14')}</svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')}</svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{P('M12 5v14M5 12h14')}</svg>,
  metro: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{P('M8 3h8l3 18H5zM12 17l5-11M7 17h10')}</svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{P('M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3')}</svg>,
  cam: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="6" width="13" height="12" rx="1" />{P('M16 10l5-3v10l-5-3')}</svg>,
};

export const InstrumentGlyph = ({ id }: { id: string }) => {
  const s = { stroke: 'currentColor', strokeWidth: 1.4, fill: 'none' };
  switch (id) {
    case 'piano':
      return <svg className="glyph" viewBox="0 0 160 64">{[...Array(10)].map((_, i) => <rect key={i} x={6 + i * 15} y={8} width={14} height={48} {...s} />)}{[0, 1, 3, 4, 5, 7, 8].map((i) => <rect key={i} x={16 + i * 15} y={8} width={8} height={28} fill="currentColor" />)}</svg>;
    case 'drums':
      return <svg className="glyph" viewBox="0 0 160 64"><ellipse cx="80" cy="44" rx="22" ry="14" {...s} /><ellipse cx="44" cy="30" rx="15" ry="6" {...s} /><ellipse cx="116" cy="30" rx="15" ry="6" {...s} /><line x1="20" y1="14" x2="52" y2="18" {...s} /><line x1="108" y1="12" x2="144" y2="16" {...s} /><ellipse cx="80" cy="30" rx="11" ry="4" {...s} /></svg>;
    case 'guitar':
      return <svg className="glyph" viewBox="0 0 160 64"><path d="M18 32c0-14 14-18 26-12 8 4 14 2 20-2 10-6 22 0 22 14s-12 20-22 14c-6-4-12-6-20-2-12 6-26 2-26-12z" {...s} /><circle cx="50" cy="32" r="6" {...s} /><line x1="86" y1="29" x2="150" y2="29" {...s} /><line x1="86" y1="35" x2="150" y2="35" {...s} />{[100, 112, 124, 136].map((x) => <line key={x} x1={x} y1="27" x2={x} y2="37" {...s} />)}</svg>;
    case 'synth':
      return <svg className="glyph" viewBox="0 0 160 64"><path d="M8 32 Q 24 4 40 32 T 72 32 T 104 32" {...s} /><path d="M104 32 l8 -16 l0 32 l8 -32 l0 32 l8 -32 l0 32 l8 -16 l14 0" {...s} /></svg>;
    default:
      return <svg className="glyph" viewBox="0 0 160 64"><ellipse cx="42" cy="22" rx="16" ry="6" {...s} /><path d="M26 22v24c0 4 32 4 32 0V22" {...s} /><ellipse cx="80" cy="26" rx="13" ry="5" {...s} /><path d="M67 26v22c0 3 26 3 26 0V26" {...s} /><circle cx="124" cy="32" r="14" {...s} />{[0, 60, 120, 180, 240, 300].map((a) => <circle key={a} cx={124 + 14 * Math.cos((a * Math.PI) / 180)} cy={32 + 14 * Math.sin((a * Math.PI) / 180)} r="2.5" fill="currentColor" />)}</svg>;
  }
};

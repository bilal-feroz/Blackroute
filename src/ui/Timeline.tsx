import { Pause, Play } from 'lucide-react';
import { useMemo } from 'react';
import { CUSTOMERS, DCS, SKU_IDS, dcDailyDemand } from '../core/network';
import type { SimRun } from '../core/types';

const SPEEDS = [1, 3, 8];

export function Timeline({
  run,
  hour,
  setHour,
  playing,
  setPlaying,
  speed,
  setSpeed,
  label,
}: {
  run: SimRun;
  hour: number;
  setHour: (h: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
  label: string;
}) {
  const H = run.horizonHours;
  const d = run.options.disruption;
  const factor = run.options.durationFactor ?? 1;
  const hasLevers = (run.options.levers ?? []).length > 0;
  const hi = Math.min(H - 1, Math.max(0, Math.floor(hour)));

  const stats = useMemo(() => {
    let waiting = 0;
    for (const c of CUSTOMERS) waiting += run.backlogSeries[c.id]?.[hi] ?? 0;
    let cover = Infinity;
    for (const dc of DCS) for (const s of SKU_IDS) cover = Math.min(cover, (run.skuSeries[dc.id]?.[s]?.[hi] ?? 0) / Math.max(1, dcDailyDemand(dc.id, s)));
    const ships = run.vessels.filter((v) => v.port === 'jebel_ali' && hi >= v.eta && (v.berthHour === null || hi < v.berthHour)).length;
    const trucks = run.trips.filter((t) => hi >= t.depart && hi < t.arrive).length;
    return { waiting, cover, ships, trucks };
  }, [run, hi]);

  const day = Math.floor(hour / 24) + 1;
  const clock = `${String(Math.floor(hour % 24)).padStart(2, '0')}:00`;

  return (
    <footer className="timeline">
      <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      <div className="clock">
        <b>Day {day}</b>
        <span>{clock}</span>
      </div>
      <div className="track-wrap">
        <div className="track-label">{label}</div>
        <div className="track">
          {d && (
            <span
              className="track-incident"
              style={{ left: `${(d.startHour / H) * 100}%`, width: `${(Math.min(H - d.startHour, d.durationHours * factor) / H) * 100}%` }}
              title="Disruption"
            />
          )}
          {d && hasLevers && (
            <span className="track-recovery" style={{ left: `${((run.options.actHour ?? d.startHour) / H) * 100}%`, right: 0 }} title="Recovery plan active" />
          )}
          {Array.from({ length: 21 }, (_, i) => (
            <span key={i} className="tick" style={{ left: `${((i * 24) / H) * 100}%` }}>
              {i % 3 === 0 ? i + 1 : ''}
            </span>
          ))}
          <input
            type="range"
            min={0}
            max={H - 1}
            step={0.25}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            aria-label="Time"
          />
        </div>
      </div>
      <div className="live-stats">
        <span title="Ships waiting at Jebel Ali anchorage">
          <b className={stats.ships > 1 ? 'warn' : ''}>{stats.ships}</b> ships waiting
        </span>
        <span title="Trucks on the road right now">
          <b>{stats.trucks}</b> trucks moving
        </span>
        <span title="Pallets customers ordered that have not arrived yet">
          <b className={stats.waiting > 120 ? 'bad' : stats.waiting > 40 ? 'warn' : ''}>{Math.round(stats.waiting)}</b> pallets owed
        </span>
      </div>
    </footer>
  );
}

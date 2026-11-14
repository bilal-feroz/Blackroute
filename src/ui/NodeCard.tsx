import { X } from 'lucide-react';
import { CHOKEPOINT_BY_ID, CUSTOMERS, CUSTOMER_BY_ID, DC_BY_ID, SKUS, dcDailyDemand } from '../core/network';
import type { SimRun } from '../core/types';
import { Bar } from './bits';

/** Details for whatever the user clicked on the map, at the current playback hour. */
export function NodeCard({ id, run, hour, onClose }: { id: string; run: SimRun; hour: number; onClose: () => void }) {
  const h = Math.min(run.horizonHours - 1, Math.max(0, Math.floor(hour)));
  let title = id;
  let kind = '';
  let body: React.ReactNode = null;

  if (DC_BY_ID[id]) {
    const dc = DC_BY_ID[id];
    title = dc.name;
    kind = 'Distribution centre';
    const served = CUSTOMERS.filter((c) => c.dc === id).map((c) => c.name);
    body = (
      <>
        {SKUS.map((s) => {
          const stock = run.skuSeries[id]?.[s.id]?.[h] ?? 0;
          const d = stock / Math.max(1, dcDailyDemand(id, s.id));
          return (
            <div key={s.id} className="nc-row">
              <span>{s.name}</span>
              <Bar value={d / 4} tone={d < 0.3 ? 'red' : d < 1 ? 'amber' : 'teal'} />
              <em>
                {Math.round(stock)} pal · {d.toFixed(1)}d
              </em>
            </div>
          );
        })}
        <p className="nc-note">Serves {served.join(', ')}.</p>
      </>
    );
  } else if (CUSTOMER_BY_ID[id]) {
    const c = CUSTOMER_BY_ID[id];
    title = c.name;
    kind = c.priority ? 'Key account' : 'Customer group';
    const open = run.backlogSeries[id]?.[h] ?? 0;
    const daily = c.demand.ELEC + c.demand.AUTO + c.demand.FMCG;
    body = (
      <>
        <div className="nc-row">
          <span>Orders a day</span>
          <em>{daily} pallets</em>
        </div>
        <div className="nc-row">
          <span>Waiting now</span>
          <em className={open > daily * 0.35 ? 'warn' : ''}>{Math.round(open)} pallets</em>
        </div>
        <p className="nc-note">Supplied from {DC_BY_ID[c.dc].name}.</p>
      </>
    );
  } else if (id === 'jebel_ali') {
    title = 'Jebel Ali Port';
    kind = 'Main import port';
    const waiting = run.vessels.filter((v) => v.port === 'jebel_ali' && h >= v.eta && (v.berthHour === null || h < v.berthHour));
    const next = run.vessels.filter((v) => v.port === 'jebel_ali' && v.eta > h).sort((a, b) => a.eta - b.eta)[0];
    body = (
      <>
        <div className="nc-row">
          <span>Ships waiting</span>
          <em>{waiting.length}</em>
        </div>
        <div className="nc-row">
          <span>Next arrival</span>
          <em>{next ? `${next.name}, in ${Math.round(next.eta - h)} h` : 'none in 3 weeks'}</em>
        </div>
        <div className="nc-row">
          <span>Cargo in the yard</span>
          <em>{Math.round(run.stockSeries.jebel_ali?.[h] ?? 0)} pallets</em>
        </div>
      </>
    );
  } else if (CHOKEPOINT_BY_ID[id]) {
    const c = CHOKEPOINT_BY_ID[id];
    title = c.name;
    kind = 'Shipping chokepoint';
    body = <p className="nc-note">{c.blurb}</p>;
  } else return null;

  return (
    <div className="node-card">
      <div className="nc-head">
        <div>
          <span>{kind}</span>
          <b>{title}</b>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {body}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend" aria-label="Map legend">
      <span>
        <i className="lg-flow" /> normal flow
      </span>
      <span>
        <i className="lg-risk" /> at risk
      </span>
      <span>
        <i className="lg-down" /> disrupted
      </span>
      <span>
        <i className="lg-rec" /> recovery
      </span>
      <span>
        <i className="lg-black" /> black route
      </span>
      <span className="legend-hint">Hover a building for details · click to open</span>
    </div>
  );
}

import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  FlaskConical,
  Mail,
  MessageCircle,
  Phone,
  Play,
  Radar,
  RefreshCw,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { SCENARIOS, SCENARIO_BY_ID } from '../core/scenarios';
import { OBJECTIVES, type Candidate } from '../core/planner';
import { LEVER_BY_ID } from '../core/network';
import { aed, ago, dayTime, days, pct, tonnes } from '../core/format';
import { leverNames } from '../agents/tools';
import { AgentHeader, Bar, Button, Card, Metric } from './bits';
import { STAGES, type Mission, type Stage, type useMission } from './useMission';
import { actionPackJson, actionPackMarkdown, download } from './actionPack';

type Actions = ReturnType<typeof useMission>;

export function MissionPanel({ a, onReplay, compare, setCompare }: { a: Actions; onReplay: () => void; compare: 'plan' | 'nothing'; setCompare: (c: 'plan' | 'nothing') => void }) {
  const { m } = a;
  const reached: Record<Stage, boolean> = {
    watch: true,
    investigate: !!m.tracer,
    plan: !!m.strategist,
    decide: !!m.redteam,
    recover: !!m.dispatcher,
  };
  const idx = STAGES.findIndex((s) => s.id === m.stage);
  return (
    <aside className="panel">
      <nav className="stepper" aria-label="Mission stages">
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            className={`step ${s.id === m.stage ? 'on' : ''} ${i < idx || reached[s.id] ? 'done' : ''}`}
            disabled={!reached[s.id] || !!m.busy}
            onClick={() => a.goto(s.id)}
          >
            <span className="step-dot">{i < idx ? <Check size={11} /> : i + 1}</span>
            <span className="step-label">{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="panel-body scroll">
        {m.stage === 'watch' && <Watch a={a} />}
        {m.stage === 'investigate' && <Investigate a={a} />}
        {m.stage === 'plan' && <PlanStage a={a} />}
        {m.stage === 'decide' && <Decide a={a} />}
        {m.stage === 'recover' && <Recover a={a} onReplay={onReplay} compare={compare} setCompare={setCompare} />}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- Watch
function Watch({ a }: { a: Actions }) {
  const { m } = a;
  const [replayId, setReplayId] = useState('hormuz_closure');
  const [drill, setDrill] = useState(false);
  const top = m.radar.slice(0, 5);
  const s = m.sentinel;
  const sc = s ? SCENARIO_BY_ID[s.out.scenarioId] : null;
  const titleOf = (id: string) => m.feed?.signals.find((x) => x.id === id);
  return (
    <>
      <div className="stage-intro">
        <h2>Watch the network</h2>
        <p>BlackRoute breaks every link on purpose in the simulator, then watches live signals for anything that could break it for real.</p>
      </div>

      {s && (
        <Card tone={sc ? 'alert' : 'good'}>
          <AgentHeader agent="sentinel" report={s} />
          <h3 className="card-title">{s.out.headline}</h3>
          <p className="muted">{s.out.summary}</p>
          {sc && (
            <div className="metric-row">
              <Metric label="Likelihood" value={pct(s.out.likelihood, 0)} tone={s.out.likelihood > 0.5 ? 'bad' : 'warn'} />
              <Metric label="Confidence" value={pct(s.out.confidence, 0)} />
              <Metric label="Lasts" value={`${sc.defaultDays} days`} sub="planning case" />
            </div>
          )}
          {s.out.evidence.length > 0 && (
            <ul className="evidence">
              {s.out.evidence.map((e) => {
                const sig = titleOf(e.signalId);
                return (
                  <li key={e.signalId}>
                    <span className="ev-id">{e.signalId}</span>
                    <span>
                      {sig ? sig.title : e.why}
                      {sig && <em> · {sig.source}</em>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {sc && (
            <div className="actions">
              <Button onClick={() => a.investigate(sc)} disabled={!!m.busy} icon={<ChevronRight size={15} />}>
                Investigate the impact
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="card-head">
          <Radar size={16} className="ico-violet" />
          <b>Black Route Radar</b>
          <span className="hint">risk = likelihood × impact</span>
        </div>
        <ol className="radar-list">
          {top.map((r, i) => (
            <li key={r.scenario.id}>
              <span className="rank">{i + 1}</span>
              <div className="radar-main">
                <div className="radar-top">
                  <b>{r.link}</b>
                  {r.boosted && <span className="tag tag-red">signal</span>}
                </div>
                <span className="muted small">{r.scenario.title}</span>
                <Bar value={r.riskScore / 100} tone={i < 3 ? 'violet' : 'teal'} />
                <span className="radar-nums">
                  {pct(r.likelihood, 0)} likely · {aed(r.impactAed)} if it happens
                </span>
              </div>
              <button className="mini" onClick={() => a.investigate(r.scenario, undefined, true)} disabled={!!m.busy} title="Run a drill on this link">
                <FlaskConical size={13} /> Drill
              </button>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <div className="card-head">
          <b>Signals</b>
          <div className="seg seg-small">
            <button className={m.feedMode === 'live' ? 'on' : ''} onClick={() => a.loadFeed('live')}>
              Live
            </button>
            <button className={m.feedMode === 'replay' ? 'on' : ''} onClick={() => a.loadFeed('replay', replayId)}>
              Replay
            </button>
          </div>
        </div>
        {m.feedMode === 'replay' && (
          <select className="select" value={replayId} onChange={(e) => (setReplayId(e.target.value), a.loadFeed('replay', e.target.value))}>
            {SCENARIOS.map((x) => (
              <option key={x.id} value={x.id}>
                Replay: {x.title}
              </option>
            ))}
          </select>
        )}
        {m.feed?.weather && (
          <div className={`weather ${m.feed.weather.hazard ? 'warn' : ''}`}>
            Dubai next 3 days: gusts {m.feed.weather.maxGustKmh} km/h · visibility {(m.feed.weather.minVisibilityM / 1000).toFixed(1)} km · dust {m.feed.weather.maxDust} µg/m³
          </div>
        )}
        {m.feedError && <p className="muted small">{m.feedError}</p>}
        <ul className="signals scroll">
          {(m.feed?.signals ?? []).slice(0, 12).map((sig) => (
            <li key={sig.id}>
              <span className="ev-id">{sig.id}</span>
              <div>
                <span className="sig-title">{sig.title}</span>
                <span className="sig-meta">
                  {sig.source} · {ago(sig.publishedAt)}
                  {sig.url && (
                    <a href={sig.url} target="_blank" rel="noreferrer noopener" aria-label="Open source">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </span>
              </div>
            </li>
          ))}
          {!m.feed && <li className="muted small">Loading signals…</li>}
        </ul>
        <div className="actions">
          <Button onClick={a.runSentinel} disabled={!m.feed || !!m.busy} icon={<Radar size={15} />}>
            {m.busy?.startsWith('Sentinel') ? 'Sentinel is reading…' : 'Scan with Sentinel'}
          </Button>
          <Button kind="ghost" onClick={() => setDrill(!drill)} icon={<FlaskConical size={15} />}>
            Run a drill
          </Button>
        </div>
        {drill && (
          <div className="drill-grid">
            {SCENARIOS.map((x) => (
              <button key={x.id} className="drill" onClick={() => a.investigate(x, undefined, true)} disabled={!!m.busy}>
                <b>{x.title}</b>
                <span>{x.summary}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Investigate
function Investigate({ a }: { a: Actions }) {
  const { m } = a;
  const sc = m.scenario!;
  const t = m.tracer;
  const run = m.doNothing;
  const [len, setLen] = useState(Math.round((m.disruption?.durationHours ?? sc.defaultDays * 24) / 24));
  return (
    <>
      <div className="stage-intro">
        <span className="kicker kicker-red">Incident</span>
        <h2>{sc.title}</h2>
        <p>{sc.summary}</p>
        <div className="length">
          <span>How long?</span>
          <input type="range" min={1} max={21} value={len} onChange={(e) => setLen(Number(e.target.value))} />
          <b>{len} days</b>
          <button className="mini" onClick={() => a.investigate(sc, len)} disabled={!!m.busy}>
            <RefreshCw size={12} /> Re-run
          </button>
        </div>
      </div>
      <Card>
        <AgentHeader agent="tracer" report={t} busy={!t} />
        {!t && <p className="muted">Simulating three weeks of ships, trucks and stock…</p>}
        {t && run && (
          <>
            <h3 className="card-title">{t.out.headline}</h3>
            <p className="muted">{t.out.summary}</p>
            <div className="metric-grid">
              <Metric label="Orders on time" value={pct(run.metrics.serviceLevel)} tone={run.metrics.serviceLevel < 0.95 ? 'bad' : 'warn'} sub="if we do nothing" />
              <Metric label="Pallets late" value={Math.round(run.metrics.latePallets)} tone="warn" />
              <Metric label="Extra cost" value={aed(run.metrics.costAed - m.baseRun.metrics.costAed)} tone="bad" sub="incl. penalties" />
              <Metric label="Back to normal" value={days(run.metrics.recoveryHours)} />
            </div>
            <div className="first-short">
              <span>First shortage</span>
              <b>{t.out.firstShortage}</b>
            </div>
            {t.out.affected.length > 0 && (
              <ul className="affected">
                {t.out.affected.map((x, i) => (
                  <li key={i}>
                    <b>{x.place}</b>
                    <span>{x.impact}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
      <div className="actions sticky">
        <Button kind="ghost" onClick={a.reset} icon={<ArrowLeft size={15} />}>
          Back
        </Button>
        <Button onClick={a.findPlans} disabled={!t || !!m.busy} icon={<ChevronRight size={15} />}>
          Find recovery plans
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Plan
function FutureDots({ c }: { c: Candidate }) {
  return (
    <span className="dots" title={`Held in ${c.summary.held} of ${c.summary.futures} futures`}>
      {Array.from({ length: c.summary.futures }, (_, i) => (
        <i key={i} className={i < c.summary.held ? 'ok' : 'bad'} />
      ))}
    </span>
  );
}

function PlanStage({ a }: { a: Actions }) {
  const { m } = a;
  const p = m.plan;
  const s = m.strategist;
  if (!p || !s) {
    const pr = m.progress;
    return (
      <>
        <div className="stage-intro">
          <h2>Testing recovery plans</h2>
          <p>Every combination of recovery levers is played out across 20 random futures with slower ships, demand swings and a disruption that runs short or long.</p>
        </div>
        <Card>
          <AgentHeader agent="strategist" busy />
          <div className="progress">
            <Bar value={pr ? pr.done / Math.max(1, pr.total) : 0.05} tone="green" />
            <span className="muted small">
              {pr ? `${pr.done} of ${pr.total} plans · ${pr.label}` : 'Starting…'}
            </span>
          </div>
        </Card>
      </>
    );
  }
  const w = m.waiting ?? [];
  const maxW = Math.max(...w.map((x) => x.metrics.costAed), 1);
  return (
    <>
      <div className="stage-intro">
        <h2>Recovery plans</h2>
        <p>
          {p.runs} simulations, {p.recommended.summary.futures} futures per plan. Pick one to send to the Red Team.
        </p>
      </div>
      <Card tone="good">
        <AgentHeader agent="strategist" report={s} />
        <h3 className="card-title">{s.out.headline}</h3>
        <p className="muted">{s.out.recommendation}</p>
        <ul className="bullets">
          {s.out.why.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </Card>

      <div className="options">
        {p.options.map(({ candidate: c, goals }) => {
          const on = m.chosen === c || (m.chosen && m.chosen.levers.join() === c.levers.join());
          return (
            <button key={c.levers.join('+') || 'none'} className={`option ${on ? 'on' : ''}`} onClick={() => a.choose(c)}>
              <div className="option-goals">
                {goals.map((g) => (
                  <span key={g} className={`tag ${g === 'balanced' ? 'tag-green' : ''}`}>
                    {OBJECTIVES.find((o) => o.id === g)!.label}
                  </span>
                ))}
                {c === p.recommended && <span className="tag tag-lime">Recommended</span>}
              </div>
              <b className="option-name">{leverNames(c.levers)}</b>
              <div className="option-levers">
                {c.levers.map((l) => (
                  <span key={l} title={LEVER_BY_ID[l].description}>
                    {LEVER_BY_ID[l].short}
                  </span>
                ))}
              </div>
              <div className="option-nums">
                <span>
                  <b>{pct(c.summary.service)}</b> on time
                </span>
                <span>
                  <b>{aed(c.summary.totalCost)}</b> all-in
                </span>
                <span>
                  <b>{tonnes(c.summary.co2)}</b>
                </span>
              </div>
              <FutureDots c={c} />
            </button>
          );
        })}
        <div className="option ghost">
          <b className="option-name">Do nothing</b>
          <div className="option-nums">
            <span>
              <b>{pct(p.doNothing.summary.service)}</b> on time
            </span>
            <span>
              <b>{aed(p.doNothing.summary.totalCost)}</b> all-in
            </span>
          </div>
          <FutureDots c={p.doNothing} />
        </div>
      </div>

      {w.length > 0 && (
        <Card>
          <div className="card-head">
            <b>Cost of waiting</b>
            <span className="hint">same plan, started later</span>
          </div>
          <div className="waiting">
            {w.map((x, i) => (
              <div key={i} className="wait-col">
                <div className="wait-bar">
                  <span style={{ height: `${(x.metrics.costAed / maxW) * 100}%` }} className={i === 0 ? 'now' : i === 1 ? 'mid' : 'late'} />
                </div>
                <b>{aed(x.metrics.costAed)}</b>
                <span>{x.delayHours === 0 ? 'Act now' : `In ${Math.round(x.delayHours / 24)} day${x.delayHours > 24 ? 's' : ''}`}</span>
                <span className="muted small">{pct(x.metrics.serviceLevel)} on time</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="card-head">
          <b>Trade-offs</b>
        </div>
        <ul className="bullets">
          {s.out.tradeoffs.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        <p className="muted small">Why not the runner-up: {s.out.whyNotRunnerUp}</p>
      </Card>

      <div className="actions sticky">
        <Button kind="ghost" onClick={() => a.goto('investigate')} icon={<ArrowLeft size={15} />}>
          Back
        </Button>
        <Button onClick={a.stressTest} disabled={!m.chosen || !!m.busy} icon={<ShieldAlert size={15} />}>
          Stress-test with Red Team
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Decide
function Decide({ a }: { a: Actions }) {
  const { m } = a;
  const r = m.redteam;
  const st = m.stress;
  const c = m.chosen!;
  const [by, setBy] = useState('Operations manager');
  const [note, setNote] = useState('');
  return (
    <>
      <div className="stage-intro">
        <h2>Your decision</h2>
        <p>The AI recommends and the simulator checks. Nothing happens until you approve.</p>
      </div>
      <Card tone={r?.out.verdict === 'fragile' ? 'alert' : r ? 'warn' : undefined}>
        <AgentHeader agent="redteam" report={r} busy={!r} />
        {!r && <p className="muted">Trying to break the plan…</p>}
        {r && st && (
          <>
            <h3 className="card-title">
              <span className={`verdict v-${r.out.verdict.replace(' ', '-')}`}>{r.out.verdict}</span> {st.survived} of {st.tests.length} stress tests passed
            </h3>
            <p className="muted">{r.out.summary}</p>
            <ul className="tests">
              {st.tests.map((t) => (
                <li key={t.id} className={t.held ? 'pass' : 'fail'}>
                  {t.held ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  <div>
                    <b>{t.title}</b>
                    <span>{t.what}</span>
                  </div>
                  <em>{pct(t.metrics.serviceLevel)}</em>
                </li>
              ))}
            </ul>
            {r.out.concerns.length > 0 && (
              <ul className="concerns">
                {r.out.concerns.map((x, i) => (
                  <li key={i} className={`sev-${x.severity}`}>
                    <b>{x.title}</b>
                    <span>{x.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.out.safeguards.length > 0 && (
              <>
                <div className="sub-head">Suggested safeguards</div>
                <ul className="bullets">
                  {r.out.safeguards.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Card>

      <Card className="decision">
        <div className="card-head">
          <b>Plan to approve</b>
        </div>
        <h3 className="card-title">{leverNames(c.levers)}</h3>
        <div className="metric-row">
          <Metric label="On time" value={pct(c.summary.service)} tone="good" />
          <Metric label="All-in cost" value={aed(c.summary.totalCost)} />
          <Metric label="Futures held" value={`${c.summary.held}/${c.summary.futures}`} />
        </div>
        <label className="field">
          <span>Approved by</span>
          <input value={by} onChange={(e) => setBy(e.target.value)} maxLength={60} />
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} rows={2} placeholder="e.g. Keep air freight under AED 200k" />
        </label>
        <div className="actions">
          <Button kind="danger" onClick={() => a.decide('rejected', by, note)} disabled={!r || !!m.busy} icon={<ThumbsDown size={15} />}>
            Reject
          </Button>
          <Button kind="ghost" onClick={() => a.goto('plan')} disabled={!!m.busy}>
            Pick another plan
          </Button>
          <Button kind="good" onClick={() => a.decide('approved', by, note)} disabled={!r || !!m.busy} icon={<ThumbsUp size={15} />}>
            {m.busy?.startsWith('Dispatcher') ? 'Drafting…' : 'Approve'}
          </Button>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Recover
function Recover({ a, onReplay, compare, setCompare }: { a: Actions; onReplay: () => void; compare: 'plan' | 'nothing'; setCompare: (c: 'plan' | 'nothing') => void }) {
  const { m } = a;
  const rec = m.recovery!;
  const none = m.doNothing!;
  const d = m.dispatcher;
  const [copied, setCopied] = useState<number | null>(null);
  const copy = (i: number, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  const ChannelIcon = ({ c }: { c: string }) => (c === 'email' ? <Mail size={13} /> : c === 'whatsapp' ? <MessageCircle size={13} /> : <Phone size={13} />);
  return (
    <>
      <div className="stage-intro">
        <span className="kicker kicker-green">Approved by {m.decision?.by}</span>
        <h2>Recovery</h2>
        <p>The twin now replays the disruption with your plan. Switch to "Do nothing" to see the difference.</p>
        <div className="seg seg-small">
          <button className={compare === 'plan' ? 'on' : ''} onClick={() => setCompare('plan')}>
            With the plan
          </button>
          <button className={compare === 'nothing' ? 'on' : ''} onClick={() => setCompare('nothing')}>
            Do nothing
          </button>
        </div>
      </div>
      <Card tone="good">
        <div className="compare">
          <div />
          <span className="muted small">Do nothing</span>
          <span className="small">With the plan</span>
          <span>Orders on time</span>
          <b className="bad">{pct(none.metrics.serviceLevel)}</b>
          <b className="good">{pct(rec.metrics.serviceLevel)}</b>
          <span>Pallets late</span>
          <b className="bad">{Math.round(none.metrics.latePallets)}</b>
          <b className="good">{Math.round(rec.metrics.latePallets)}</b>
          <span>Key accounts late</span>
          <b className="bad">{Math.round(none.metrics.priorityLatePallets)}</b>
          <b className="good">{Math.round(rec.metrics.priorityLatePallets)}</b>
          <span>All-in cost</span>
          <b>{aed(none.metrics.costAed)}</b>
          <b>{aed(rec.metrics.costAed)}</b>
          <span>Back to normal</span>
          <b>{days(none.metrics.recoveryHours)}</b>
          <b>{days(rec.metrics.recoveryHours)}</b>
        </div>
        <div className="actions">
          <Button kind="ghost" onClick={onReplay} icon={<Play size={14} />}>
            Replay from {dayTime(Math.max(0, (m.disruption?.startHour ?? 0) - 4))}
          </Button>
        </div>
      </Card>

      <Card>
        <AgentHeader agent="dispatcher" report={d} busy={!d} />
        {d && (
          <>
            <p className="brief">{d.out.brief}</p>
            <div className="sub-head">Drafts to review and send</div>
            <ul className="messages">
              {d.out.messages.map((msg, i) => (
                <li key={i}>
                  <div className="msg-head">
                    <ChannelIcon c={msg.channel} />
                    <b>{msg.to}</b>
                    <button className="mini" onClick={() => copy(i, `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.body}`)}>
                      {copied === i ? <Check size={12} /> : <Copy size={12} />} {copied === i ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <span className="msg-subject">{msg.subject}</span>
                  <p>{msg.body}</p>
                </li>
              ))}
            </ul>
            <div className="sub-head">Checklist</div>
            <ul className="checklist">
              {d.out.checklist.map((x, i) => (
                <li key={i}>
                  <input type="checkbox" id={`ck${i}`} />
                  <label htmlFor={`ck${i}`}>{x}</label>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <div className="actions sticky">
        <Button kind="ghost" onClick={a.reset} icon={<ArrowLeft size={15} />}>
          Back to watching
        </Button>
        <Button kind="ghost" onClick={() => download(`blackroute-${m.scenario!.id}.json`, JSON.stringify(actionPackJson(m), null, 2), 'application/json')} icon={<FileJson size={15} />}>
          JSON
        </Button>
        <Button onClick={() => download(`blackroute-action-pack-${m.scenario!.id}.md`, actionPackMarkdown(m), 'text/markdown')} disabled={!d} icon={<Download size={15} />}>
          Download pack
        </Button>
      </div>
    </>
  );
}

export type { Mission };

// Builds the downloadable action pack: what happened, what was decided, by whom,
// on what evidence, and the drafts to send. Markdown for people, JSON for systems.

import { aed, days, pct } from '../core/format';
import { leverNames } from '../agents/tools';
import type { AgentReport } from '../agents/run';
import type { Mission } from './useMission';

function source(r: AgentReport | null): string {
  if (!r) return 'not run';
  const by = r.source === 'ai' ? `AI (${r.model ?? 'model'})` : 'rule-based report';
  return `${by}, ${r.grounding.ok ? 'all numbers grounded' : `${r.grounding.unsupported.length} number(s) not verified`}`;
}

export function actionPackMarkdown(m: Mission): string {
  const s = m.scenario!;
  const c = m.chosen!;
  const none = m.doNothing!.metrics;
  const rec = m.recovery!.metrics;
  const d = m.dispatcher?.out;
  const when = new Date(m.decision?.at ?? Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const lines = [
    `# BlackRoute action pack: ${s.title}`,
    '',
    `Approved by **${m.decision?.by ?? 'unknown'}** on ${when}.${m.decision?.note ? ` Note: ${m.decision.note}` : ''}`,
    '',
    '## Plan',
    `- Levers: ${leverNames(c.levers) || 'monitor only'}`,
    `- Held up in ${c.summary.held} of ${c.summary.futures} simulated futures`,
    '',
    '## Do nothing vs the plan (3 weeks)',
    '| | Do nothing | With the plan |',
    '|---|---|---|',
    `| Orders on time | ${pct(none.serviceLevel)} | ${pct(rec.serviceLevel)} |`,
    `| Pallets late | ${Math.round(none.latePallets)} | ${Math.round(rec.latePallets)} |`,
    `| Key accounts late | ${Math.round(none.priorityLatePallets)} | ${Math.round(rec.priorityLatePallets)} |`,
    `| All-in cost | ${aed(none.costAed)} | ${aed(rec.costAed)} |`,
    `| Back to normal | ${days(none.recoveryHours)} | ${days(rec.recoveryHours)} |`,
    '',
  ];
  if (d) {
    lines.push('## Brief', d.brief, '', '## Drafts to review and send');
    for (const msg of d.messages) lines.push('', `### ${msg.channel.toUpperCase()} to ${msg.to}`, `**${msg.subject}**`, '', msg.body);
    lines.push('', '## Checklist', ...d.checklist.map((x) => `- [ ] ${x}`), '');
  }
  lines.push(
    '## Audit trail',
    `- Sentinel: ${source(m.sentinel)}`,
    `- Tracer: ${source(m.tracer)}`,
    `- Strategist: ${source(m.strategist)}`,
    `- Red Team: ${source(m.redteam)}`,
    `- Dispatcher: ${source(m.dispatcher)}`,
    '',
    'All numbers come from the BlackRoute simulator. Nothing in this pack has been sent.',
  );
  return lines.join('\n');
}

export function actionPackJson(m: Mission) {
  return {
    scenario: { id: m.scenario?.id, title: m.scenario?.title },
    decision: m.decision,
    plan: { levers: m.chosen?.levers, summary: m.chosen?.summary },
    doNothing: m.doNothing?.metrics,
    withPlan: m.recovery?.metrics,
    reports: {
      sentinel: m.sentinel && { source: m.sentinel.source, model: m.sentinel.model, grounding: m.sentinel.grounding, out: m.sentinel.out },
      tracer: m.tracer && { source: m.tracer.source, model: m.tracer.model, grounding: m.tracer.grounding, out: m.tracer.out },
      strategist: m.strategist && { source: m.strategist.source, model: m.strategist.model, grounding: m.strategist.grounding, out: m.strategist.out },
      redteam: m.redteam && { source: m.redteam.source, model: m.redteam.model, grounding: m.redteam.grounding, out: m.redteam.out },
      dispatcher: m.dispatcher && { source: m.dispatcher.source, model: m.dispatcher.model, grounding: m.dispatcher.grounding, out: m.dispatcher.out },
    },
    exportedAt: new Date().toISOString(),
  };
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

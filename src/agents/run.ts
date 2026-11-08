// Calls one agent: the model if one is configured, otherwise the rule-based
// report. Every answer is validated against its schema and grounding-checked
// against the tool results it was given.

import { checkGrounding, type Grounding } from './grounding';
import { OUTPUT, type AgentId, type AgentOutput } from './prompts';

export interface AgentReport<K extends AgentId = AgentId> {
  agent: K;
  out: AgentOutput[K];
  source: 'ai' | 'rules';
  model?: string;
  grounding: Grounding;
  note?: string;
  ms: number;
}

export interface AiStatus {
  provider: string;
  model: string;
}

export async function aiStatus(): Promise<AiStatus | null> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return null;
    const body = (await res.json()) as { ai: AiStatus | null };
    return body.ai;
  } catch {
    return null;
  }
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('not JSON');
  }
}

export async function askAgent<K extends AgentId>(
  agent: K,
  tools: unknown,
  signals: unknown,
  offline: () => AgentOutput[K],
  useAi: boolean,
): Promise<AgentReport<K>> {
  const t0 = performance.now();
  const fallback = (note?: string): AgentReport<K> => {
    const out = offline();
    return { agent, out, source: 'rules', grounding: checkGrounding(out, tools, signals), note, ms: performance.now() - t0 };
  };
  if (!useAi) return fallback();
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent, tools, signals }),
    });
    const body = (await res.json()) as { ok: boolean; text?: string; model?: string; provider?: string; offline?: boolean; error?: string };
    if (!body.ok || !body.text) return fallback(body.offline ? undefined : `${body.error ?? 'AI unavailable'} Used the rule-based report.`);
    const parsed = OUTPUT[agent].safeParse(extractJson(body.text));
    if (!parsed.success) return fallback('The AI answer did not match the required format. Used the rule-based report.');
    const out = parsed.data as AgentOutput[K];
    return { agent, out, source: 'ai', model: body.model, grounding: checkGrounding(out, tools, signals), ms: performance.now() - t0 };
  } catch {
    return fallback('Could not reach the AI service. Used the rule-based report.');
  }
}

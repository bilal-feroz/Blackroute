// POST /api/agent  { agent, tools, signals? }  ->  { ok, text, model, provider } | { ok: false, offline }
// Runs one BlackRoute agent on the configured model. The browser validates the JSON.

import type { AgentId } from '../src/agents/prompts';
import { json, provider, runAgent } from './_lib/llm';

const AGENT_IDS: AgentId[] = ['sentinel', 'tracer', 'strategist', 'redteam', 'dispatcher'];
const MAX_BODY = 60_000;

export async function POST(request: Request): Promise<Response> {
  if (!provider()) return json({ ok: false, offline: true, reason: 'No AI key configured on the server.' });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'Request too large.' }, 413);
  let body: { agent?: string; tools?: unknown; signals?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400);
  }
  const agent = body.agent as AgentId;
  if (!AGENT_IDS.includes(agent)) return json({ ok: false, error: 'Unknown agent.' }, 400);
  try {
    const out = await runAgent(agent, body.tools ?? {}, body.signals ?? null);
    return json({ ok: true, ...out });
  } catch (err) {
    // never echo provider details that could include request data
    const msg = (err as Error).message.startsWith('gemini 429') || (err as Error).message.includes(' 429') ? 'Rate limited by the AI provider.' : 'The AI provider did not answer.';
    return json({ ok: false, error: msg }, 502);
  }
}

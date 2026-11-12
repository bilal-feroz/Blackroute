// POST /api/agent  { agent, tools, signals? }  ->  { ok, text, model, provider } | { ok: false, offline }
// Runs one BlackRoute agent on the configured model. The browser validates the JSON.

import type { AgentId } from '../src/agents/prompts';
import { limited } from './_lib/guard';
import { json, provider, runAgent } from './_lib/llm';

const AGENT_IDS: AgentId[] = ['sentinel', 'tracer', 'strategist', 'redteam', 'dispatcher'];
const MAX_BODY = 60_000;

export async function POST(request: Request): Promise<Response> {
  if (!provider()) return json({ ok: false, offline: true, reason: 'No AI key configured on the server.' });
  if (limited(request, 30)) return json({ ok: false, error: 'Too many AI requests, please wait a minute.' }, 429);
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
  // tool results must be an object; signals, when sent, a short list
  const tools = body.tools;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return json({ ok: false, error: 'Tool results missing.' }, 400);
  if (body.signals != null && (!Array.isArray(body.signals) || body.signals.length > 18)) return json({ ok: false, error: 'Bad signal list.' }, 400);
  try {
    const out = await runAgent(agent, body.tools ?? {}, body.signals ?? null);
    return json({ ok: true, ...out });
  } catch (err) {
    // never echo provider details that could include request data
    const msg = (err as Error).message.startsWith('gemini 429') || (err as Error).message.includes(' 429') ? 'Rate limited by the AI provider.' : 'The AI provider did not answer.';
    return json({ ok: false, error: msg }, 502);
  }
}

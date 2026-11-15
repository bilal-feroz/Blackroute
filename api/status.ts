// GET /api/status -> which AI provider is configured (never the key itself).
import { json, provider } from './_lib/llm.js';

/** Tells the browser which AI model is on, without revealing any key. */
export async function GET(): Promise<Response> {
  const p = provider();
  return json({ ai: p ? { provider: p.name === 'gemini' ? 'Gemini' : 'OpenAI-compatible', model: p.model } : null });
}

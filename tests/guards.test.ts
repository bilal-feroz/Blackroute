import { expect, test } from 'vitest';
import * as sig from '../src/agents/signals';
import * as prompts from '../src/agents/prompts';

test('the injection filter lets normal news through', () => {
  expect(sig.isSuspicious('Officials say the port will reopen on Monday')).toBe(false);
  expect(sig.isSuspicious('Port operator announces a new berth at Jebel Ali')).toBe(false);
});

test('fitLists trims long lists and leaves other values alone', () => {
  const long = { affected: Array.from({ length: 12 }, () => ({ place: 'x', impact: 'y' })) };
  expect((prompts.fitLists('tracer', long) as typeof long).affected).toHaveLength(8);
  expect(prompts.fitLists('tracer', 'text')).toBe('text');
});

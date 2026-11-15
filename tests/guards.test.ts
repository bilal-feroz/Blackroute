import { expect, test } from 'vitest';
import * as sig from '../src/agents/signals';
import * as prompts from '../src/agents/prompts';

test('the injection filter lets normal news through', () => {
  expect(sig.isSuspicious('Officials say the port will reopen on Monday')).toBe(false);
  expect(sig.isSuspicious('Port operator announces a new berth at Jebel Ali')).toBe(false);
});

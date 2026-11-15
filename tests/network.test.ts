import { expect, test } from 'vitest';
import * as tools from '../src/agents/tools';
import * as radar from '../src/core/radar';
import * as sc from '../src/core/scenarios';
import { simulate } from '../src/core/engine';

test('leverNames reads like a plan', () => {
  expect(tools.leverNames([])).toBe('Monitor and hold (no levers)');
  expect(tools.leverNames(['divert_fujairah'])).toBe('Divert ships to Fujairah');
});

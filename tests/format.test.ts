import { expect, test } from 'vitest';
import * as fmt from '../src/core/format';

test('aed shortens to k and M', () => {
  expect(fmt.aed(950)).toBe('AED 950');
  expect(fmt.aed(14600)).toBe('AED 15k');
  expect(fmt.aed(1046000)).toBe('AED 1.05M');
  expect(fmt.aed(12_400_000)).toBe('AED 12M');
});

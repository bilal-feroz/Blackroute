import { expect, test } from 'vitest';
import * as fmt from '../src/core/format';

test('aed shortens to k and M', () => {
  expect(fmt.aed(950)).toBe('AED 950');
  expect(fmt.aed(14600)).toBe('AED 15k');
  expect(fmt.aed(1046000)).toBe('AED 1.05M');
  expect(fmt.aed(12_400_000)).toBe('AED 12M');
});

test('pct shows a share as a percentage', () => {
  expect(fmt.pct(0.881)).toBe('88.1%');
  expect(fmt.pct(0.5, 0)).toBe('50%');
});

test('days switches between hours and days', () => {
  expect(fmt.days(null)).toBe('not within 3 weeks');
  expect(fmt.days(0.2)).toBe('1 h');
  expect(fmt.days(6)).toBe('6 h');
  expect(fmt.days(48)).toBe('2.0 days');
  expect(fmt.days(24 * 12)).toBe('12 days');
});

import { expect, test } from 'vitest';
import * as roads from '../src/scene/roads';

test('trucks have a road from the port to each DC', () => {
  for (const dc of ['dubai_south', 'al_quoz', 'sharjah']) {
    const path = roads.pathBetween('jebel_ali', dc);
    expect(path.length).toBeGreaterThan(1);
    const start = roads.along(path, 0);
    expect(start.x).toBeCloseTo(path[0][0]);
    expect(start.z).toBeCloseTo(path[0][1]);
  }
});

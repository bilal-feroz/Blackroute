// Runs the Monte Carlo planner off the main thread so the 3D view stays smooth.
import { plan } from './planner';
import { SCENARIO_BY_ID } from './scenarios';
import type { Disruption } from './types';

interface Req {
  id: number;
  scenarioId: string;
  disruption: Disruption;
  futures: number;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, scenarioId, disruption, futures } = e.data;
  try {
    const result = plan(SCENARIO_BY_ID[scenarioId], disruption, {
      futures,
      onProgress: (p) => (self as unknown as Worker).postMessage({ id, type: 'progress', p }),
    });
    (self as unknown as Worker).postMessage({ id, type: 'done', result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, type: 'error', message: (err as Error).message });
  }
};

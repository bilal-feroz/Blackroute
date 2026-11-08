// Browser side of the planner worker (falls back to the main thread if workers are unavailable).
import { plan, type PlanProgress, type PlanResult } from './planner';
import { SCENARIO_BY_ID } from './scenarios';
import type { Disruption } from './types';

let worker: Worker | null = null;
let nextId = 1;

export function runPlanner(scenarioId: string, disruption: Disruption, futures: number, onProgress?: (p: PlanProgress) => void): Promise<PlanResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(plan(SCENARIO_BY_ID[scenarioId], disruption, { futures, onProgress }));
  }
  worker ??= new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module' });
  const id = nextId++;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      if (e.data.type === 'progress') onProgress?.(e.data.p);
      else {
        w.removeEventListener('message', onMsg);
        if (e.data.type === 'done') resolve(e.data.result as PlanResult);
        else reject(new Error(e.data.message));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, scenarioId, disruption, futures });
  });
}

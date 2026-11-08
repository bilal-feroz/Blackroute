import type { RadarItem } from '../core/radar';
import type { Scenario } from '../core/scenarios';
import type { LeverId, SimRun } from '../core/types';

export type TwinView = 'local' | 'global';
export type Phase = 'watch' | 'incident' | 'plan' | 'recovery';

export interface TwinState {
  view: TwinView;
  /** recorded simulator run to play back */
  run: SimRun | null;
  /** playback time, in simulator hours */
  hour: number;
  scenario: Scenario | null;
  levers: LeverId[];
  phase: Phase;
  /** top radar items, highlighted as "black routes" while watching */
  blackRoutes: RadarItem[];
  /** node the user clicked, highlighted on the board */
  focus: string | null;
}

export const EMPTY_STATE: TwinState = {
  view: 'local',
  run: null,
  hour: 0,
  scenario: null,
  levers: [],
  phase: 'watch',
  blackRoutes: [],
  focus: null,
};

export interface Board {
  readonly root: import('three').Group;
  update(state: TwinState, dt: number): void;
  /** node ids under the pointer, for clicks */
  pickables: import('three').Object3D[];
  dispose(): void;
}

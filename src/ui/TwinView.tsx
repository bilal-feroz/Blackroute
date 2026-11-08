import { useEffect, useRef, useState } from 'react';
import { Twin } from '../scene/Twin';
import type { TwinState } from '../scene/types';

let liveTwin: Twin | null = null;

/** Hosts the Three.js twin and feeds it state from React. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function TwinView({ state, onPick, insets }: { state: TwinState; onPick?: (id: string | null) => void; insets?: Insets }) {
  const host = useRef<HTMLDivElement>(null);
  const twin = useRef<Twin | null>(null);
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = new Twin(host.current!);
    twin.current = t;
    liveTwin = t;
    t.init((f) => setLoading(f)).then(() => setReady(true));
    return () => {
      t.dispose();
      if (liveTwin === t) liveTwin = null;
      twin.current = null;
    };
  }, []);

  useEffect(() => {
    if (twin.current) twin.current.onPick = onPick ?? null;
  }, [onPick]);

  useEffect(() => {
    twin.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (insets) twin.current?.setInsets(insets);
  }, [insets?.top, insets?.right, insets?.bottom, insets?.left]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="twin" ref={host} />
      {!ready && (
        <div className="loader">
          <div className="loader-mark" />
          <span>Building the digital twin{loading ? ` · ${Math.round(loading * 100)}%` : ''}</span>
        </div>
      )}
    </>
  );
}

export function resetTwinCamera() {
  liveTwin?.resetCamera();
}

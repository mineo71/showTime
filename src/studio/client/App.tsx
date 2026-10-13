import type { PlayerRef } from '@remotion/player';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edit } from '../edit';
import type { Job, StudioState } from '../server';
import { api } from './api';
import { Banners } from './Banners';
import { Inspector } from './Inspector';
import { Look } from './Look';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';

export const App = () => {
  const [state, setState] = useState<StudioState | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const player = useRef<PlayerRef>(null);

  const refresh = useCallback(() => {
    api.state().then((s) => {
      setState(s);
      setJob(s.job);
    }, (err: Error) => setToast(err.message));
  }, []);

  useEffect(() => {
    refresh();
    return api.events({ state: refresh, job: setJob });
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const edit = useCallback(async (change: Edit) => {
    try {
      setState(await api.edit(change));
    } catch (err) {
      setToast((err as Error).message);
      refresh();
    }
  }, [refresh]);

  const run = (start: () => Promise<Job>) => start().then(setJob, (err: Error) => setToast(err.message));

  const seek = (f: number) => {
    player.current?.pause();
    player.current?.seekTo(f);
    setFrame(f);
  };

  if (!state) return <div className="loading">Loading the studio…</div>;
  const step = state.steps.find((s) => s.where === selected) ?? null;

  return (
    <div className="studio">
      <TopBar
        state={state}
        job={job}
        onAspect={(a) => api.aspect(a).then(setState, (err: Error) => setToast(err.message))}
        onRender={(format) => run(() => api.render(format))}
        onRecord={() => run(api.record)}
      />
      <Banners state={state} job={job} onRecord={() => run(api.record)} />
      <main className="work">
        <Preview state={state} player={player} onFrame={setFrame} />
        <aside className="side">
          <Inspector key={step?.where ?? 'none'} step={step} take={state.take} onEdit={edit} />
          <Look state={state} onEdit={edit} />
        </aside>
      </main>
      <Timeline
        state={state}
        frame={frame}
        selected={selected}
        onSelect={(where, f) => {
          setSelected(where);
          if (f !== null) seek(f);
        }}
        onSeek={seek}
      />
      {toast ? (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      ) : null}
    </div>
  );
};

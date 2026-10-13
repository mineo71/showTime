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
  // The selected step, by position and by what it does: when the agent inserts a step, the selection follows its step.
  const [selected, setSelected] = useState<{ where: string; id: string } | null>(null);
  const [frame, setFrame] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const player = useRef<PlayerRef>(null);

  const latest = useRef(-1);
  const accept = useCallback((s: StudioState) => {
    // Responses can arrive out of order; never go back to an older state.
    if (s.version < latest.current) return;
    latest.current = s.version;
    setState(s);
    setJob(s.job);
    setSelected((sel) => {
      if (!sel) return sel;
      if (s.steps.find((x) => x.where === sel.where)?.id === sel.id) return sel;
      const moved = s.steps.find((x) => x.id === sel.id);
      return moved ? { where: moved.where, id: moved.id } : null;
    });
  }, []);

  const refresh = useCallback(() => {
    api.state().then(accept, (err: Error) => setToast(err.message));
  }, [accept]);

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
      accept(await api.edit(change));
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
  const step = state.steps.find((s) => s.where === selected?.where) ?? null;

  return (
    <div className="studio">
      <TopBar
        state={state}
        job={job}
        onAspect={(a) => api.aspect(a).then(accept, (err: Error) => setToast(err.message))}
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
        selected={selected?.where ?? null}
        onSelect={(where, f) => {
          const s = state.steps.find((x) => x.where === where);
          setSelected(s ? { where, id: s.id } : null);
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

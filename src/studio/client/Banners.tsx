import type { FC } from 'react';
import type { Job, StudioState } from '../server';

export const Banners: FC<{ state: StudioState; job: Job | null; onRecord: () => void }> = ({ state, job, onRecord }) => {
  const busy = job?.status === 'running';
  return (
    <div className="banners">
      {state.error ? (
        <div className="banner error">
          <b>The script has a problem.</b> The preview shows the last good version.
          <pre>{state.error}</pre>
        </div>
      ) : null}
      {state.take === 'missing' && !state.error ? (
        <div className="banner info">
          No take yet. Record one to see the video (the app must be running).
          <button onClick={onRecord} disabled={busy}>
            ● Record
          </button>
        </div>
      ) : null}
      {state.take === 'stale' ? (
        <div className="banner warn">
          The actions changed since the take, so this preview is out of date.
          <button onClick={onRecord} disabled={busy}>
            ● Record again
          </button>
        </div>
      ) : null}
      {job ? <JobBanner job={job} /> : null}
    </div>
  );
};

const JobBanner: FC<{ job: Job }> = ({ job }) => {
  const what = job.kind === 'render' ? 'Rendering' : 'Recording';
  if (job.status === 'running') {
    return (
      <div className="banner job">
        <span>
          {what}
          {job.kind === 'render' ? ` ${Math.round(job.progress * 100)}%` : `: ${job.lines.at(-1) ?? 'starting…'}`}
        </span>
        {job.kind === 'render' ? (
          <span className="bar">
            <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </span>
        ) : null}
      </div>
    );
  }
  if (job.status === 'failed') {
    return (
      <div className="banner error">
        <b>{job.kind === 'render' ? 'Render' : 'Recording'} failed.</b>
        <pre>{job.error}</pre>
      </div>
    );
  }
  return (
    <div className="banner done">
      {job.kind === 'render' ? (
        <>
          ✓ Rendered <code>{job.result}</code>
        </>
      ) : (
        <>✓ New take recorded.</>
      )}
    </div>
  );
};

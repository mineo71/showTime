import type { Edit } from '../edit';
import type { Job, StudioState } from '../server';

declare global {
  interface Window {
    __SHOWTIME__: { token: string; name: string };
  }
}

const { token } = window.__SHOWTIME__;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-showtime-token': token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  state: () => call<StudioState>('/api/state'),
  edit: (edit: Edit) => call<StudioState>('/api/edit', edit),
  aspect: (aspect: string) => call<StudioState>('/api/aspect', { aspect }),
  render: (format: string) => call<Job>('/api/render', { format }),
  record: () => call<Job>('/api/record', {}),
  /** Server-sent events: `state` when the script or preview changed, `job` for render/record progress. */
  events: (on: { state: () => void; job: (job: Job) => void }) => {
    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    source.addEventListener('state', () => on.state());
    source.addEventListener('job', (e) => on.job(JSON.parse((e as MessageEvent).data) as Job));
    return () => source.close();
  },
};

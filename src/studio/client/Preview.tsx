import { Player, type PlayerRef } from '@remotion/player';
import { useEffect, type FC, type RefObject } from 'react';
import { ShowtimeVideo } from '../../render/remotion/ShowtimeVideo';
import { totalFrames } from '../../timeline/frames';
import type { StudioState } from '../server';

export const Preview: FC<{ state: StudioState; player: RefObject<PlayerRef | null>; onFrame: (frame: number) => void }> = ({
  state,
  player,
  onFrame,
}) => {
  const t = state.timeline;
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const update = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
    p.addEventListener('frameupdate', update);
    p.addEventListener('seeked', update);
    return () => {
      p.removeEventListener('frameupdate', update);
      p.removeEventListener('seeked', update);
    };
  }, [player, onFrame, t !== null]);

  if (!t) return <section className="stage empty">Record a take to see the preview.</section>;
  return (
    <section className="stage" data-testid="player">
      <Player
        ref={player}
        component={ShowtimeVideo}
        inputProps={{ timeline: t, assetBase: '/files' }}
        durationInFrames={totalFrames(t)}
        fps={t.fps}
        compositionWidth={t.output.width}
        compositionHeight={t.output.height}
        controls
        clickToPlay
        doubleClickToFullscreen
        // Fit inside the stage whatever its shape (container query units: the stage's own size).
        style={{
          width: `min(100cqw, calc(100cqh * ${t.output.width / t.output.height}))`,
          aspectRatio: `${t.output.width} / ${t.output.height}`,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px #0009',
        }}
      />
    </section>
  );
};

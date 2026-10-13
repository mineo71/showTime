import type { FC } from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { cameraAt, cameraTransform } from '../../timeline/camera';
import { introFrames, segmentPlan, sourceMsAtFrame } from '../../timeline/frames';
import { windowLayout } from '../../timeline/layout';
import type { Timeline } from '../../timeline/types';
import { Cursor } from './Cursor';
import { Intro } from './Intro';
import { Captions, Ripples, Spotlights } from './Overlays';

export type ShowtimeVideoProps = { timeline: Timeline };

const SHADOW = '0 30px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.25)';

export const ShowtimeVideo: FC<ShowtimeVideoProps> = ({ timeline: t }) => {
  const frame = useCurrentFrame();
  if (frame < introFrames(t)) return <Intro timeline={t} frame={frame} />;

  const src = sourceMsAtFrame(t, frame) ?? 0;
  const win = windowLayout(t.output, t.stage, t.style.padding);
  const cam = cameraAt(t.camera, src);
  const k = win.width / t.stage.width;

  return (
    <AbsoluteFill style={{ background: t.style.background, fontFamily: t.style.font }}>
      <div
        style={{
          position: 'absolute',
          left: win.x,
          top: win.y,
          width: win.width,
          height: win.height,
          borderRadius: t.style.radius,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: t.style.shadow ? SHADOW : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: win.width,
            height: win.height,
            transformOrigin: '0 0',
            transform: cameraTransform(cam, win.width, win.height),
          }}
        >
          {segmentPlan(t).map((p) => (
            <Sequence key={p.fromFrame} from={p.fromFrame} durationInFrames={p.durationInFrames} layout="none">
              <OffthreadVideo
                src={staticFile(t.video.src)}
                trimBefore={p.trimBefore}
                playbackRate={p.speed}
                muted
                style={{ position: 'absolute', left: 0, top: 0, width: win.width, height: win.height }}
              />
            </Sequence>
          ))}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: t.stage.width,
              height: t.stage.height,
              transformOrigin: '0 0',
              transform: `scale(${k})`,
            }}
          >
            <Spotlights timeline={t} srcMs={src} />
            <Ripples timeline={t} srcMs={src} />
            <Cursor timeline={t} srcMs={src} />
          </div>
        </div>
      </div>
      <Captions timeline={t} srcMs={src} />
    </AbsoluteFill>
  );
};

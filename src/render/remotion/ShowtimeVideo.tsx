import type { FC } from 'react';
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { cameraAt, cameraTransform } from '../../timeline/camera';
import { introFrames, segmentPlan, sourceMsAtFrame } from '../../timeline/frames';
import { BROWSER_BAR, windowLayout } from '../../timeline/layout';
import type { Timeline } from '../../timeline/types';
import { BrowserBar } from './BrowserBar';
import { Cursor } from './Cursor';
import { Intro } from './Intro';
import { Captions, Ripples, Spotlights } from './Overlays';

export type ShowtimeVideoProps = { timeline: Timeline };

const SHADOW = '0 30px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.25)';

export const ShowtimeVideo: FC<ShowtimeVideoProps> = ({ timeline: t }) => {
  const frame = useCurrentFrame();
  const intro = introFrames(t);
  if (frame < intro) return <Intro timeline={t} frame={frame} />;

  const src = sourceMsAtFrame(t, frame) ?? 0;
  const win = windowLayout(t.output, t.stage, t.style.padding, t.chrome ? BROWSER_BAR : 0);
  const cam = cameraAt(t.camera, src);
  const k = win.width / t.stage.width;
  // After an intro card the window rises into place instead of cutting in.
  const enter = intro
    ? interpolate(frame - intro, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    : 1;

  return (
    <AbsoluteFill style={{ background: t.style.background, fontFamily: t.style.font }}>
      <div
        style={{
          position: 'absolute',
          left: win.x,
          top: win.y - win.bar,
          width: win.width,
          height: win.height + win.bar,
          borderRadius: t.style.radius,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: t.style.shadow ? SHADOW : undefined,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 40}px) scale(${0.96 + 0.04 * enter})`,
        }}
      >
        {t.chrome ? <BrowserBar width={win.width} height={win.bar} address={t.chrome.address} dark={t.chrome.dark} font={t.style.font} /> : null}
        <div style={{ position: 'absolute', left: 0, top: win.bar, width: win.width, height: win.height, overflow: 'hidden' }}>
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
      </div>
      <Captions timeline={t} srcMs={src} />
    </AbsoluteFill>
  );
};

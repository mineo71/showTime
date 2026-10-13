import type { FC } from 'react';
import { AbsoluteFill, Easing, Freeze, Html5Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { cameraAt, cameraTransform } from '../../timeline/camera';
import { introFrames, segmentPlan, sourceMsAtFrame, videoEndFrame } from '../../timeline/frames';
import { BROWSER_BAR, viewLayout } from '../../timeline/layout';
import type { Timeline } from '../../timeline/types';
import { BrowserBar } from './BrowserBar';
import { Cursor } from './Cursor';
import { Intro } from './Intro';
import { Outro } from './Outro';
import { Captions, Ripples, Spotlights, Subtitles } from './Overlays';

export type ShowtimeVideoProps = { timeline: Timeline };

const SHADOW = '0 30px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.25)';

/** The soundtrack plays across every frame; the picture switches between cards and the take. */
export const ShowtimeVideo: FC<ShowtimeVideoProps> = ({ timeline: t }) => (
  <>
    {t.audio ? <Html5Audio src={staticFile(t.audio.src)} /> : null}
    <Picture timeline={t} />
  </>
);

const Picture: FC<ShowtimeVideoProps> = ({ timeline: t }) => {
  const frame = useCurrentFrame();
  const intro = introFrames(t);
  if (frame < intro) return <Intro timeline={t} frame={frame} />;
  const end = videoEndFrame(t);
  if (t.outro && frame >= end) return <Outro timeline={t} frame={frame - end} />;

  const src = sourceMsAtFrame(t, frame) ?? 0;
  const win = viewLayout(t.output, t.stage, t.style.padding, t.chrome ? BROWSER_BAR : 0, t.aspect);
  const cam = cameraAt(t.camera, src);
  const { content } = win;
  const k = content.width / t.stage.width;
  const H = t.output.height;
  // 9:16 puts captions and subtitles in the bands above and below the window; the others overlay it.
  const bands = t.aspect === '9:16';
  const above = { top: 0, height: win.y - win.bar, alignItems: 'center' } as const;
  const below = { top: win.y + win.height, bottom: 0, alignItems: 'center' } as const;
  // After an intro card the window rises into place instead of cutting in.
  const enter = intro
    ? interpolate(frame - intro, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    : 1;
  // Before an outro card the window and its captions fade out over the last 12 frames.
  const leave = t.outro ? interpolate(frame, [end - 12, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;

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
          opacity: enter * leave,
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
              width: content.width,
              height: content.height,
              transformOrigin: '0 0',
              transform: cameraTransform(cam, win.width, win.height, content),
            }}
          >
            {segmentPlan(t).map((p) => {
              const video = (
                <OffthreadVideo
                  src={staticFile(t.video.src)}
                  trimBefore={p.trimBefore}
                  playbackRate={p.speed || 1}
                  muted
                  style={{ position: 'absolute', left: 0, top: 0, width: content.width, height: content.height }}
                />
              );
              return (
                <Sequence key={p.fromFrame} from={p.fromFrame} durationInFrames={p.durationInFrames} layout="none">
                  {p.speed === 0 ? <Freeze frame={0}>{video}</Freeze> : video}
                </Sequence>
              );
            })}
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
      <div style={{ opacity: leave }}>
        <Captions
          timeline={t}
          srcMs={src}
          top={bands ? above : { top: win.y + Math.round(H * 0.03) }}
          bottom={bands ? below : { bottom: Math.round(H * 0.075) }}
          fontSize={bands ? 46 : 36}
        />
        <Subtitles
          timeline={t}
          videoMs={((frame - intro) * 1000) / t.fps}
          place={bands ? below : { bottom: Math.round(H * 0.06) }}
          fontSize={bands ? 40 : 34}
        />
      </div>
    </AbsoluteFill>
  );
};

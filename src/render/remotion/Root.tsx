import { Composition } from 'remotion';
import { totalFrames } from '../../timeline/frames';
import { ShowtimeVideo, type ShowtimeVideoProps } from './ShowtimeVideo';

export const RemotionRoot = () => (
  <Composition
    id="ShowtimeVideo"
    component={ShowtimeVideo}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={{} as ShowtimeVideoProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: totalFrames(props.timeline),
      fps: props.timeline.fps,
      width: props.timeline.output.width,
      height: props.timeline.output.height,
    })}
  />
);

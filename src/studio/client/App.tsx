import { Player } from '@remotion/player';
import { ShowtimeVideo } from '../../render/remotion/ShowtimeVideo';

const parts = [Player, ShowtimeVideo];

/** Placeholder until the studio page lands. */
export const App = () => <div data-parts={parts.length}>showTime studio</div>;

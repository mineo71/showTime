import { imageDataUri } from './assets';

/** The logo file as a data URI, so timeline.json carries it to the renderer without extra files. */
export const logoDataUri = (file: string) => imageDataUri(file, 'meta.logo');

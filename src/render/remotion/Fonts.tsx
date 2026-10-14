import { useEffect, useState, type FC } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import type { FontFile } from '../../timeline/types';

/**
 * Loads `style.fonts` before the first frame is captured. A font that can't load fails the render
 * with its family named, rather than letting delayRender time out.
 */
export const Fonts: FC<{ fonts: FontFile[] }> = ({ fonts }) => {
  const [handle] = useState(() => (fonts.length ? delayRender('Loading style.fonts') : null));
  useEffect(() => {
    if (handle === null) return;
    Promise.all(
      fonts.map(async (f) => {
        const face = new FontFace(f.family, `url(${f.src})`, { weight: String(f.weight ?? 'normal'), style: f.style ?? 'normal' });
        try {
          await face.load();
        } catch {
          throw new Error(`style.fonts: "${f.family}" could not be loaded; is the file a valid font?`);
        }
        // FontFaceSet.add exists in every browser; TypeScript's DOM lib leaves it out.
        (document.fonts as unknown as { add(face: FontFace): void }).add(face);
      }),
    ).then(
      () => continueRender(handle),
      (err: Error) => cancelRender(err),
    );
  }, [handle, fonts]);
  return null;
};

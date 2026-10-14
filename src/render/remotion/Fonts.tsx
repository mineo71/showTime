import { useEffect, useState, type FC } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import type { FontFile } from '../../timeline/types';
import { fontKey, fontPlan } from './css';

// FontFaceSet.add/delete exist in every browser; TypeScript's DOM lib leaves them out.
const set = () => document.fonts as unknown as { add(face: FontFace): void; delete(face: FontFace): boolean };

/** Faces this page has loaded, by fontKey: a studio session keeps one face per font, not one per state. */
const faces = new Map<string, FontFace>();

/**
 * Loads `style.fonts` before the first frame is captured, and drops faces no longer listed. A font
 * that can't load fails the render with its family named, rather than letting delayRender time out.
 */
export const Fonts: FC<{ fonts: FontFile[] }> = ({ fonts }) => {
  const signature = fonts.map(fontKey).join('\n');
  const [handle] = useState(() => (fontPlan(new Set(faces.keys()), fonts).add.length ? delayRender('Loading style.fonts') : null));
  useEffect(() => {
    const { add, remove } = fontPlan(new Set(faces.keys()), fonts);
    for (const key of remove) {
      const face = faces.get(key);
      if (face) set().delete(face);
      faces.delete(key);
    }
    Promise.all(
      add.map(async (f) => {
        const face = new FontFace(f.family, `url(${f.src})`, { weight: String(f.weight ?? 'normal'), style: f.style ?? 'normal' });
        try {
          await face.load();
        } catch {
          throw new Error(`style.fonts: "${f.family}" could not be loaded; is the file a valid font?`);
        }
        set().add(face);
        faces.set(fontKey(f), face);
      }),
    ).then(
      () => {
        if (handle !== null) continueRender(handle);
      },
      (err: Error) => cancelRender(err),
    );
    // The signature stands for `fonts`: a new array with the same fonts must not reload them.
  }, [signature, handle]);
  return null;
};

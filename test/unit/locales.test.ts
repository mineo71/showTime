import { describe, expect, it } from 'vitest';
import { localize } from '../../src/script/locales';

const locales = ['en', 'uk'];

describe('localize', () => {
  it('picks the locale from localized objects, anywhere, and fills {locale}', () => {
    const raw = {
      app: { url: 'http://x/{locale}/home' },
      scenes: [{ id: 'a', steps: [{ do: 'click', target: { en: 'text=Save', uk: 'text=Зберегти' }, show: { caption: { en: 'Saved', uk: 'Збережено' } } }] }],
      audio: { voice: { en: { name: 'Samantha' }, uk: { name: 'Lesya' } } },
    };
    expect(localize(raw, locales, 'uk')).toEqual({
      app: { url: 'http://x/uk/home' },
      scenes: [{ id: 'a', steps: [{ do: 'click', target: 'text=Зберегти', show: { caption: 'Збережено' } }] }],
      audio: { voice: { name: 'Lesya' } },
    });
  });

  it('names the path and the locale that is missing', () => {
    const raw = { scenes: [{ id: 'a', steps: [{ do: 'click', target: '#a', show: { caption: { en: 'Hi' } } }] }] };
    expect(() => localize(raw, locales, 'uk')).toThrow(/scenes\.0\.steps\.0\.show\.caption has no "uk" value/);
  });

  it('leaves ordinary objects alone, and the locales list itself', () => {
    const raw = { locales: ['en', 'uk'], show: { caption: 'x', zoom: 2 }, meta: { title: 'T' }, empty: {} };
    expect(localize(raw, locales, 'en')).toEqual(raw);
  });
});

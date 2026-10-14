import { describe, expect, it } from 'vitest';
import { applyEdit, formatScript, parseEdit, stepId } from '../../src/studio/edit';

const raw = () => ({
  version: 1,
  app: { url: 'http://x', mask: ['.email', '.name'] },
  scenes: [
    {
      id: 'a',
      steps: [
        { do: 'click', target: '#a', show: { caption: 'Hi' } },
        { do: 'pause', ms: 500 },
      ],
    },
  ],
});

describe('applyEdit', () => {
  it('sets and removes show fields on a step, without touching the input', () => {
    const before = raw();
    const set = applyEdit(before, { where: 'a#1', show: { caption: 'New', say: 'Hello there.' } });
    expect(set.scenes[0].steps[0].show).toEqual({ caption: 'New', say: 'Hello there.' });
    expect(before.scenes[0].steps[0].show).toEqual({ caption: 'Hi' });
    const cleared = applyEdit(before, { where: 'a#1', show: { caption: null } });
    expect(cleared.scenes[0].steps[0]).toEqual({ do: 'click', target: '#a' });
    expect(applyEdit(before, { where: 'a#2', show: { spotlight: true } }).scenes[0].steps[1].show).toEqual({ spotlight: true });
  });

  it('changes only the open locale of a value written per locale', () => {
    const multi = {
      ...raw(),
      locales: ['en', 'uk'],
      meta: { title: { en: 'Hello', uk: 'Привіт' } },
      scenes: [{ id: 'a', steps: [{ do: 'click', target: '#a', show: { caption: { en: 'Hi', uk: 'Привіт' }, zoom: 2 } }] }],
    };
    const uk = applyEdit(multi, { where: 'a#1', show: { caption: 'Вітаю', zoom: 1.5 } }, 'uk');
    expect(uk.scenes[0].steps[0].show).toEqual({ caption: { en: 'Hi', uk: 'Вітаю' }, zoom: 1.5 });
    expect(applyEdit(multi, { meta: { title: 'Hey' } }).meta).toEqual({ title: { en: 'Hey', uk: 'Привіт' } });
    expect(() => applyEdit(multi, { where: 'a#1', show: { caption: null } }, 'uk')).toThrow(/show\.caption is written per locale \(en, uk\)/);
  });

  it('keeps the other locales\' text when a shared value is edited in a later locale', () => {
    const multi = { ...raw(), locales: ['en', 'uk'], meta: { title: 'Hello' } };
    expect(applyEdit(multi, { where: 'a#1', show: { caption: 'Привіт', zoom: 2 } }, 'uk').scenes[0].steps[0].show).toEqual({ caption: { en: 'Hi', uk: 'Привіт' }, zoom: 2 });
    expect(applyEdit(multi, { meta: { title: 'Вітаю' } }, 'uk').meta).toEqual({ title: { en: 'Hello', uk: 'Вітаю' } });
    // In the first locale a shared value stays shared, and a new one is written plain.
    expect(applyEdit(multi, { where: 'a#1', show: { caption: 'Hey' } }, 'en').scenes[0].steps[0].show).toEqual({ caption: 'Hey' });
    expect(applyEdit(multi, { where: 'a#2', show: { caption: 'Нове' } }, 'uk').scenes[0].steps[1].show).toEqual({ caption: 'Нове' });
  });

  it('edits the watermark text without dropping its image or position', () => {
    const withMark = { ...raw(), style: { watermark: { text: 'acme.com', image: 'brand/mark.svg', position: 'top-left' } } };
    expect(applyEdit(withMark, { style: { watermark: { text: 'acme.io' } } }).style).toEqual({
      watermark: { text: 'acme.io', image: 'brand/mark.svg', position: 'top-left' },
    });
    expect(applyEdit(withMark, { style: { watermark: { text: null } } }).style).toEqual({ watermark: { image: 'brand/mark.svg', position: 'top-left' } });
    const textOnly = { ...raw(), style: { watermark: { text: 'acme.com' } } };
    expect(applyEdit(textOnly, { style: { watermark: { text: null } } }).style).toBeUndefined();
  });

  it('edits the sound pack', () => {
    expect(applyEdit(raw(), { audio: { sounds: 'mechanical' } }).audio).toEqual({ sounds: 'mechanical' });
  });

  it('edits the look and the cards, removing emptied sections', () => {
    const styled = applyEdit(raw(), { style: { accent: '#ef4444', chrome: 'none' } });
    expect(styled.style).toEqual({ accent: '#ef4444', chrome: 'none' });
    expect(applyEdit(styled, { style: { accent: null, chrome: null } }).style).toBeUndefined();
    expect(applyEdit(raw(), { meta: { title: 'Acme', subtitle: 'Reports' } }).meta).toEqual({ title: 'Acme', subtitle: 'Reports' });
  });

  it('refuses an edit meant for a step that has since changed', () => {
    const id = stepId(raw().scenes[0].steps[0]);
    expect(applyEdit(raw(), { where: 'a#1', step: id, show: { caption: 'ok' } }).scenes[0].steps[0].show).toEqual({ caption: 'ok' });
    const moved = raw();
    moved.scenes[0].steps.unshift({ do: 'pause', ms: 100 } as never);
    expect(() => applyEdit(moved, { where: 'a#1', step: id, show: { caption: 'lost' } })).toThrow(/changed on disk/);
    // The fingerprint ignores presentation and key order.
    expect(stepId({ show: { caption: 'x' }, target: '#a', do: 'click' })).toBe(id);
  });

  it('refuses steps that do not exist', () => {
    expect(() => applyEdit(raw(), { where: 'zz#1', show: { caption: 'x' } })).toThrow(/No step zz#1/);
    expect(() => applyEdit(raw(), { where: 'a#9', show: { caption: 'x' } })).toThrow(/No step a#9/);
  });
});

describe('parseEdit', () => {
  it('accepts only the editable fields', () => {
    expect(parseEdit({ where: 'a#1', show: { zoom: false, speed: 2, hold: null } })).toEqual({ where: 'a#1', show: { zoom: false, speed: 2, hold: null } });
    expect(() => parseEdit({ where: 'a#1', show: { target: '#b' } })).toThrow(/Invalid edit/);
    expect(() => parseEdit({ style: { maxZoom: 'big' } })).toThrow(/Invalid edit/);
    expect(() => parseEdit({ meta: { logo: '/etc/passwd' } })).toThrow(/Invalid edit/);
    expect(() => parseEdit({ app: { url: 'http://evil' } })).toThrow(/Invalid edit/);
    expect(parseEdit({ where: 'a#1', show: { highlight: '#f00', spotlight: 'ring', click: 'burst' } })).toBeTruthy();
    expect(parseEdit({ style: { click: 'pulse', captionStyle: 'bar', captionFont: 'Georgia', watermark: { text: 'acme.com' } } })).toBeTruthy();
    expect(parseEdit({ audio: { sounds: 'pop' } })).toEqual({ audio: { sounds: 'pop' } });
    expect(parseEdit({ where: 'a#1', show: { captionMs: 2400, freezeMs: null } })).toEqual({ where: 'a#1', show: { captionMs: 2400, freezeMs: null } });
    expect(() => parseEdit({ style: { watermark: { image: '/etc/passwd' } } })).toThrow(/Invalid edit/);
    expect(() => parseEdit({ audio: { music: { file: '/x.mp3' } } })).toThrow(/Invalid edit/);
  });
});

describe('formatScript', () => {
  it('writes one step per line, short lists inline, and round-trips', () => {
    const text = formatScript(raw());
    expect(text).toContain('\n        { "do": "click", "target": "#a", "show": { "caption": "Hi" } },\n');
    expect(text).toContain('"mask": [".email", ".name"]');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(raw());
  });
});

describe('0.9 look', () => {
  it('lets the studio set how keys are shown', () => {
    const edit = parseEdit({ style: { keys: 'all' } });
    expect(applyEdit({ ...raw() }, edit).style).toEqual({ keys: 'all' });
    expect(() => parseEdit({ style: { keys: 'some' } })).toThrow(/Invalid edit/);
  });
});

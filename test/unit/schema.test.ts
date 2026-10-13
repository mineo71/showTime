import { describe, expect, it } from 'vitest';
import { parseScript, ScriptError, scriptJsonSchema } from '../../src/script/schema';

const minimal = {
  version: 1,
  app: { url: 'http://localhost:3000' },
  scenes: [{ id: 'a', steps: [{ do: 'click', target: 'text=Go' }] }],
};
const withSteps = (steps: unknown[]) => ({ ...minimal, scenes: [{ id: 'a', steps }] });

describe('parseScript', () => {
  it('applies defaults', () => {
    const s = parseScript(minimal);
    expect(s.app.viewport).toEqual({ width: 1440, height: 900 });
    expect(s.app.deviceScaleFactor).toBe(2);
    expect(s.app.mask).toEqual([]);
    expect(s.setup).toEqual([]);
    expect(s.meta).toEqual({});
    expect(s.style).toMatchObject({ autoZoom: true, autoSpeed: true, maxZoom: 1.8, padding: 0.06, radius: 14, shadow: true });
    expect(s.style.background).toContain('gradient');
  });

  it('defaults type pace to human and keeps Unicode text', () => {
    const s = parseScript(withSteps([{ do: 'type', target: '#q', text: 'Привіт' }]));
    expect(s.scenes[0].steps[0]).toMatchObject({ do: 'type', pace: 'human', clear: false, text: 'Привіт' });
  });

  it('rejects an unknown action and names the path', () => {
    expect(() => parseScript(withSteps([{ do: 'jump' }]))).toThrow(/scenes\.0\.steps\.0/);
  });

  it('rejects unknown fields so typos surface', () => {
    expect(() => parseScript(withSteps([{ do: 'click', target: 'x', shwo: {} }]))).toThrow(ScriptError);
  });

  it('requires exactly one of target/by for scroll', () => {
    expect(() => parseScript(withSteps([{ do: 'scroll' }]))).toThrow(/exactly one/);
    expect(() => parseScript(withSteps([{ do: 'scroll', by: 400 }]))).not.toThrow();
  });

  it('requires exactly one of for/ms for wait', () => {
    expect(() => parseScript(withSteps([{ do: 'wait', for: 'text=A', ms: 5 }]))).toThrow(/exactly one/);
    expect(() => parseScript(withSteps([{ do: 'wait', ms: 500 }]))).not.toThrow();
  });

  it('rejects duplicate scene ids', () => {
    expect(() => parseScript({ ...minimal, scenes: [minimal.scenes[0], minimal.scenes[0]] })).toThrow(/duplicate scene id "a"/);
  });

  it('includes the source in the error message', () => {
    expect(() => parseScript({ version: 1 }, '/tmp/demo.json')).toThrow(/Invalid \/tmp\/demo\.json/);
  });
});

describe('scriptJsonSchema', () => {
  it('describes the script object', () => {
    const js = scriptJsonSchema() as { type: string; properties: Record<string, unknown> };
    expect(js.type).toBe('object');
    expect(js.properties.scenes).toBeDefined();
    expect(js.properties.style).toBeDefined();
  });
});

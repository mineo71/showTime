import { describe, expect, it } from 'vitest';
import { filterVoices, OPENAI_VOICES, parseSayVoices } from '../../src/voices';

const SAY = `Albert              en_US    # Hello! My name is Albert.
Eddy (English (US)) en_US    # Hello! My name is Eddy.
Lesya               uk_UA    # Привіт! Мене звуть Леся.
Grandma (English (UK)) en_GB    # Hello! My name is Grandma.`;

describe('voices', () => {
  it('parses macOS say -v ? into names, languages and samples', () => {
    expect(parseSayVoices(SAY)).toEqual([
      { name: 'Albert', language: 'en_US', sample: 'Hello! My name is Albert.' },
      { name: 'Eddy (English (US))', language: 'en_US', sample: 'Hello! My name is Eddy.' },
      { name: 'Lesya', language: 'uk_UA', sample: 'Привіт! Мене звуть Леся.' },
      { name: 'Grandma (English (UK))', language: 'en_GB', sample: 'Hello! My name is Grandma.' },
    ]);
  });

  it('filters by language prefix, whatever the separator', () => {
    const voices = parseSayVoices(SAY);
    expect(filterVoices(voices, 'uk').map((v) => v.name)).toEqual(['Lesya']);
    expect(filterVoices(voices, 'en-gb').map((v) => v.name)).toEqual(['Grandma (English (UK))']);
    expect(filterVoices(voices)).toHaveLength(4);
  });

  it('knows the OpenAI voices', () => {
    expect(OPENAI_VOICES).toContain('alloy');
    expect(OPENAI_VOICES).toContain('nova');
  });
});

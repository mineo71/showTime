import { z } from 'zod';
import { CLICK_KINDS, formatIssues, SOUND_PACKS } from '../script/schema';

type Json = Record<string, unknown>;

const nullable = <T extends z.ZodType>(t: T) => t.nullable().optional();

/** The per-step fields the studio edits; `null` removes a field. */
const ShowEdit = z
  .object({
    caption: nullable(z.string()),
    say: nullable(z.string()),
    zoom: nullable(z.union([z.number(), z.literal(false)])),
    spotlight: nullable(z.union([z.boolean(), z.enum(['dim', 'ring', 'glow'])])),
    speed: nullable(z.number()),
    hold: nullable(z.number().int()),
    highlight: nullable(z.string()),
    click: nullable(z.enum(CLICK_KINDS)),
  })
  .strict();

const StyleEdit = z
  .object({
    background: nullable(z.string()),
    accent: nullable(z.string()),
    chrome: nullable(z.enum(['browser', 'none'])),
    autoZoom: nullable(z.boolean()),
    autoSpeed: nullable(z.boolean()),
    click: nullable(z.enum(CLICK_KINDS)),
    captionStyle: nullable(z.enum(['dark', 'light', 'accent', 'outline', 'bar'])),
    captionFont: nullable(z.string()),
    titleFont: nullable(z.string()),
    // Text only from the page: image paths stay in the file.
    watermark: nullable(
      z
        .object({
          text: nullable(z.string()),
          position: nullable(z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right'])),
          opacity: nullable(z.number()),
          size: nullable(z.number()),
        })
        .strict(),
    ),
  })
  .strict();

const AudioEdit = z.object({ sounds: nullable(z.union([z.boolean(), z.enum(SOUND_PACKS)])) }).strict();

const MetaEdit = z.object({ title: nullable(z.string()), subtitle: nullable(z.string()) }).strict();

export const EditSchema = z.union([
  z
    .object({
      where: z.string().regex(/^[A-Za-z0-9_-]+#\d+$/),
      /** the step's fingerprint when the page saw it (`stepId`), so an edit never lands on a step that moved */
      step: z.string().optional(),
      show: ShowEdit,
    })
    .strict(),
  z.object({ style: StyleEdit }).strict(),
  z.object({ meta: MetaEdit }).strict(),
  z.object({ audio: AudioEdit }).strict(),
]);

export type Edit = z.output<typeof EditSchema>;

/** Validate a request body as an edit (only the fields the studio may change). */
export function parseEdit(body: unknown): Edit {
  const r = EditSchema.safeParse(body);
  if (!r.success) throw new Error(`Invalid edit:\n${formatIssues(r.error.issues)}`);
  return r.data;
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Thrown when an edit names a step that is no longer the one the page showed. */
export class StaleStepError extends Error {}

const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : isObject(v)
      ? `{${Object.keys(v)
          .filter((k) => v[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

/** A step's identity: what it does, without how it is presented (`show`), independent of key order. */
export function stepId(step: unknown): string {
  if (!isObject(step)) return '';
  const { show: _show, ...action } = step;
  return canonical(action);
}

/** `section` with `changes` applied (null removes a key); undefined when nothing is left. */
function merge(section: unknown, changes: Json): Json | undefined {
  const out: Json = isObject(section) ? { ...section } : {};
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

const setOrDelete = (obj: Json, key: string, value: Json | undefined) => {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
};

/** Apply an edit to the script as written (no defaults filled in). Returns a new object. */
export function applyEdit<T extends Json>(raw: T, edit: Edit): T & Json {
  const next = structuredClone(raw) as Json;
  if ('where' in edit) {
    const [sceneId, n] = edit.where.split('#');
    const scenes = Array.isArray(next.scenes) ? next.scenes : [];
    const scene = scenes.find((s): s is Json => isObject(s) && s.id === sceneId);
    const steps = scene && Array.isArray(scene.steps) ? scene.steps : [];
    const step = steps[Number(n) - 1];
    if (!isObject(step)) throw new Error(`No step ${edit.where} in the script.`);
    if (edit.step !== undefined && stepId(step) !== edit.step) {
      throw new StaleStepError(`The script changed on disk: ${edit.where} is a different step now. Check it and edit again.`);
    }
    setOrDelete(step, 'show', merge(step.show, edit.show));
  } else if ('style' in edit) {
    const { watermark, ...rest } = edit.style;
    const style = merge(next.style, rest) ?? {};
    // The watermark is edited field by field (its image stays); it goes when neither text nor image is left.
    if (watermark === null) delete style.watermark;
    else if (watermark !== undefined) {
      const mark = merge(style.watermark, watermark);
      if (mark && (mark.text !== undefined || mark.image !== undefined)) style.watermark = mark;
      else delete style.watermark;
    }
    setOrDelete(next, 'style', Object.keys(style).length ? style : undefined);
  } else if ('meta' in edit) {
    setOrDelete(next, 'meta', merge(next.meta, edit.meta));
  } else {
    setOrDelete(next, 'audio', merge(next.audio, edit.audio));
  }
  return next as T & Json;
}

/** One line: `{ "do": "click", "target": "#a" }`, `["a", "b"]`. */
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (isObject(v)) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

const STEP_LISTS = new Set(['steps', 'setup']);

function pretty(v: unknown, indent: string, key?: string): string {
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    // Steps read best one per line; lists of plain values fit on one.
    if (key && STEP_LISTS.has(key)) return `[\n${v.map((x) => inner + inline(x)).join(',\n')}\n${indent}]`;
    if (v.every((x) => !isObject(x) && !Array.isArray(x))) return inline(v);
    return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${indent}]`;
  }
  if (isObject(v)) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner, k)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(v);
}

/** The script as the studio writes it: two-space indentation, one step per line. */
export const formatScript = (raw: Json): string => `${pretty(raw, '')}\n`;

import { z } from 'zod';
import { formatIssues } from '../script/schema';

type Json = Record<string, unknown>;

const nullable = <T extends z.ZodType>(t: T) => t.nullable().optional();

/** The per-step fields the studio edits; `null` removes a field. */
const ShowEdit = z
  .object({
    caption: nullable(z.string()),
    say: nullable(z.string()),
    zoom: nullable(z.union([z.number(), z.literal(false)])),
    spotlight: nullable(z.boolean()),
    speed: nullable(z.number()),
    hold: nullable(z.number().int()),
  })
  .strict();

const StyleEdit = z
  .object({
    background: nullable(z.string()),
    accent: nullable(z.string()),
    chrome: nullable(z.enum(['browser', 'none'])),
    autoZoom: nullable(z.boolean()),
    autoSpeed: nullable(z.boolean()),
  })
  .strict();

const MetaEdit = z.object({ title: nullable(z.string()), subtitle: nullable(z.string()) }).strict();

export const EditSchema = z.union([
  z.object({ where: z.string().regex(/^[A-Za-z0-9_-]+#\d+$/), show: ShowEdit }).strict(),
  z.object({ style: StyleEdit }).strict(),
  z.object({ meta: MetaEdit }).strict(),
]);

export type Edit = z.output<typeof EditSchema>;

/** Validate a request body as an edit (only the fields the studio may change). */
export function parseEdit(body: unknown): Edit {
  const r = EditSchema.safeParse(body);
  if (!r.success) throw new Error(`Invalid edit:\n${formatIssues(r.error.issues)}`);
  return r.data;
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

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
    setOrDelete(step, 'show', merge(step.show, edit.show));
  } else if ('style' in edit) {
    setOrDelete(next, 'style', merge(next.style, edit.style));
  } else {
    setOrDelete(next, 'meta', merge(next.meta, edit.meta));
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

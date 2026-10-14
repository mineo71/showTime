import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeBundle } from '../../src/render/render';

describe('removeBundle', () => {
  it('removes a render bundle but never what its public link points at (the take)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'showtime-bundle-test-'));
    const work = path.join(root, 'work');
    await mkdir(path.join(work, 'take'), { recursive: true });
    await writeFile(path.join(work, 'take', 'raw.mp4'), 'take');
    const bundle = path.join(root, 'bundle');
    await mkdir(bundle);
    await writeFile(path.join(bundle, 'bundle.js'), 'js');
    await symlink(work, path.join(bundle, 'public'), 'junction');

    await removeBundle(bundle);

    expect(existsSync(bundle)).toBe(false);
    expect(existsSync(path.join(work, 'take', 'raw.mp4'))).toBe(true);
  });
});

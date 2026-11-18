import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { saveDeveloperKey } from './model-config.mjs';

test('saves, replaces and validates the Key without overwriting other settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhixu-key-config-'));
  const file = join(directory, '.env.classroom.local');
  try {
    await writeFile(file, '# local configuration\r\nCLASSROOM_ANYTHINGLLM_API_KEY=\r\nCLASSROOM_PORT=5180\r\n');
    await saveDeveloperKey(file, ' sample-key_1 ');
    await saveDeveloperKey(file, 'sample-key_2');
    await assert.rejects(saveDeveloperKey(file, 'key\nCLASSROOM_PORT=9999'), /无效字符/);
    const raw = await readFile(file, 'utf8');
    assert.match(raw, /^# local configuration/);
    assert.equal((raw.match(/CLASSROOM_ANYTHINGLLM_API_KEY=/g) || []).length, 1);
    assert.deepEqual({...parseEnv(raw)}, {CLASSROOM_ANYTHINGLLM_API_KEY:'sample-key_2', CLASSROOM_PORT:'5180'});
  } finally {
    await rm(directory, {recursive:true, force:true});
  }
});

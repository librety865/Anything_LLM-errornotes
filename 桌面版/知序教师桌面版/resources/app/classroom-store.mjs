import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, constants, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

function readClassroomData(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || !/^[a-f0-9]{48}$/i.test(data.teacherKey) ||
        !Array.isArray(data.classes) || !Array.isArray(data.students)) {
      throw new Error('班级数据结构无效');
    }
    return data;
  } catch {
    throw new Error('无法读取已保存的班级数据，原文件已保留：' + file);
  }
}

export function openClassroomStore(projectRoot, options = {}) {
  const profileRoot = options.profileRoot ?? (process.env.LOCALAPPDATA || homedir());
  const directory = options.directory
    ? resolve(projectRoot, options.directory)
    : resolve(profileRoot, 'Zhixu', 'Classroom');
  const file = resolve(directory, 'classrooms.json');
  const legacy = resolve(projectRoot, '.classroom-data', 'classrooms.json');
  mkdirSync(directory, { recursive: true });

  // Copy the original keys and IDs so student invitations and memberships still match.
  if (!options.directory && !existsSync(file) && existsSync(legacy)) {
    readClassroomData(legacy);
    try { copyFileSync(legacy, file, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }

  if (!existsSync(file)) {
    const initial = { teacherKey: randomBytes(24).toString('hex'), classes: [], students: [] };
    try { writeFileSync(file, JSON.stringify(initial, null, 2), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }

  return {
    file,
    data: readClassroomData(file),
    save(next) {
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx' });
        renameSync(temporary, file);
      } catch (error) {
        try { unlinkSync(temporary); } catch {}
        throw error;
      }
    },
  };
}

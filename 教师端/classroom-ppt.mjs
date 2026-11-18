// [MS-CFB] compound storage and [MS-PPT] live presentation records.
const signature = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const endOfChain = 0xfffffffe;
const unused = 0xffffffff;

function check(condition) {
  if (!condition) throw new RangeError('Invalid binary PowerPoint structure');
}

function compoundStreams(file) {
  check(file.length >= 512 && file.subarray(0, 8).equals(signature));
  const version = file.readUInt16LE(26);
  const shift = file.readUInt16LE(30);
  check((version === 3 && shift === 9) || (version === 4 && shift === 12));
  check(file.readUInt16LE(32) === 6 && file.readUInt32LE(56) === 4096);
  const sectorSize = 2 ** shift;
  const sectorCount = Math.floor(file.length / sectorSize) - 1;
  function sector(id) {
    check(id < sectorCount);
    return file.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  }

  const fatCount = file.readUInt32LE(44);
  check(fatCount > 0 && fatCount <= sectorCount);
  const fatSectors = [];
  function addFatSectors(bytes) {
    for (let offset = 0; offset < bytes.length && fatSectors.length < fatCount; offset += 4) {
      const id = bytes.readUInt32LE(offset);
      if (id !== unused) fatSectors.push(sector(id));
    }
  }
  addFatSectors(file.subarray(76, 512));
  let difat = file.readUInt32LE(68);
  const difatCount = file.readUInt32LE(72);
  check(difatCount <= sectorCount);
  const seenDifat = new Set();
  for (let index = 0; index < difatCount && fatSectors.length < fatCount; index++) {
    check(!seenDifat.has(difat));
    seenDifat.add(difat);
    const bytes = sector(difat);
    addFatSectors(bytes.subarray(0, -4));
    difat = bytes.readUInt32LE(sectorSize - 4);
  }
  check(fatSectors.length === fatCount && fatCount * sectorSize >= sectorCount * 4);
  const fat = Buffer.concat(fatSectors);

  function readChain(first, table, readSector, length) {
    const chunks = [];
    const seen = new Set();
    let total = 0;
    for (let id = first; id !== endOfChain && (length === undefined || total < length); id = table.readUInt32LE(id * 4)) {
      check(id < table.length / 4 && !seen.has(id));
      seen.add(id);
      const chunk = readSector(id);
      chunks.push(chunk);
      total += chunk.length;
    }
    check(length === undefined || total >= length);
    return Buffer.concat(chunks, total).subarray(0, length);
  }

  const directory = readChain(file.readUInt32LE(48), fat, sector);
  const root = directory.subarray(0, 128);
  check(root[66] === 5);
  const firstSector = entry => entry.readUInt32LE(116);
  function size(entry) {
    const low = entry.readUInt32LE(120);
    check((version === 3 || entry.readUInt32LE(124) === 0) && low <= file.length);
    return low;
  }
  const entries = new Map();
  const visited = new Set();
  const pending = [root.readUInt32LE(76)];
  while (pending.length) {
    const id = pending.pop();
    if (id === unused) continue;
    check(id < directory.length / 128 && !visited.has(id));
    visited.add(id);
    const entry = directory.subarray(id * 128, (id + 1) * 128);
    pending.push(entry.readUInt32LE(68), entry.readUInt32LE(72));
    const nameSize = entry.readUInt16LE(64);
    check(nameSize >= 2 && nameSize <= 64 && nameSize % 2 === 0);
    if (entry[66] === 2) entries.set(entry.toString('utf16le', 0, nameSize - 2), entry);
  }

  let miniFat, miniStream;
  return name => {
    const entry = entries.get(name);
    check(entry);
    const length = size(entry);
    if (length >= 4096) return readChain(firstSector(entry), fat, sector, length);
    miniFat ??= readChain(file.readUInt32LE(60), fat, sector, file.readUInt32LE(64) * sectorSize);
    miniStream ??= readChain(firstSector(root), fat, sector, size(root));
    return readChain(firstSector(entry), miniFat, id => {
      check((id + 1) * 64 <= miniStream.length);
      return miniStream.subarray(id * 64, (id + 1) * 64);
    }, length);
  };
}

const recordType = {
  document: 1000, slide: 1006, slidePersist: 1011, textChars: 4000, textBytes: 4008,
  slideList: 4080, edit: 4085, currentUser: 4086, persistDirectory: 6002, textBox: 0xf00d,
};

function record(bytes, offset, limit = bytes.length) {
  check(Number.isInteger(offset) && offset >= 0 && offset + 8 <= limit);
  const flags = bytes.readUInt16LE(offset);
  const start = offset + 8;
  const end = start + bytes.readUInt32LE(offset + 4);
  check(end <= limit);
  return { type: bytes.readUInt16LE(offset + 2), container: (flags & 15) === 15, instance: flags >>> 4, start, end };
}

function* children(bytes, parent) {
  for (let offset = parent.start; offset < parent.end;) {
    const item = record(bytes, offset, parent.end);
    yield item;
    offset = item.end;
  }
}

function activeRecords(bytes, firstEdit) {
  const locations = new Map();
  let documentId;
  for (let offset = firstEdit; offset !== 0;) {
    const edit = record(bytes, offset);
    check(edit.type === recordType.edit && edit.end - edit.start >= 28);
    const previous = bytes.readUInt32LE(edit.start + 8);
    const directoryOffset = bytes.readUInt32LE(edit.start + 12);
    check(previous < directoryOffset && directoryOffset < offset);
    documentId ??= bytes.readUInt32LE(edit.start + 16);
    const directory = record(bytes, directoryOffset, offset);
    check(directory.type === recordType.persistDirectory);
    for (let position = directory.start; position < directory.end;) {
      const entry = bytes.readUInt32LE(position);
      const firstId = entry & 0xfffff;
      const count = entry >>> 20;
      position += 4;
      check(count > 0 && position + 4 * count <= directory.end);
      for (let index = 0; index < count; index++, position += 4) {
        const id = firstId + index;
        if (!locations.has(id)) locations.set(id, bytes.readUInt32LE(position));
      }
    }
    offset = previous;
  }
  return id => record(bytes, locations.get(id ?? documentId));
}

function appendText(bytes, item, output) {
  if (item.type !== recordType.textChars && item.type !== recordType.textBytes) return;
  const unicode = item.type === recordType.textChars;
  check(!unicode || (item.end - item.start) % 2 === 0);
  const text = bytes.toString(unicode ? 'utf16le' : 'latin1', item.start, item.end)
    .replace(/\r\n?|\v/g, '\n').replace(/[\u0000-\u0008\u000e-\u001f]/g, '').trim();
  if (text) output.add(text);
}

function slideText(bytes, slide, output, depth = 0) {
  check(depth < 64);
  for (const item of children(bytes, slide)) {
    if (item.container || item.type === recordType.textBox) slideText(bytes, item, output, depth + 1);
    else appendText(bytes, item, output);
  }
}

function readSlides(bytes, currentUser, maxSize) {
  const current = record(currentUser, 0);
  check(current.type === recordType.currentUser && current.end - current.start >= 12);
  if (currentUser.readUInt32LE(current.start + 4) === 0xf3d1c4df) {
    throw failure(422, '这份旧版 PPT 有密码保护，请先解除密码后重新上传');
  }
  check(currentUser.readUInt32LE(current.start + 4) === 0xe391c05f);
  const liveRecord = activeRecords(bytes, currentUser.readUInt32LE(current.start + 8));
  const document = liveRecord();
  check(document.type === recordType.document);
  const pages = [];
  const usedSlides = new Set();
  let outline, slide, number = 0, total = 0;
  function addPage() {
    if (!outline) return;
    slideText(bytes, slide, outline);
    if (!outline.size) return;
    const page = '## 第 ' + number + ' 页\n\n' + [...outline].join('\n\n');
    total += Buffer.byteLength(page) + 2;
    if (total > maxSize) throw failure(413, '提取的 PPT 文字超过 20 MB，请拆分后再上传');
    pages.push(page);
  }
  for (const list of children(bytes, document)) {
    if (list.type !== recordType.slideList || list.instance !== 0) continue;
    for (const item of children(bytes, list)) {
      if (item.type === recordType.slidePersist) {
        addPage();
        check(item.end - item.start >= 4);
        slide = liveRecord(bytes.readUInt32LE(item.start));
        check(slide.type === recordType.slide && !usedSlides.has(slide.start));
        usedSlides.add(slide.start);
        outline = new Set();
        number++;
      } else if (outline) appendText(bytes, item, outline);
    }
  }
  addPage();
  return pages.join('\n\n');
}

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

export function prepareLegacyPowerPoint(input, filename, maxSize) {
  let text;
  try {
    const stream = compoundStreams(Buffer.from(input));
    text = readSlides(stream('PowerPoint Document'), stream('Current User'), maxSize);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw failure(422, '无法读取这份 .ppt 的文件结构，请确认它是完整的 PowerPoint 97–2003 演示文稿');
  }
  if (!text) throw failure(422, '这份 .ppt 的幻灯片没有可提取的文字。纯图片课件可将幻灯片截图后按图片上传');
  return { buffer: Buffer.from(text, 'utf8'), filename: filename.replace(/\.ppt$/i, '.md'), mime: 'text/markdown' };
}

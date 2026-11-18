const statusFields = { '待确认': 'pending', '加工中': 'processing', '已加工': 'processed', '加工失败': 'failed' };

export function classroomMistakeIndex(rows) {
  const validStatus = new Set(Object.keys(statusFields));
  const short = (value, size) => typeof value === 'string' ? value.slice(0, size) : '';
  const seen = new Set();
  return [...rows].sort((first, second) => short(second.updatedAt, 50).localeCompare(short(first.updatedAt, 50)))
    .filter(row => {
      if (!validStatus.has(row.status) || typeof row.id !== 'string' || !row.id || row.id.length > 120 || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    }).slice(0, 500).map(row => ({
      id: row.id, question: short(row.originalQuestion, 600),
      subject: short(row.subject, 80), module: short(row.module, 100), questionType: short(row.questionType, 80),
      status: row.status, difficulty: row.difficulty, updatedAt: short(row.updatedAt, 50),
      errorTags: (Array.isArray(row.errorTags) ? row.errorTags : []).slice(0, 12).map(value => short(value, 50)),
    }));
}

export function createClassroomProgressSync({ getMembership, readRecords, sendProgress, mock = false }) {
  const inFlight = new Map();
  const lastSent = new Map();

  async function sync(workspace, force = false) {
    const joined = getMembership(workspace);
    if (!joined) return;
    const identity = joined.url + '|' + joined.token;
    const running = inFlight.get(identity);
    if (running) {
      await running;
      return sync(workspace, force);
    }

    const rows = readRecords(workspace).filter(row =>
      (!row.workspace_id || row.workspace_id === workspace)
      && Object.hasOwn(statusFields, row.status)
      && (!mock || !/^demo-[1-7]$/.test(row.id)));
    const payload = { total: rows.length, processed: 0, pending: 0, failed: 0, processing: 0,
      mistakes: classroomMistakeIndex(rows) };
    for (const row of rows) payload[statusFields[row.status]]++;
    const snapshot = JSON.stringify(payload);
    if (!force && lastSent.get(identity) === snapshot) return;

    const request = sendProgress(joined, payload).then(result => {
      lastSent.set(identity, snapshot);
      return result;
    }).finally(() => inFlight.delete(identity));
    inFlight.set(identity, request);
    return request;
  }
  return sync;
}

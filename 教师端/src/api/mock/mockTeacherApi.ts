import type { DemoTeacherId } from '../../auth/teacherSession';
import { mistakeStatuses, type MistakeRecord } from '../../shared/models/mistake';
import { filterKeys, missingValue, type Filters, type Option, type Page, type Pagination, type Stats, type TeacherApi } from '../contracts';
import { classes, feedbackByVariant, grants, records, students, teachers, workspaces } from './fixtures';

const unavailable = () => new Error('记录不存在或无权访问。');
const matchText = (text: string, keyword = '') => text.toLowerCase().includes(keyword.trim().toLowerCase());
const sortedRecords = (items: MistakeRecord[]) => [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
const classStats = (items: MistakeRecord[]): Stats => ({
  mistakeCount: items.length,
  pendingCount: items.filter(item => item.status === '待确认').length,
  processedCount: items.filter(item => item.status === '已加工').length,
  lastActiveAt: sortedRecords(items)[0]?.updatedAt ?? null,
});
const options = (values: string[]): Option[] =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')).map(label => ({ value: label, label }));
const displayValue = (value: string) => value || missingValue;

function pageOf<T>(items: T[], pagination: Pagination): Page<T> {
  const start = (pagination.page - 1) * pagination.pageSize;
  return { items: items.slice(start, start + pagination.pageSize), total: items.length };
}

function filterRecords(items: MistakeRecord[], filters: Filters) {
  const { classId, studentId, subject, module, questionType, errorTag, difficulty, status, from, to, keyword } = filters;
  return items.filter(item => {
    const day = item.createdAt.slice(0, 10);
    return (!classId || item.classId === classId)
      && (!studentId || item.studentId === studentId)
      && (!subject || displayValue(item.subject) === subject)
      && (!module || item.module === module)
      && (!questionType || item.questionType === questionType)
      && (!errorTag || (errorTag === missingValue ? item.errorTags.length === 0 : item.errorTags.includes(errorTag)))
      && (!difficulty || String(item.difficulty) === difficulty)
      && (!status || item.status === status)
      && (!from || day >= from)
      && (!to || day <= to)
      && matchText(item.originalQuestion + ' ' + item.errorTags.join(' '), keyword);
  });
}

function distribution(items: MistakeRecord[], buckets: Option[], values: (item: MistakeRecord) => string[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const value of new Set(values(item))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return buckets.map(bucket => ({ ...bucket, count: counts.get(bucket.value) ?? 0 }));
}

export function createMockTeacherApi(teacherId: DemoTeacherId): TeacherApi {
  const allowed = classes.filter(item => grants[teacherId].includes(item.id));
  let shouldFail = import.meta.env.VITE_TEACHER_MOCK_FAIL_ONCE === 'true';

  async function read<T>(signal: AbortSignal, action: () => T): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const abort = () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 250);
      signal.addEventListener('abort', abort, { once: true });
    });
    signal.throwIfAborted();
    return action();
  }

  function scope(w: string) {
    const visibleClasses = allowed.filter(item => item.workspaceId === w);
    if (!visibleClasses.length) throw unavailable();
    const ids = new Set(visibleClasses.map(item => item.id));
    return {
      classes: visibleClasses,
      students: students.filter(item => ids.has(item.classId)),
      records: records.filter(item => item.workspaceId === w && ids.has(item.classId)),
    };
  }

  function classIn(w: string, classId: string) {
    const data = scope(w);
    const classroom = data.classes.find(item => item.id === classId);
    if (!classroom) throw unavailable();
    const members = data.students.filter(item => item.classId === classId);
    return { classroom, members, records: data.records.filter(item => item.classId === classId) };
  }

  function studentIn(w: string, classId: string, id: string) {
    const data = classIn(w, classId);
    const records = data.records.filter(item => item.studentId === id);
    const student = students.find(item => item.id === id && (item.classId === classId || records.length > 0));
    if (!student) throw unavailable();
    return { student, classroom: data.classroom, records };
  }

  function mistakeIn(w: string, id: string) {
    const item = scope(w).records.find(record => record.id === id);
    if (!item) throw unavailable();
    return item;
  }

  return {
    me: signal => read(signal, () => teachers[teacherId]),
    workspaces: signal => read(signal, () => workspaces.filter(item => allowed.some(c => c.workspaceId === item.id))),
    dashboard: (w, filters, signal) => read(signal, () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('演示查询失败，请重试。');
      }
      const data = scope(w);
      const items = filterRecords(data.records, filters);
      const recordFiltered = filterKeys.some(key => key !== 'classId' && key !== 'studentId' && Boolean(filters[key]));
      const people = data.students.filter(item => (!filters.classId || item.classId === filters.classId)
        && (!filters.studentId || item.id === filters.studentId));
      const classIds = new Set(people.map(item => item.classId));
      const studentIds = new Set(people.map(item => item.id));
      if (filters.studentId && !people.length && items.length) {
        for (const item of items) classIds.add(item.classId);
        studentIds.add(filters.studentId);
      }
      const stats = classStats(items);
      return {
        classCount: recordFiltered ? new Set(items.map(item => item.classId)).size : classIds.size,
        studentCount: recordFiltered ? new Set(items.map(item => item.studentId)).size : studentIds.size,
        mistakeCount: stats.mistakeCount,
        pendingCount: stats.pendingCount,
        processedCount: stats.processedCount,
        averageDifficulty: items.length ? items.reduce((sum, item) => sum + item.difficulty, 0) / items.length : null,
        distributions: {
          errorTag: distribution(items, [...options(data.records.flatMap(item => item.errorTags)), { value: missingValue, label: '未标注' }],
            item => item.errorTags.length ? item.errorTags : [missingValue]),
          subject: distribution(items, [...options(data.records.map(item => item.subject)), { value: missingValue, label: '未标注' }], item => [displayValue(item.subject)]),
          difficulty: distribution(items, ['1', '2', '3', '4', '5'].map(value => ({ value, label: value + ' 级' })), item => [String(item.difficulty)]),
          status: distribution(items, mistakeStatuses.map(label => ({ value: label, label })), item => [item.status]),
        },
      };
    }),
    filterOptions: (w, filters, signal) => read(signal, () => {
      const data = scope(w);
      const visibleStudentIds = new Set(data.students.filter(item => !filters.classId || item.classId === filters.classId).map(item => item.id));
      for (const item of data.records) {
        if (!filters.classId || item.classId === filters.classId) visibleStudentIds.add(item.studentId);
      }
      return {
        classId: data.classes.map(item => ({ value: item.id, label: item.name })),
        studentId: students.filter(item => visibleStudentIds.has(item.id))
          .map(item => ({ value: item.id, label: item.displayIdentifier })),
        subject: [...options(data.records.map(item => item.subject)),
          ...(data.records.some(item => !item.subject) ? [{ value: missingValue, label: '未标注' }] : [])],
        module: options(data.records.map(item => item.module)),
        questionType: options(data.records.map(item => item.questionType)),
        errorTag: [...options(data.records.flatMap(item => item.errorTags)),
          ...(data.records.some(item => !item.errorTags.length) ? [{ value: missingValue, label: '未标注' }] : [])],
      };
    }),
    classes: (w, filters, pagination, signal) => read(signal, () => {
      const data = scope(w);
      return pageOf(data.classes.filter(item => (!filters.classId || item.id === filters.classId) && matchText(item.name, filters.keyword))
        .map(item => ({
          classId: item.id, name: item.name,
          studentCount: data.students.filter(student => student.classId === item.id).length,
          ...classStats(data.records.filter(record => record.classId === item.id)),
        })), pagination);
    }),
    classDetail: (w, classId, signal) => read(signal, () => {
      const data = classIn(w, classId);
      return { classId, name: data.classroom.name, studentCount: data.members.length, ...classStats(data.records) };
    }),
    students: (w, classId, keyword, pagination, signal) => read(signal, () => {
      const data = classIn(w, classId);
      return pageOf(data.members.filter(item => matchText(item.displayIdentifier, keyword)).map(item => ({
        classId, className: data.classroom.name, studentId: item.id, displayIdentifier: item.displayIdentifier,
        ...classStats(data.records.filter(record => record.studentId === item.id)),
      })), pagination);
    }),
    student: (w, classId, id, signal) => read(signal, () => {
      const data = studentIn(w, classId, id);
      return { classId, className: data.classroom.name, studentId: id, displayIdentifier: data.student.displayIdentifier,
        membership: data.student.classId === classId ? 'current' : 'historical', ...classStats(data.records) };
    }),
    studentMistakes: (w, classId, id, filters, pagination, signal) => read(signal, () =>
      pageOf(sortedRecords(filterRecords(studentIn(w, classId, id).records, filters)), pagination)),
    mistakes: (w, filters, pagination, signal) => read(signal, () =>
      pageOf(sortedRecords(filterRecords(scope(w).records, filters)), pagination)),
    mistake: (w, id, signal) => read(signal, () => mistakeIn(w, id)),
    feedback: (w, id, variantId, signal) => read(signal, () => {
      const item = mistakeIn(w, id);
      if (!item.variants.some(variant => variant.id === variantId)) throw unavailable();
      const feedback = feedbackByVariant.get(variantId);
      return feedback ? { availability: 'available', feedback } : { availability: 'not_generated' };
    }),
  };
}

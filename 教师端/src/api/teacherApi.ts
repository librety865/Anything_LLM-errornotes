import type { TeacherSession } from '../auth/teacherSession';
import { createHttpTeacherApi } from './httpTeacherApi';
import { createMockTeacherApi } from './mock/mockTeacherApi';

export function createTeacherApi(session: TeacherSession) {
  return session.mode === 'mock'
    ? createMockTeacherApi(session.teacherId)
    : createHttpTeacherApi(session.teacherToken);
}

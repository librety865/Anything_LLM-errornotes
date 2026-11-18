export type DemoTeacherId = 'demo-teacher-lin' | 'demo-teacher-zhou';
export type TeacherSession =
  | { mode: 'mock'; teacherId: DemoTeacherId }
  | { mode: 'http'; teacherToken: string };

// Auth integration supplies the teacher token through this HTTP session type.
// The student session, AnythingLLM key, and build-time environment are never read.
export function initialTeacherSession(): TeacherSession {
  return { mode: 'mock', teacherId: 'demo-teacher-lin' };
}

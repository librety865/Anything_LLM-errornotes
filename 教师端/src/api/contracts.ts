import type { Feedback, MistakeRecord } from '../shared/models/mistake';

export interface Teacher { id: string; displayName: string; role: 'teacher' }
// The service returns authorized, active workspaces with their current display names.
export interface Workspace { id: string; name: string }
export interface Stats { mistakeCount: number; pendingCount: number; processedCount: number; lastActiveAt: string | null }
export interface ClassSummary extends Stats {
  classId: string;
  name: string;
  studentCount: number;
}
export interface StudentSummary extends Stats {
  studentId: string;
  displayIdentifier: string;
  classId: string;
  className: string;
  membership?: 'current' | 'historical';
}

export const filterKeys = [
  'classId', 'studentId', 'subject', 'module', 'questionType', 'errorTag',
  'difficulty', 'status', 'from', 'to', 'keyword',
] as const;
export type Filters = Partial<Record<(typeof filterKeys)[number], string>>;
export type Option = { value: string; label: string };
export type FilterOptions = Record<'classId' | 'studentId' | 'subject' | 'module' | 'questionType' | 'errorTag', Option[]>;
export type DistributionKey = 'errorTag' | 'subject' | 'difficulty' | 'status';
export type Bucket = Option & { count: number };
export const missingValue = '__unclassified__';
export interface Dashboard {
  classCount: number;
  studentCount: number;
  mistakeCount: number;
  pendingCount: number;
  processedCount: number;
  averageDifficulty: number | null;
  distributions: Record<DistributionKey, Bucket[]>;
}

export type FeedbackResult =
  | { availability: 'available'; feedback: Feedback }
  | { availability: 'not_generated' };

export interface Page<T> { items: T[]; total: number }
export interface Pagination { page: number; pageSize: number }
export interface TeacherApi {
  me(signal: AbortSignal): Promise<Teacher>;
  workspaces(signal: AbortSignal): Promise<Workspace[]>;
  dashboard(w: string, filters: Filters, signal: AbortSignal): Promise<Dashboard>;
  filterOptions(w: string, filters: Filters, signal: AbortSignal): Promise<FilterOptions>;
  classes(w: string, filters: Filters, pagination: Pagination, signal: AbortSignal): Promise<Page<ClassSummary>>;
  classDetail(w: string, classId: string, signal: AbortSignal): Promise<ClassSummary>;
  students(w: string, classId: string, keyword: string, pagination: Pagination, signal: AbortSignal): Promise<Page<StudentSummary>>;
  student(w: string, classId: string, studentId: string, signal: AbortSignal): Promise<StudentSummary>;
  studentMistakes(w: string, classId: string, studentId: string, filters: Filters, pagination: Pagination, signal: AbortSignal): Promise<Page<MistakeRecord>>;
  mistakes(w: string, filters: Filters, pagination: Pagination, signal: AbortSignal): Promise<Page<MistakeRecord>>;
  mistake(w: string, id: string, signal: AbortSignal): Promise<MistakeRecord>;
  feedback(w: string, id: string, variantId: string, signal: AbortSignal): Promise<FeedbackResult>;
}

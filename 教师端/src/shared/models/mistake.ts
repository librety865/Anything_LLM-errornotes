// Source: sibling mistake-workbench/src/types.ts. Teacher scope and attachment URLs
// are projection fields supplied by the teacher service.
export const mistakeStatuses = ['待确认', '加工中', '已加工', '加工失败'] as const;
export type MistakeStatus = (typeof mistakeStatuses)[number];
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Feedback {
  changePoint: string;
  standardProcess: string;
  scoringPoints: string;
  firstCommonError: string;
}

export interface Variant {
  id: string;
  label: 'V1' | 'V2' | 'V3';
  dimension: '数值' | '关键条件' | '提问方向';
  stem: string;
}

export interface MistakeRecord {
  id: string;
  workspaceId: string;
  examType?: string; // Legacy record metadata. Workspace ID defines scope.
  classId: string;
  studentId: string;
  subject: string;
  module: string;
  questionType: string;
  difficulty: Difficulty;
  status: MistakeStatus;
  errorTags: string[];
  originalQuestion: string;
  userAnswer: string;
  referenceAnswer?: string;
  gradingResult?: string;
  modelAnswer?: string;
  images?: { id: string; name: string; viewUrl: string }[];
  pendingGap?: string;
  breakpoint: { location: string; rootCause: string; nextAction: string };
  motherQuestion: { point: string; conditionToRequirement: string; entryJudgment: string; failureCondition: string };
  variants: Variant[];
  solutionTemplate: string[];
  createdAt: string;
  updatedAt: string;
}

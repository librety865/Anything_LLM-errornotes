export const exams = ['高考','中考','考研','考公'] as const;
// Legacy exam labels are preserved; new records use an empty label.
export type Exam = string;
export type Axis = '知识点' | '错误点';
export type Feedback = {changePoint:string; standardProcess:string; scoringPoints:string; firstCommonError:string};
// 教研知识库检索到的一条依据（来自 AnythingLLM 工作区向量检索）
export type Evidence = {id:string; text:string; score:number; title:string; source:string};
export interface MistakeRecord {
 workspace_id?:string; images?:ImageEvidence[]; userConfirmed?:boolean; modelAnswer?:string;
 entryText?:string; clarification?:string; clarificationUsed?:boolean;
 id:string; examType:Exam; subject:string; module:string; questionType:string; difficulty:1|2|3|4|5;
 originalQuestion:string; userAnswer:string; referenceAnswer?:string; gradingResult?:string;
 status:'待确认'|'加工中'|'已加工'|'加工失败'; pendingGap?:string; errorTags:string[]; evidence?:Evidence[]; evidenceError?:string;
 breakpoint:{location:string;rootCause:string;nextAction:string};
 motherQuestion:{point:string;conditionToRequirement:string;entryJudgment:string;failureCondition:string};
 variants:{id:string;label:'V1'|'V2'|'V3';dimension:'数值'|'关键条件'|'提问方向';stem:string;feedback?:Feedback}[];
 solutionTemplate:string[];createdAt:string;updatedAt:string;
}
export type Input = Pick<MistakeRecord,'examType'|'subject'|'module'|'questionType'|'difficulty'|'originalQuestion'|'userAnswer'|'referenceAnswer'|'gradingResult'|'workspace_id'|'images'|'userConfirmed'|'entryText'>;
export interface BatchSummary {concentratedBreakpoint:string;prioritySupplement:string;mergeSuggestions:string[]}
export interface Batch {workspace_id?:string;id:string;ids:string[];examType:Exam;source:'batch-process'|'batch-create';summary:BatchSummary}
export interface Workspace {id:string;name:string;examType:Exam;slug?:string}
export interface Preferences {variantCount:2|3;classificationAxis:Axis|''}

export interface ImageEvidence {id:string;name:string;originalImageId:string;questionText:string;handwrittenText:string;referenceText:string;confirmed:boolean}

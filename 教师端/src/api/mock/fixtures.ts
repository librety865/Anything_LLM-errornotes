import type { DemoTeacherId } from '../../auth/teacherSession';
import { mistakeStatuses, type Difficulty, type Feedback, type MistakeRecord } from '../../shared/models/mistake';
import type { Teacher, Workspace } from '../contracts';

export const teachers: Record<DemoTeacherId, Teacher> = {
  'demo-teacher-lin': { id: 'demo-teacher-lin', displayName: '演示教师 · 林', role: 'teacher' },
  'demo-teacher-zhou': { id: 'demo-teacher-zhou', displayName: '演示教师 · 周', role: 'teacher' },
};

// Keep existing demo IDs stable for saved teacher preferences; names are editable upstream.
export const workspaces: Workspace[] = [
  { id: 'demo-gaokao', name: '课堂错题整理' },
  { id: 'demo-zhongkao', name: '阶段复习' },
];

export const classes = [
  { id: 'demo-class-01', name: '演示一班', workspaceId: 'demo-gaokao' },
  { id: 'demo-class-02', name: '演示二班', workspaceId: 'demo-gaokao' },
  { id: 'demo-class-03', name: '演示三班', workspaceId: 'demo-zhongkao' },
];

export const grants: Record<DemoTeacherId, string[]> = {
  'demo-teacher-lin': classes.map(item => item.id),
  'demo-teacher-zhou': ['demo-class-02'],
};

export const students = classes.flatMap((item, classIndex) =>
  Array.from({ length: 3 }, (_, index) => {
    const ordinal = classIndex * 3 + index + 1;
    const suffix = String(ordinal).padStart(2, '0');
    const currentClassId = ordinal === 1 ? classes[1].id : ordinal === 4 ? classes[0].id : item.id;
    return { id: 'demo-student-' + suffix, displayIdentifier: '演示学生 ' + suffix, classId: currentClassId, previousClassId: item.id, ordinal };
  }),
);

const examples = [
  { subject: '数学', module: '代数', questionType: '计算题', question: '求方程 2x + 3 = 11 的解。', answer: 'x = 4', theme: '等式两边同步变形' },
  { subject: '物理', module: '力学', questionType: '计算题', question: '物体以 3 m/s 匀速运动 4 s，求位移大小。', answer: '12 m', theme: '统一单位后代入公式' },
  { subject: '数学', module: '统计', questionType: '简答题', question: '计算 2、4、9 的算术平均数。', answer: '5', theme: '用总和除以数据个数' },
  { subject: '英语', module: '语法', questionType: '填空题', question: '用括号内单词的正确形式填空：She ___ (visit) the museum yesterday.', answer: 'visited', theme: '根据时间状语判断时态' },
];

const tags = [['审题遗漏', '步骤缺失'], ['单位换算'], ['计算失误'], ['概念混淆']];
const processedExamples = [
  { slot: 0, wrong: 'x = 7', stems: ['求解 2x + 5 = 13。', '求解 2(x + 3) = 14。', '已知 2x + a = 11 且 x = 3，求 a。'], process: '等式两边减去 5，得 2x = 8。两边同时除以 2，得 x = 4。', second: '先同时除以 2 得 x + 3 = 7，再减去 3 得 x = 4。', third: '代入 x = 3，得 6 + a = 11，所以 a = 5。' },
  { slot: 1, wrong: '12 m/s', stems: ['物体以 5 m/s 匀速运动 6 s，求位移大小。', '物体以 72 km/h 匀速运动 10 s，求位移大小。', '物体匀速运动 15 m 用时 5 s，求速率。'], process: '位移大小等于速率乘时间，即 5 × 6 = 30 m。', second: '72 km/h 等于 20 m/s，乘以 10 s 得 200 m。', third: '速率等于位移大小除以时长，即 15 ÷ 5 = 3 m/s。' },
];

export const feedbackByVariant = new Map<string, Feedback>();
export const records: MistakeRecord[] = students.flatMap(student =>
  mistakeStatuses.map((status, index) => {
    const id = student.id + '-mistake-' + (index + 1);
    const atRecording = index === 0 ? student.previousClassId : student.classId;
    const classroom = classes.find(item => item.id === atRecording)!;
    const workspace = workspaces.find(item => item.id === classroom.workspaceId)!;
    const processed = status === '已加工';
    const worked = processedExamples[student.ordinal % processedExamples.length];
    const exampleIndex = processed ? worked.slot : (student.ordinal + index) % examples.length;
    const example = examples[exampleIndex];
    const day = String(index * 4 + student.ordinal).padStart(2, '0');
    const variants: MistakeRecord['variants'] = processed
      ? (['V1', 'V2', 'V3'] as const).slice(0, student.ordinal % 2 ? 2 : 3).map((label, variantIndex) => ({
          id: id + '-' + label,
          label,
          dimension: (['数值', '关键条件', '提问方向'] as const)[variantIndex],
          stem: worked.stems[variantIndex],
        }))
      : [];
    variants.forEach((variant, variantIndex) => {
      if (variantIndex === 1) return;
      feedbackByVariant.set(variant.id, {
        changePoint: variantIndex === 0 ? '替换题目中的数值。' : '提问方向改变，需要从已知量反求。',
        standardProcess: [worked.process, worked.second, worked.third][variantIndex],
        scoringPoints: '列出关系式、完成计算并写出结论。',
        firstCommonError: '未逐项核对题目已知条件就代入数值。',
      });
    });
    return {
      id, workspaceId: workspace.id, classId: classroom.id, studentId: student.id,
      subject: example.subject, module: example.module, questionType: example.questionType,
      difficulty: ((student.ordinal + index) % 5 + 1) as Difficulty,
      status, errorTags: processed ? tags[exampleIndex] : [],
      originalQuestion: example.question,
      userAnswer: processed ? worked.wrong : '演示作答：写出部分计算，未完成核对。',
      referenceAnswer: example.answer,
      modelAnswer: processed ? example.answer : undefined,
      gradingResult: processed ? '演示批改：结论有误。' : undefined,
      pendingGap: status === '待确认' ? '学生尚未确认作答记录。' : undefined,
      breakpoint: processed
        ? { location: '从条件到结论', rootCause: example.theme, nextAction: '写出中间步骤并复核。' }
        : { location: '', rootCause: '', nextAction: '' },
      motherQuestion: processed
        ? { point: example.theme, conditionToRequirement: '列出已知量并找到目标量。', entryJudgment: '先核对已知条件。', failureCondition: '条件改变后需要重新列式。' }
        : { point: '', conditionToRequirement: '', entryJudgment: '', failureCondition: '' },
      variants, solutionTemplate: processed ? ['写出已知条件。', example.theme + '。', '复核答案并写出结论。'] : [],
      createdAt: '2026-10-' + day + 'T08:00:00+08:00',
      updatedAt: '2026-10-' + day + 'T14:00:00+08:00',
    };
  }),
);

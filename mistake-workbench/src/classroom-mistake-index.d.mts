import type { MistakeRecord } from './types';
export function classroomMistakeIndex(rows: MistakeRecord[]): object[];

export function createClassroomProgressSync<Member extends { url: string; token: string }, Result>(options: {
 getMembership: (workspace: string) => Member | null;
 readRecords: (workspace: string) => MistakeRecord[];
 sendProgress: (membership: Member, payload: object) => Promise<Result>;
 mock?: boolean;
}): (workspace: string, force?: boolean) => Promise<Result | undefined>;

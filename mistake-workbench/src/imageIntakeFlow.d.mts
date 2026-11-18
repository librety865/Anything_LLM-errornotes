import type { ComponentType } from 'react';
import type { Input, MistakeRecord } from './types';
import type { Scope } from './localRepository';
import type { ImageAttachment } from './apiClient';

export function createImageIntake(React: typeof import('react'), dependencies: {
 api: { capture: () => () => boolean };
 membership: (id?: string) => unknown;
 workspaceChat: (workspace: Scope, instruction: string, attachments: ImageAttachment[]) => Promise<string>;
 mock: boolean;
 initialWorkspace: () => string;
 scope: (id: string) => Scope;
 parseText: (raw: string) => unknown;
 saveOriginal: (id: string, file: File) => Promise<unknown>;
 compress: (file: File) => Promise<string>;
}): ComponentType<{
 disabled: boolean;
 onUpload: (items: Input[]) => Promise<{ records: MistakeRecord[] }>;
 onBusyChange: (busy: boolean) => void;
 handwriting?: boolean;
}>;

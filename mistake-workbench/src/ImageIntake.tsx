import * as React from 'react';
import { membership, workspaceChat } from './classroomClient';
import { api } from './api';
import { MOCK } from './config';
import { initialWorkspace, scope } from './localRepository';
import { parseText } from './parsers';
import { saveOriginal, compress } from './imageStore';
import { createImageIntake } from './imageIntakeFlow.mjs';

export const ImageIntake = createImageIntake(React, {
 api, membership, workspaceChat, mock: MOCK, initialWorkspace, scope, parseText, saveOriginal, compress,
});

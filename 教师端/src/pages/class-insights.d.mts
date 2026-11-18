import type { ComponentType } from 'react';
import type { useLocation, useNavigate } from 'react-router-dom';
import type { renderMathText } from '../math-display.mjs';
export function createClassInsights(React: typeof import('react'), location: typeof useLocation,
 navigate: typeof useNavigate, math: typeof renderMathText): ComponentType<{ mode: 'dashboard' | 'search' | 'settings' }>;

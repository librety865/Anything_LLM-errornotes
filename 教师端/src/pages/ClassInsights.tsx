import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { renderMathText } from '../math-display.mjs';
import { createClassInsights } from './class-insights.mjs';

export const ClassInsights = createClassInsights(React, useLocation, useNavigate, renderMathText);

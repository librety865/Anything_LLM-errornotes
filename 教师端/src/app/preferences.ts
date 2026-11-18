import { createContext, useContext } from 'react';
import type { Filters } from '../api/contracts';

export interface Preferences {
  dashboardFilters: Filters;
  chartLabels: boolean;
  readOnlyStyle: 'compact' | 'prominent';
}

export const defaultPreferences: Preferences = {
  dashboardFilters: {},
  chartLabels: true,
  readOnlyStyle: 'compact',
};

export const ReadOnlyStyleContext = createContext<Preferences['readOnlyStyle']>('compact');
export const PreferencesContext = createContext<{
  preferences: Preferences;
  save: (value: Preferences) => boolean;
}>({ preferences: defaultPreferences, save: () => false });
export const usePreferences = () => useContext(PreferencesContext);

export function readPreferences(key: string): Preferences {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...defaultPreferences, ...JSON.parse(raw) } : defaultPreferences;
  } catch {
    return defaultPreferences;
  }
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TEACHER_DATA_MODE?: 'mock' | 'http';
  readonly VITE_TEACHER_MOCK_FAIL_ONCE?: string;
}

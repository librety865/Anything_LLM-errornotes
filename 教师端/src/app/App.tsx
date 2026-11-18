import { LibraryPage } from '../pages/LibraryPage';
import { useLocation } from 'react-router-dom';
import { ClassroomLayout } from './TeacherLayout';
import { ClassroomPage } from '../pages/ClassroomPage';
import { ClassInsights } from '../pages/ClassInsights';

export function App() {
  const { pathname } = useLocation();
  if (pathname === '/library') return <ClassroomLayout><LibraryPage /></ClassroomLayout>;
  if (pathname === '/dashboard' || pathname === '/demo') {
    return <ClassroomLayout><ClassInsights key="dashboard" mode="dashboard" /></ClassroomLayout>;
  }
  if (pathname === '/mistakes' || pathname.startsWith('/mistakes/')) {
    return <ClassroomLayout><ClassInsights key="search" mode="search" /></ClassroomLayout>;
  }
  if (pathname === '/settings') {
    return <ClassroomLayout><ClassInsights key="settings" mode="settings" /></ClassroomLayout>;
  }
  return <ClassroomLayout><ClassroomPage /></ClassroomLayout>;
}

import { useContext } from 'react';
import { ReadOnlyStyleContext } from '../../app/preferences';

export function ReadOnlyLabel() {
  const style = useContext(ReadOnlyStyleContext);
  return <span className={'readonly-label ' + (style === 'prominent' ? 'readonly-prominent' : '')}>只读</span>;
}

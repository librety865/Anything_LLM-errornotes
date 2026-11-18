import { useId, useState } from 'react';

type WorkspaceSettings = Record<string, unknown>;
type Props = {
  workspaceName: string;
  load: () => Promise<WorkspaceSettings>;
  save: (changes: WorkspaceSettings) => Promise<WorkspaceSettings>;
};

const providers = ['openai', 'anthropic', 'gemini', 'deepseek', 'ollama', 'lmstudio', 'generic-openai',
  'azure', 'openrouter', 'groq', 'mistral', 'cohere', 'togetherai', 'xai', 'anythingllm-router'];
const fields = [
  { key: 'openAiPrompt', label: '系统提示词', type: 'textarea' },
  { key: 'queryRefusalResponse', label: '资料不足时的回复', type: 'textarea' },
  { key: 'openAiTemp', label: '温度', type: 'number', min: 0, max: 2, step: 'any' },
  { key: 'openAiHistory', label: '历史消息数', type: 'number', min: 0, step: 1 },
  { key: 'similarityThreshold', label: '检索相似度阈值', type: 'number', min: 0, max: 1, step: 'any' },
  { key: 'topN', label: '检索片段数', type: 'number', min: 1, step: 1 },
  { key: 'vectorSearchMode', label: '向量检索模式', type: 'select', options: ['default', 'rerank'] },
  { key: 'agentProvider', label: '智能体提供商（标识）', type: 'text' },
  { key: 'agentModel', label: '智能体模型（标识）', type: 'text' },
  { key: 'router_id', label: '模型路由 ID', type: 'number', min: 1, step: 1 },
] as const;

export function WorkspaceModelSettings({ workspaceName, load, save }: Props) {
  const modelsId = useId();
  const [settings, setSettings] = useState<WorkspaceSettings>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current = (key: string) => String(settings?.[key] ?? (key === 'chatProvider' ? 'default' : ''));
  const get = (key: string) => draft[key] ?? current(key);
  const set = (key: string, value: string) => setDraft(old => ({ ...old, [key]: value }));
  const provider = get('chatProvider');
  const useModel = provider !== 'default' && provider !== 'anythingllm-router';
  const modelOptions = (Array.isArray(settings?.availableModels) ? settings.availableModels : [])
    .filter((item): item is { provider: string; model: string } => item?.provider === provider && typeof item.model === 'string')
    .map(item => item.model);
  const modelChanged = 'chatProvider' in draft || 'chatModel' in draft;
  const needsModel = modelChanged && useModel && !get('chatModel').trim();
  const run = async (action: () => Promise<WorkspaceSettings>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      setSettings(previous => ({ ...previous, ...result }));
      setDraft({});
      setMessage(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel settings">
    <h2>AnythingLLM 模型与工作区设置</h2>
    <p>目标工作区：{workspaceName}。保存后，使用这个工作区的应用和班级会采用新配置。</p>
    <button type="button" disabled={busy || !!Object.keys(draft).length}
      onClick={() => void run(load, '已读取当前配置。')}>{busy ? '正在与 AnythingLLM 通信…' : '读取当前配置'}</button>
    {settings && <form onSubmit={event => {
      event.preventDefault();
      const changes: WorkspaceSettings = {};
      const changed = (key: string) => key in draft && get(key) !== current(key);
      for (const field of fields) {
        if (!changed(field.key) || (field.key === 'router_id' && provider !== 'anythingllm-router')) continue;
        const value = get(field.key).trim();
        changes[field.key] = field.type === 'number' ? (value === '' ? null : Number(value)) : (value || null);
      }
      if (changed('chatProvider') || changed('chatModel')) {
        changes.chatProvider = provider;
        changes.chatModel = useModel ? get('chatModel').trim() : null;
      }
      if (provider !== 'anythingllm-router') delete changes.router_id;
      if (!Object.keys(changes).length) {
        setDraft({});
        setMessage('配置没有变化。');
        return;
      }
      void run(() => save(changes), '已保存到 AnythingLLM。');
    }}>
      <fieldset disabled={busy}>
        <label>模型提供商
          <select value={provider} onChange={event => {
            const value = event.target.value;
            setDraft(old => ({ ...old, chatProvider: value, chatModel: value === current('chatProvider') ? current('chatModel') : '' }));
          }}>
            <option value="default">继承 AnythingLLM 默认模型</option>
            {[...new Set([...providers, current('chatProvider')])].filter(value => value !== 'default').map(value =>
              <option key={value} value={value}>{value}</option>)}
            <option value="__custom__">其他提供商</option>
            {provider !== '__custom__' && provider !== 'default' && !providers.includes(provider) && provider !== current('chatProvider') &&
              <option value={provider}>{provider}</option>}
          </select>
        </label>
        {(provider === '__custom__' || (provider !== 'default' && !providers.includes(provider))) &&
          <label>提供商标识<input maxLength={100} required value={provider === '__custom__' ? '' : provider}
            onChange={event => set('chatProvider', event.target.value || '__custom__')} /></label>}
        {useModel && <label>AI 大模型
          <input list={modelsId} maxLength={300} value={get('chatModel')}
            placeholder="选择已使用的模型，或填写模型 ID" onChange={event => set('chatModel', event.target.value)} />
          <datalist id={modelsId}>{[...new Set(modelOptions)].map(model => <option key={model} value={model} />)}</datalist>
        </label>}
        <details><summary>高级工作区设置</summary>
          {fields.filter(field => field.key !== 'router_id' || provider === 'anythingllm-router').map(field =>
            <label key={field.key}>{field.label}
              {field.type === 'textarea' ? <textarea rows={3} maxLength={12000} value={get(field.key)} onChange={event => set(field.key, event.target.value)} />
                : field.type === 'select' ? <select value={get(field.key)} onChange={event => set(field.key, event.target.value)}>
                    <option value="" disabled>请选择</option>
                    {(field.options as readonly string[]).map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                : <input type={field.type} value={get(field.key)} onChange={event => set(field.key, event.target.value)}
                    min={'min' in field ? field.min : undefined} max={'max' in field ? field.max : undefined}
                    step={'step' in field ? field.step : undefined} maxLength={field.type === 'text' ? 300 : undefined} />}
            </label>)}
        </details>
        <button type="submit" disabled={!Object.keys(draft).length || provider === '__custom__' || needsModel}>保存到 AnythingLLM</button>
        <button type="button" disabled={!Object.keys(draft).length} onClick={() => setDraft({})}>放弃更改</button>
      </fieldset>
    </form>}
    {typeof settings?.adminUrl === 'string' && settings.adminUrl &&
      <p><a href={settings.adminUrl} target="_blank" rel="noreferrer">打开 AnythingLLM 管理界面</a>，管理实例默认模型、提供商凭据、嵌入模型等全局设置。</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

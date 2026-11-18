const states = ['待确认', '加工中', '已加工', '加工失败'];
const palette = ['#315dc8', '#078474', '#b36621', '#8256b4', '#d05c6f', '#346d87', '#626e84'];
const selections = [
  ['studentId', '学生'], ['subject', '学科'], ['module', '模块'], ['questionType', '题型'],
  ['tag', '错因标签'], ['difficulty', '难度'], ['status', '状态'],
];
const columns = [
  ['studentName', '学生'], ['question', '题目摘要'], ['subject', '学科'], ['module', '模块'],
  ['questionType', '题型'], ['difficulty', '难度'], ['status', '状态'], ['updatedAt', '更新时间'],
];

function buckets(rows, read) {
  const totals = new Map();
  for (const row of rows) {
    for (const value of new Set(read(row))) totals.set(value, (totals.get(value) || 0) + 1);
  }
  return [...totals].sort((a, b) => b[1] - a[1]);
}

export function filterClassRecords(records, params) {
  const keyword = (params.get('keyword') || '').toLowerCase().trim();
  return records.filter(row => (!keyword || [row.question, row.studentName, ...row.errorTags].join(' ').toLowerCase().includes(keyword))
    && selections.every(([field]) => {
      const selected = params.get(field);
      return !selected || (field === 'tag' ? selected === '__missing' ? !row.errorTags.length : row.errorTags.includes(selected)
        : selected === '__missing' ? !row[field] : String(row[field] ?? '') === selected);
    })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

const preferenceKey = 'zhixu.teacher.live.preferences';
function readPreferences() {
  const defaults = { filters: '', chartLabels: true, readOnlyStyle: 'compact' };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(preferenceKey) || '{}') }; }
  catch { return defaults; }
}

export function createClassInsights(React, useLocation, useNavigate, renderMathText) {
  const { createElement: h, useEffect, useState } = React;

  async function request(key, endpoint, signal, value) {
    const query = value ? '?' + new URLSearchParams(value) : '';
    const response = await fetch('/api/classroom/teacher/' + endpoint + query, {
      headers: { Authorization: 'Bearer ' + key },
      signal,
    });
    const result = await response.json().catch(() => null);
    if (response.status === 404 && result?.error === '接口不存在' && endpoint === 'class-insights') {
      throw new Error('当前班级服务版本不支持班级看板。请停止旧班级服务，再打开新版教师端。');
    }
    if (!response.ok || !result) throw new Error(result?.error || '班级服务未返回数据，请确认已启动新版班级服务。');
    return result;
  }

  function Chart({ title, rows, onSelect, chartLabels }) {
    const total = rows.reduce((sum, row) => sum + row[1], 0);
    let cursor = 0;
    const slices = rows.filter(row => row[1]).map(([label, count], index) => {
      const color = palette[index % palette.length];
      const start = cursor;
      cursor += count / total * 100;
      return { label, count, color, stops: color + ' ' + start + '% ' + cursor + '%' };
    });
    return h('section', { className: 'panel chart-panel' },
      h('h2', null, title),
      total ? h(React.Fragment, null,
        h('div', { className: 'class-insight-pie', 'aria-hidden': 'true',
          style: { background: 'conic-gradient(' + slices.map(slice => slice.stops).join(',') + ')' } }),
        h('ul', { className: 'chart-legend' }, slices.map(({ label, count, color }) =>
          h('li', { key: label },
            h('button', { type: 'button', onClick: () => onSelect(label),
              title: label + ' · ' + count + ' 条 · ' + (count / total * 100).toFixed(1) + '%' },
              h('span', { className: 'legend-dot', style: { background: color } }),
              h('span', null, label + (chartLabels ? ' · ' + (count / total * 100).toFixed(1) + '%' : '')), h('strong', null, count))))))
        : h('p', { className: 'request-state' }, '暂无统计。'));
  }

  return function ClassInsights({ mode }) {
    const location = useLocation();
    const navigate = useNavigate();
    const [key] = useState(() => sessionStorage.getItem('zhixu.teacher.session'));
    const [classes, setClasses] = useState(null);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [snapshot, setSnapshot] = useState(null);
    const [preferred] = useState(() => localStorage.getItem('zhixu.teacher.currentClass'));
    const [preferences, setPreferences] = useState(readPreferences);
    const [settingsMessage, setSettingsMessage] = useState('');
    const settingsPage = mode === 'settings';
    const params = new URLSearchParams(location.search || (mode !== 'search' ? preferences.filters : ''));
    const selected = (classes || []).find(item => item.id === (params.get('classId') || preferred)) || classes?.[0];

    useEffect(() => {
      if (!key) return;
      const controller = new AbortController();
      setError('');
      request(key, 'classes', controller.signal).then(rows => {
        if (!controller.signal.aborted) setClasses(rows);
      }).catch(failure => { if (!controller.signal.aborted) setError(String(failure)); });
      return () => controller.abort();
    }, [key, reload]);

    const selectedId = selected?.id;
    useEffect(() => {
      if (!key || !selectedId) return;
      const controller = new AbortController();
      let inFlight = false;
      async function update() {
        if (inFlight) return;
        inFlight = true;
        try {
          const value = await request(key, 'class-insights', controller.signal, { classId: selectedId });
          if (!controller.signal.aborted) { setSnapshot(value); setError(''); }
        } catch (failure) {
          if (!controller.signal.aborted) setError(String(failure));
        } finally { inFlight = false; }
      }
      void update();
      const timer = window.setInterval(update, 10000);
      return () => { controller.abort(); window.clearInterval(timer); };
    }, [key, selectedId, reload]);

    const dashboard = mode === 'dashboard';
    const route = settingsPage ? '/settings' : dashboard ? '/dashboard' : '/mistakes';
    function change(name, value, target = route) {
      setSettingsMessage('');
      const next = new URLSearchParams(params);
      if (name === 'classId') for (const field of [...next.keys()]) if (field !== 'classId') next.delete(field);
      next.delete('page');
      if (value) next.set(name, value);
      else next.delete(name);
      if (selectedId && !next.has('classId')) next.set('classId', selectedId);
      navigate(target + (next.size ? '?' + next : ''), { replace: target === route });
    }

    const title = settingsPage ? '偏好设置' : dashboard ? '班级看板' : '错题检索';
    const labelStyle = 'readonly-label' + (preferences.readOnlyStyle === 'prominent' ? ' readonly-prominent' : '');
    const heading = h('header', { className: 'page-heading' }, h('h1', null, title), h('span', { className: labelStyle }, '只读'));
    if (!key) return h(React.Fragment, null, heading,
      h('p', { className: 'request-state' }, '请先在「我的班级」登录教师端。 ', h('a', { href: '#/classroom' }, '前往登录')));

    const errorNotice = error && h('div', { className: 'request-state request-error', role: 'alert' }, error,
      h('button', { type: 'button', className: 'button', onClick: () => setReload(value => value + 1) }, '重试读取'));
    const classSelect = classes?.length ? h('label', null, '选择班级', h('select', {
      value: selectedId, onChange: event => change('classId', event.currentTarget.value),
    }, classes.map(item => h('option', { key: item.id, value: item.id }, item.name)))) : null;
    const selector = h('section', { className: 'panel filter-panel' },
      h('div', { className: 'filter-grid' }, classSelect),
      selected && h('p', null, '当前班级：', h('strong', null, selected.name)));
    const data = snapshot?.classId === selectedId ? snapshot : null;
    if (!data || !selected) return h(React.Fragment, null, heading, classSelect && selector, errorNotice,
      !error && h('p', { className: 'request-state', role: 'status' },
        classes?.length === 0 ? '还没有创建班级。' : '正在读取班级数据…'),
      classes?.length === 0 && h('a', { href: '#/classroom' }, '去创建班级'));

    const raw = data.records;
    const filtered = selections.some(([field]) => params.has(field)) || Boolean(params.get('keyword')?.trim());
    const records = filterClassRecords(raw, params);

    function choices(field) {
      if (field === 'studentId') return data.students.map(student => [student.id, student.name]);
      if (field === 'status') return states.map(value => [value, value]);
      if (field === 'difficulty') return ['1', '2', '3', '4', '5'].map(value => [value, value + ' 级']);
      const values = new Set(raw.flatMap(row => field === 'tag' ? row.errorTags : [row[field]]).filter(Boolean));
      const options = [...values].map(value => [value, value]);
      if (raw.some(row => field === 'tag' ? !row.errorTags.length : !row[field])) options.push(['__missing', '未标注']);
      return options;
    }
    const filters = h('section', { className: 'panel filter-panel' }, h('div', { className: 'filter-grid' },
      ...selections.map(([field, label]) => h('label', { key: field }, label, h('select', {
        value: params.get(field) || '', onChange: event => change(field, event.currentTarget.value),
      }, h('option', { value: '' }, '全部'), choices(field).map(([value, caption]) => h('option', { key: value, value }, caption))))),
      h('label', null, '搜索题目或学生', h('input', { type: 'search', value: params.get('keyword') || '',
        onChange: event => change('keyword', event.currentTarget.value) }))));
    if (settingsPage) {
      return h(React.Fragment, null, heading, errorNotice,
        h('h2', { className: 'section-heading' }, '班级看板的默认筛选'),
        selector, filters,
        h('section', { className: 'panel settings-panel' },
          h('h2', null, '图表与只读提示'),
          h('label', { className: 'check-label' }, h('input', {
            type: 'checkbox', checked: preferences.chartLabels, onChange: event => {
              setPreferences({ ...preferences, chartLabels: event.currentTarget.checked });
              setSettingsMessage('');
            },
          }), '显示分布占比'),
          h('label', null, '只读提示样式',
            h('select', { value: preferences.readOnlyStyle, onChange: event => {
              setPreferences({ ...preferences, readOnlyStyle: event.currentTarget.value });
              setSettingsMessage('');
            } }, h('option', { value: 'compact' }, '简洁'), h('option', { value: 'prominent' }, '醒目'))),
          h('button', { type: 'button', className: 'button primary', onClick: () => {
            const next = new URLSearchParams(params);
            next.set('classId', selectedId);
            next.delete('page');
            try {
              const saved = { ...preferences, filters: next.toString() };
              localStorage.setItem(preferenceKey, JSON.stringify(saved));
              setPreferences(saved);
              setSettingsMessage('已保存真实班级看板偏好。');
            } catch { setSettingsMessage('保存偏好失败，请重试。'); }
          } }, '保存教师偏好'),
          settingsMessage && h('p', { role: 'status' }, settingsMessage)));
    }

    const totals = data.students.reduce((sum, { progress }) => {
      for (const field of ['total', 'processed', 'pending', 'failed', 'processing']) sum[field] += progress?.[field] || 0;
      return sum;
    }, { total: 0, processed: 0, pending: 0, failed: 0, processing: 0 });
    const waiting = data.students.filter(student => !student.indexed).length;
    const coverage = waiting || raw.length < totals.total ? h('p', { className: 'request-state' },
      '当前可检索 ' + raw.length + ' 道，班级统计共 ' + totals.total + ' 道。' +
      (waiting ? ' 有 ' + waiting + ' 名学生尚未同步错题索引。' : '') +
      ' 每名学生最多同步最近 500 道错题。') : null;

    const stats = dashboard && h('dl', { className: 'metrics' },
      ...[
        ['学生数', filtered ? new Set(records.map(row => row.studentId)).size : data.students.length],
        ['错题数', filtered ? records.length : totals.total],
        ['待确认', filtered ? records.filter(row => row.status === '待确认').length : totals.pending],
        ['已加工', filtered ? records.filter(row => row.status === '已加工').length : totals.processed],
      ].map(([label, count]) => h('div', { key: label, className: 'panel metric' },
        h('dt', null, label), h('dd', null, count))));

    const charts = dashboard && h('div', { className: 'charts' },
      ...[
        ['错因标签分布', 'tag', buckets(records, row => row.errorTags.length ? row.errorTags : ['未标注'])],
        ['学科分布', 'subject', buckets(records, row => [row.subject || '未标注'])],
        ['难度分布', 'difficulty', buckets(records.filter(row => row.difficulty), row => [String(row.difficulty)])],
        ['状态分布', 'status', filtered ? buckets(records, row => [row.status])
          : states.map((label, index) => [label, totals[['pending', 'processing', 'processed', 'failed'][index]]])],
      ].map(([title, field, rows]) => h(Chart, { key: field, title, rows, chartLabels: preferences.chartLabels,
        onSelect: value => change(field, value === '未标注' ? '__missing' : value, '/mistakes') })));

    const pageCount = Math.max(1, Math.ceil(records.length / 20));
    const page = Math.max(1, Math.min(Number.parseInt(params.get('page') || '1', 10) || 1, pageCount));
    function pageTo(number) {
      const next = new URLSearchParams(params);
      next.set('page', String(number));
      navigate(route + '?' + next, { replace: true });
    }
    const list = !dashboard && (records.length ? h('section', { className: 'panel table-panel' },
      h('div', { className: 'table-scroll' }, h('table', null,
        h('thead', null, h('tr', null, columns.map(([field, label]) => h('th', { key: field, scope: 'col' }, label)))),
        h('tbody', null, records.slice((page - 1) * 20, page * 20).map(row =>
          h('tr', { key: row.studentId + ':' + row.id },
            ...columns.map(([field]) => h('td', { key: field }, field === 'question'
              ? renderMathText(h, row.question || '—')
              : field === 'updatedAt' ? (row.updatedAt || '').slice(0, 10) || '—' : row[field] || '—'))))))),
      h('nav', { className: 'pagination', 'aria-label': '错题分页' },
        h('span', null, '共 ' + records.length + ' 条 · ' + page + '/' + pageCount + ' 页'),
        h('button', { className: 'button', disabled: page === 1, type: 'button', onClick: () => pageTo(page - 1) }, '上一页'),
        h('button', { className: 'button', disabled: page === pageCount, type: 'button', onClick: () => pageTo(page + 1) }, '下一页')))
      : h('p', { className: 'request-state' }, '这个班级暂无符合条件的已同步错题。'));

    return h(React.Fragment, null, heading, selector, errorNotice, filters, coverage, stats, charts, list);
  };
}

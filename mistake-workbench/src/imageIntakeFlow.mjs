const instruction = '按附件顺序识别全部图片，每张从 1 开始编号。一张图可以有多道题，必须逐题拆分。只转录题面、参考答案和学生手写作答，不解题，不猜测看不清的内容。输出 JSON {pages:[{imageIndex:1,questions:[{questionText:string,referenceText:string,handwrittenText:string}],warning:string}]}。每张图片都应有一条 pages 记录。没有参考答案或作答则填空字符串；无题目则 questions 为空并说明原因。数学符号使用规范形式，例如 x²、½，复杂公式用 LaTeX 数学定界符。如果图中明显有一道题但题干看不清，仍返回一项题目，questionText 置空。';

export function createImageIntake(React, dependencies) {
  const { createElement: h, useEffect, useRef, useState } = React;
  const { api, membership, workspaceChat, mock, initialWorkspace, scope, parseText, saveOriginal, compress } = dependencies;

  return function ImageIntake({ disabled, onUpload, onBusyChange, handwriting = false }) {
    const [photos, setPhotos] = useState([]);
    const [message, setMessage] = useState('');
    const [working, setWorking] = useState(false);
    const [hasInk, setHasInk] = useState(false);
    const alive = useRef(true);
    const lock = useRef(false);
    const urls = useRef(new Set());
    const canvas = useRef(null);
    const stroke = useRef(null);

    useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
        for (const url of urls.current) URL.revokeObjectURL(url);
        urls.current.clear();
      };
    }, []);

    function update(id, patch) {
      if (alive.current) setPhotos(rows => rows.map(photo => photo.id === id ? { ...photo, ...patch } : photo));
    }
    function setRunning(value) {
      lock.current = value;
      if (!alive.current) return;
      setWorking(value);
      onBusyChange(value);
    }

    async function processPhotos(queue) {
      if (lock.current || disabled) return;
      setRunning(true);
      const isCurrent = api.capture();
      const prepared = [];
      const readyToSubmit = [];
      let submitted = false;
      try {
        const workspace = scope(initialWorkspace());
        const joined = membership(workspace.workspace_id);
        if ((mock && !joined) || (!workspace.slug && !joined)) {
          throw new Error('请连接支持图片的 AnythingLLM 工作区，或加入已配置共享工作区的班级。');
        }

        for (const photo of queue) {
          if (!alive.current || !isCurrent()) return;
          update(photo.id, { status: '正在准备图片', error: '' });
          try {
            const contentString = await compress(photo.file);
            prepared.push({ photo, attachment: { name: '图片' + (prepared.length + 1) + ' - ' + photo.file.name,
              mime: 'image/jpeg', contentString } });
          } catch (error) {
            update(photo.id, { status: '识别失败', error: String(error) });
          }
        }
        if (!prepared.length || !alive.current || !isCurrent()) return;

        for (const { photo } of prepared) update(photo.id, { status: '批量识别中' });
        const raw = await workspaceChat(workspace, instruction, prepared.map(item => item.attachment));
        if (!alive.current || !isCurrent()) return;
        let result;
        try { result = parseText(raw); }
        catch { throw new Error('识别结果无法读取，请重试。'); }
        const pages = Array.isArray(result?.pages) ? result.pages : prepared.length === 1 && Array.isArray(result?.questions)
          ? [{ imageIndex: 1, questions: result.questions, warning: result.warning }] : null;
        if (!pages) throw new Error('识别结果缺少图片编号，请重试。');

        const items = [];
        for (const [index, { photo }] of prepared.entries()) {
          if (!alive.current || !isCurrent()) return;
          try {
            const matches = pages.filter(page => Number(page?.imageIndex) === index + 1);
            const page = matches.length === 1 ? matches[0] : null;
            if (!page || !Array.isArray(page.questions)) throw new Error('未收到这张图片对应的识别结果。');
            if (!page.questions.length) throw new Error(typeof page.warning === 'string' && page.warning || '未识别到题目，请重试。');
            if (!page.questions.every(question => typeof question?.questionText === 'string'
              && typeof question.referenceText === 'string' && typeof question.handwrittenText === 'string')) {
              throw new Error('识别字段缺失，请重试。');
            }

            const originalImageId = (workspace.workspace_id || workspace.slug) + ':' + photo.id;
            await saveOriginal(originalImageId, photo.file);
            if (!alive.current || !isCurrent()) return;
            items.push(...page.questions.map(question => ({
              examType: '', workspace_id: workspace.workspace_id, subject: '', module: '', questionType: '',
              difficulty: 3, originalQuestion: question.questionText.trim() || "【图片题干未能识别】", userAnswer: question.handwrittenText,
              referenceAnswer: question.referenceText,
              images: [{ id: photo.id, name: photo.file.name, originalImageId,
                questionText: question.questionText, handwrittenText: question.handwrittenText,
                referenceText: question.referenceText, confirmed: false }],
            })));
            readyToSubmit.push({ photo, count: page.questions.length });
          } catch (error) {
            update(photo.id, { status: '识别失败', error: String(error) });
          }
        }

        if (!items.length || !alive.current || !isCurrent()) return;
        for (const { photo } of readyToSubmit) update(photo.id, { status: '已识别 · 正在批量提交加工' });
        submitted = true;
        await onUpload(items);
        for (const { photo, count } of readyToSubmit) update(photo.id, { status: '已存入错题本 · ' + count + ' 道' });
      } catch (error) {
        if (!alive.current || !isCurrent()) return;
        const affected = submitted ? readyToSubmit.map(item => item.photo)
          : prepared.length ? prepared.map(item => item.photo) : queue;
        for (const photo of affected) update(photo.id, {
          status: submitted ? '提交未完成' : '识别失败',
          error: submitted ? '请先在错题记录中检查是否已经入库。' + String(error) : String(error),
        });
      } finally {
        setRunning(false);
      }
    }

    function add(files) {
      if (disabled || lock.current || !files.length) return;
      if (files.length > 6) {
        setMessage('一次最多上传 6 张图片，请分批选择。');
        return;
      }
      const queue = [];
      const errors = [];
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
          errors.push(file.name + '：请选择 12MB 以内的 JPG、PNG 或 WebP 图片。');
          continue;
        }
        const preview = URL.createObjectURL(file);
        urls.current.add(preview);
        queue.push({ id: crypto.randomUUID(), file, preview, status: '等待识别', error: '' });
      }
      const stalePreviews = photos.filter(photo => !['识别失败','提交未完成'].includes(photo.status));
      for (const photo of stalePreviews) {
        URL.revokeObjectURL(photo.preview);
        urls.current.delete(photo.preview);
      }
      setPhotos(previous => [...previous.filter(photo => ['识别失败','提交未完成'].includes(photo.status)), ...queue]);
      setMessage(errors.join('；'));
      if (queue.length) void processPhotos(queue);
    }

    function draw(event, starting) {
      if (working || disabled || (!starting && stroke.current !== event.pointerId)) return;
      const node = canvas.current;
      const context = node?.getContext('2d');
      if (!context) return;
      const bounds = node.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * node.width / bounds.width;
      const y = (event.clientY - bounds.top) * node.height / bounds.height;
      context.strokeStyle = '#1e293b';
      context.lineWidth = 4;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      if (starting) {
        if (stroke.current !== null || event.button !== 0) return;
        node.setPointerCapture(event.pointerId);
        stroke.current = event.pointerId;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 0.01, y);
        setHasInk(true);
      } else {
        context.lineTo(x, y);
      }
      context.stroke();
    }

    function uploadDrawing() {
      const node = canvas.current;
      if (!node || !hasInk || working || disabled) return;
      const image = document.createElement('canvas');
      image.width = node.width;
      image.height = node.height;
      const context = image.getContext('2d');
      if (!context) return;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, image.width, image.height);
      context.drawImage(node, 0, 0);
      image.toBlob(blob => {
        if (!blob || !alive.current || lock.current) return;
        add([new File([blob], '手写错题.png', { type: 'image/png' })]);
        node.getContext('2d')?.clearRect(0, 0, node.width, node.height);
        setHasInk(false);
      }, 'image/png');
    }

    const blocked = working || disabled;
    function fromInput(event) {
      add(Array.from(event.currentTarget.files || []));
      event.currentTarget.value = '';
    }

    return h('section', {
      className: 'panel mb-5', tabIndex: handwriting ? undefined : 0,
      onDragOver: handwriting ? undefined : event => event.preventDefault(),
      onDrop: handwriting ? undefined : event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); },
      onPaste: handwriting ? undefined : event => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) { event.preventDefault(); add(files); }
      },
    },
      h('h2', null, handwriting ? '在屏幕上手写' : '拍照或选择图片'),
      h('p', null, handwriting ? '写好后点击「上传手写内容」，识别成功后自动存入当前错题本。'
        : '选择、拖入或粘贴图片后会自动识别并存入当前错题本。支持 JPG、PNG、WebP，一次最多 6 张。'),
      handwriting
        ? h(React.Fragment, null,
            h('canvas', { ref: canvas, width: 1100, height: 430, 'aria-label': '手写错题区',
              style: { width: '100%', maxWidth: '60rem', display: 'block', background: '#fff', border: '1px solid #bdc9db',
                borderRadius: '8px', touchAction: 'none' },
              onPointerDown: event => draw(event, true), onPointerMove: event => draw(event, false),
              onLostPointerCapture: event => { if (stroke.current === event.pointerId) stroke.current = null; },
            }),
            h('div', { className: 'actions' },
              h('button', { type: 'button', disabled: blocked || !hasInk, onClick: () => {
                const node = canvas.current;
                node?.getContext('2d')?.clearRect(0, 0, node.width, node.height);
                setHasInk(false);
              } }, '清空手写'),
              h('button', { type: 'button', className: 'primary', disabled: blocked || !hasInk, onClick: uploadDrawing }, '上传手写内容')))
        : h(React.Fragment, null,
            h('label', null, '相册 / 文件', h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp',
              multiple: true, disabled: blocked, onChange: fromInput })),
            h('label', null, '拍照', h('input', { type: 'file', accept: 'image/*', capture: 'environment',
              disabled: blocked, onChange: fromInput }))),
      message && h('p', { role: 'status' }, message),
      photos.map(photo => h('article', { className: 'variant my-4', key: photo.id },
        h('img', { src: photo.preview, alt: photo.file.name, style: { maxHeight: 180, maxWidth: '100%', objectFit: 'contain' } }),
        h('p', { role: 'status' }, photo.file.name + ' · ' + photo.status),
        photo.error && h('p', { role: 'alert' }, photo.error),
        photo.status === '识别失败' && h('button', { type: 'button', disabled: blocked, onClick: () => void processPhotos([photo]) }, '重试识别'),
        !working && h('button', { type: 'button', onClick: () => {
          URL.revokeObjectURL(photo.preview);
          urls.current.delete(photo.preview);
          setPhotos(rows => rows.filter(row => row.id !== photo.id));
        } }, '关闭预览'))));
  };
}

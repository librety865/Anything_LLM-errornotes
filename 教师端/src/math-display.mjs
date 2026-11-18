const symbols = {
  int: '∫', iint: '∬', sum: '∑', prod: '∏', infty: '∞', times: '×', cdot: '·', div: '÷',
  pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  to: '→', rightarrow: '→', in: '∈', partial: '∂', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', mid: '∣',
  lvert: '|', rvert: '|', lbrace: '{', rbrace: '}',
};
const operators = new Set(['ln', 'log', 'lim', 'sin', 'cos', 'tan', 'exp', 'min', 'max']);
const delimiters = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\r\n]+\$)/g;
const texCommands = /\\(?:frac|dfrac|tfrac|sqrt|int|sum|lim|left|right|ln|log|sin|cos|times|begin)\b/;
const simpleMath = /(?<![\w.])(?:(?:[A-Za-z]|\d+(?:\.\d+)?)(?:\^\{?[-+]?\d+\}?|_\{?\d+\}?)(?:\s*\/\s*(?:[A-Za-z]|\d+(?:\.\d+)?))?|(?:[A-Za-z]|\d+(?:\.\d+)?)\s*\/\s*(?:[A-Za-z]|\d+(?:\.\d+)?))(?![\w./])/g;

function parseMath(h, source) {
  const text = source.replace(/\\(?:left|right)\b/g, '').replace(/\\(?:,|;|:|!|quad\b|qquad\b)/g, ' ');
  const tokens = text.match(/\\[A-Za-z]+|\\[^A-Za-z]|[0-9]+(?:\.[0-9]+)?|[^\s]/gu) || [];
  let index = 0;
  const row = parts => h('mrow', null, ...parts);
  function atom(depth) {
    if (depth > 24) throw new Error('Formula groups are too deeply nested');
    const token = tokens[index++];
    if (!token) return row([]);
    if (token === '{') {
      const value = expression(depth + 1, '}');
      if (tokens[index] === '}') index++;
      return value;
    }
    if (token.startsWith('\\')) {
      const name = token.slice(1);
      if (['frac', 'dfrac', 'tfrac'].includes(name)) return h('mfrac', null, atom(depth + 1), atom(depth + 1));
      if (name === 'sqrt') {
        if (tokens[index] !== '[') return h('msqrt', null, atom(depth + 1));
        index++;
        const degree = expression(depth + 1, ']');
        if (tokens[index] === ']') index++;
        return h('mroot', null, atom(depth + 1), degree);
      }
      if (name === 'text' || name === 'mathrm') {
        if (tokens[index] !== '{') return atom(depth + 1);
        index++;
        let value = '';
        while (index < tokens.length && tokens[index] !== '}') value += tokens[index++];
        if (tokens[index] === '}') index++;
        return h('mtext', null, value);
      }
      if (operators.has(name)) return h('mi', { mathvariant: 'normal' }, name);
      if (symbols[name]) return h(/^[α-ω]$/u.test(symbols[name]) ? 'mi' : 'mo', null, symbols[name]);
      return h('mtext', null, name);
    }
    if (/^\d/.test(token)) return h('mn', null, token);
    if (/^\p{L}$/u.test(token)) return h('mi', null, token);
    return h('mo', null, token === '-' ? '−' : token === '*' ? '×' : token);
  }
  function signedAtom(depth) {
    if (tokens[index] === '-' || tokens[index] === '+') {
      return row([atom(depth), atom(depth)]);
    }
    return atom(depth);
  }
  function term(depth) {
    let base = atom(depth);
    let superscript;
    let subscript;
    while (tokens[index] === '^' || tokens[index] === '_') {
      const marker = tokens[index++];
      if (marker === '^') superscript = signedAtom(depth + 1);
      else subscript = signedAtom(depth + 1);
    }
    if (subscript && superscript) base = h('msubsup', null, base, subscript, superscript);
    else if (subscript) base = h('msub', null, base, subscript);
    else if (superscript) base = h('msup', null, base, superscript);
    return base;
  }
  function expression(depth = 0, until) {
    const parts = [];
    while (index < tokens.length && tokens[index] !== until) {
      let value = term(depth);
      while (tokens[index] === '/' && tokens[index + 1] && tokens[index + 1] !== until) {
        index++;
        value = h('mfrac', null, value, term(depth + 1));
      }
      parts.push(value);
    }
    return row(parts);
  }
  return expression();
}

export function renderMathText(h, value) {
  const text = String(value ?? '');
  function equation(content, key, block = false) {
    if (content.length > 2500) return content;
    try {
      const clean = content.trim().replace(/^\\begin\{(?:align\*?|aligned)\}/, '').replace(/\\end\{(?:align\*?|aligned)\}$/, '');
      const lines = clean.split(/\\\\|\r?\n/).map(line => line.replace(/&/g, '').replace(/\\\s*$/, '').trim()).filter(Boolean);
      if (lines.length > 1) {
        return h('math', { key, display: 'block', style: { textAlign: 'left' } },
          h('mtable', { columnalign: 'left' }, ...lines.map(line =>
            h('mtr', null, h('mtd', null, parseMath(h, line))))));
      }
      return h('math', { key, display: block ? 'block' : 'inline', style: { textAlign: 'left' } }, parseMath(h, lines[0] || clean));
    } catch {
      return content;
    }
  }
  function plain(part, key) {
    return part.split(/(\r?\n)/).map((line, index) => {
      const lineKey = key + ':' + index;
      if (texCommands.test(line) && !/[\u3400-\u9fff]/.test(line)) return equation(line, lineKey);
      const elements = [];
      let cursor = 0;
      for (const match of line.matchAll(simpleMath)) {
        elements.push(line.slice(cursor, match.index), equation(match[0], lineKey + ':' + match.index));
        cursor = match.index + match[0].length;
      }
      return [...elements, line.slice(cursor)];
    }).flat();
  }
  const nodes = [];
  let cursor = 0;
  for (const match of text.matchAll(delimiters)) {
    nodes.push(...plain(text.slice(cursor, match.index), 'text-' + cursor));
    const block = match[0].startsWith('$$') || match[0].startsWith('\\[');
    const delimiter = match[0].startsWith('$$') || match[0].startsWith('\\') ? 2 : 1;
    nodes.push(equation(match[0].slice(delimiter, -delimiter), 'math-' + match.index, block));
    cursor = match.index + match[0].length;
  }
  return h('span', { style: { whiteSpace: 'pre-wrap' } }, ...nodes, ...plain(text.slice(cursor), 'text-' + cursor));
}

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const chooseBtn = document.getElementById('choose-btn');
const convertBtn = document.getElementById('convert-btn');
const statusEl = document.getElementById('status');
const dlBtn = document.getElementById('download-btn');
const fnInput = document.getElementById('filename-input');
const fmtBtns = document.querySelectorAll('.fmt-btn');
const platformPill = document.getElementById('platform-pill');

let selectedFile = null;
let selectedFmt = 'html';
let pendingBlob = null;
let pendingFilename = '';
let pendingMime = 'text/plain';
let pendingObjectUrl = null;
let detectedPlatform = null;

fmtBtns.forEach(btn => {
  btn.onclick = () => {
    fmtBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFmt = btn.dataset.fmt;
    dlBtn.style.display = 'none';
  };
});

dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('hovering'); };
dropzone.ondragleave = () => dropzone.classList.remove('hovering');
dropzone.ondrop = e => {
  e.preventDefault();
  dropzone.classList.remove('hovering');
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
};
dropzone.onclick = e => { if (!e.target.closest('#choose-btn')) return; fileInput.click(); };
chooseBtn.onclick = e => { e.stopPropagation(); fileInput.click(); };
fileInput.onchange = e => { if (e.target.files.length) setFile(e.target.files[0]); };

function setFile(file) {
  selectedFile = file;
  detectedPlatform = null;
  const base = file.name.replace(/\.[^.]+$/, '');
  document.getElementById('drop-title').textContent = '📎 ' + file.name;
  document.getElementById('drop-sub').textContent = (file.size / 1024).toFixed(1) + ' KB';
  if (!fnInput.value) fnInput.placeholder = base;
  platformPill.textContent = '감지 대기 중';
  convertBtn.disabled = false;
  dlBtn.style.display = 'none';
  setStatus('idle', '변환 버튼을 누르면 서비스 종류를 자동 판별합니다');
}

function setStatus(type, msg) {
  statusEl.className = 'status ' + type;
  statusEl.textContent = msg;
}

function setPlatformPill(text) {
  platformPill.textContent = text;
}

dlBtn.onclick = async e => {
  if (!pendingBlob) return;
  e.preventDefault();

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: pendingFilename,
        types: [{
          description: pendingMime === 'text/html' ? 'HTML file' : 'Text file',
          accept: { [pendingMime]: ['.' + pendingFilename.split('.').pop()] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(pendingBlob);
      await writable.close();
      setStatus('done', `저장 완료: ${pendingFilename}`);
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        setStatus('error', '저장 실패: ' + err.message);
      }
      return;
    }
  }

  if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
  pendingObjectUrl = URL.createObjectURL(pendingBlob);
  const tempLink = document.createElement('a');
  tempLink.href = pendingObjectUrl;
  tempLink.download = pendingFilename;
  tempLink.click();
};

convertBtn.onclick = async () => {
  if (!selectedFile) return;
  convertBtn.disabled = true;
  dlBtn.style.display = 'none';
  setPlatformPill('분석 중...');
  setStatus('working', 'MHTML을 분석하고 있습니다...');

  try {
    const buffer = await selectedFile.arrayBuffer();
    const raw = new Uint8Array(buffer);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
    const htmlContent = extractHtmlFromMHTML(text);
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    const source = detectPlatform(doc);

    detectedPlatform = source;
    setPlatformPill(`감지됨: ${source.label}`);
    setStatus('working', `${source.label} 형식으로 변환 중...`);

    const title = cleanTitle(doc.title || selectedFile.name.replace('.mhtml', ''));
    const turns = source.extract(doc);
    if (!turns.length) throw new Error(`${source.label} 메시지를 찾지 못했습니다.`);

    const ext = selectedFmt;
    const basename = fnInput.value.trim() || selectedFile.name.replace(/\.[^.]+$/, '');
    const filename = basename + '.' + ext;

    let result;
    if (ext === 'html') result = buildHtml(title, turns);
    else if (ext === 'md') result = buildMarkdown(title, turns);
    else result = buildTxt(turns);

    const mimeType = ext === 'html' ? 'text/html' : ext === 'md' ? 'text/markdown' : 'text/plain';
    pendingBlob = new Blob([result], { type: mimeType });
    pendingFilename = filename;
    pendingMime = pendingBlob.type || 'text/plain';
    dlBtn.removeAttribute('href');
    dlBtn.removeAttribute('download');
    dlBtn.textContent = `⬇ ${filename} 저장`;
    dlBtn.style.display = 'block';
    setStatus('done', `변환 완료: ${source.label} / ${turns.length} turns`);
  } catch (err) {
    setPlatformPill('감지 실패');
    setStatus('error', '오류: ' + err.message);
    console.error(err);
  }

  convertBtn.disabled = false;
};

function extractHtmlFromMHTML(text) {
  const m = text.match(/boundary="?([^";\s\r\n]+)"?/);
  if (!m) throw new Error('MHTML boundary를 찾을 수 없습니다.');
  const boundary = m[1];
  const parts = text.split('--' + boundary);
  const candidates = [];

  for (const part of parts) {
    if (!part.includes('Content-Type: text/html')) continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    let body = part.substring(headerEnd + 4);
    if (part.toLowerCase().includes('quoted-printable')) body = decodeQP(body);
    candidates.push(body);
  }

  if (!candidates.length) throw new Error('HTML 본문을 찾을 수 없습니다.');
  return candidates.sort((a, b) => b.length - a.length)[0];
}

function decodeQP(str) {
  const cleaned = str.replace(/=\r?\n/g, '');
  const bytes = [];
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i] === '=' && i + 2 < cleaned.length) {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(cleaned.charCodeAt(i));
    i++;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

function detectPlatform(doc) {
  const scores = [
    {
      id: 'gpt',
      label: 'ChatGPT',
      extract: extractChatGPT,
      score:
        doc.querySelectorAll('[data-message-author-role]').length * 5 +
        doc.querySelectorAll('.markdown').length
    },
    {
      id: 'gemini',
      label: 'Gemini',
      extract: extractGemini,
      score:
        doc.querySelectorAll('user-query').length * 5 +
        doc.querySelectorAll('message-content').length * 4 +
        doc.querySelectorAll('[data-math]').length
    },
    {
      id: 'grok',
      label: 'Grok',
      extract: extractGrok,
      score:
        doc.querySelectorAll('.r-imh66m').length * 5 +
        doc.querySelectorAll('.r-1kt6imw').length * 2
    }
  ].sort((a, b) => b.score - a.score);

  if (!scores[0] || scores[0].score <= 0) {
    throw new Error('GPT, Gemini, Grok 중 어떤 형식인지 판별하지 못했습니다.');
  }

  return scores[0];
}

const COMMON_NOISE = new Set([
  'script', 'style', 'button', 'svg', 'form', 'audio', 'img', 'video', 'canvas', 'textarea',
  'annotation', 'math', 'semantics', 'mrow', 'mn', 'mi', 'mo', 'mtext', 'mspace',
  'mtable', 'mtr', 'mtd', 'msub', 'msqrt', 'munder', 'mover', 'msup', 'moverunder',
  'mpadded', 'mphantom', 'merror'
]);

function extractChatGPT(doc) {
  const msgs = Array.from(doc.querySelectorAll('[data-message-author-role]'));
  const turns = [];
  const seen = new Set();

  msgs.forEach(msg => {
    const role = msg.getAttribute('data-message-author-role') === 'user' ? 'user' : 'model';
    let html = '';

    if (role === 'user') {
      const userNode = msg.querySelector('.whitespace-pre-wrap') || msg;
      html = textToHtml(userNode.textContent || '');
    } else {
      const modelNode = msg.querySelector('.markdown') || msg;
      const clone = modelNode.cloneNode(true);
      sanitizeChatGPTNode(clone);
      html = renderGenericNodeTree(clone, new Set(), { boldClass: null, treatDisplayBlockDiv: false });
      html = postProcess(html, false);
    }

    pushTurn(turns, seen, role, html);
  });

  return turns;
}

function sanitizeChatGPTNode(root) {
  root.querySelectorAll('button, svg, style, script, form, audio, img, video, canvas, textarea').forEach(el => el.remove());
  root.querySelectorAll('.katex-html, .sr-only').forEach(el => el.remove());
  root.querySelectorAll('[data-testid*="citation"], [data-testid*="copy"], [aria-label*="Copy"], [aria-label*="좋아요"], [aria-label*="싫어요"]').forEach(el => el.remove());

  root.querySelectorAll('.katex-mathml').forEach(el => {
    const ann = el.querySelector('annotation');
    if (!ann) {
      el.remove();
      return;
    }
    const formula = ann.textContent.trim();
    const wrapper = el.closest('.katex-display');
    const replacement = document.createElement(wrapper ? 'div' : 'span');
    if (wrapper) replacement.className = 'math-block';
    replacement.innerHTML = wrapper ? `$$ ${escHtml(formula)} $$` : ` \\(${escHtml(formula)}\\) `;
    if (wrapper && wrapper.contains(el)) {
      if (!wrapper.dataset.mathDone) {
        wrapper.dataset.mathDone = '1';
        wrapper.replaceWith(replacement);
      }
    } else {
      el.replaceWith(replacement);
    }
  });
}

function extractGemini(doc) {
  const msgs = Array.from(doc.querySelectorAll('user-query, message-content'));
  const turns = [];
  const seen = new Set();

  msgs.forEach(msg => {
    const role = msg.tagName.toLowerCase() === 'user-query' ? 'user' : 'model';
    let html = '';

    if (role === 'user') {
      const userNode = msg.querySelector('.query-text, .query-content, #user-query-content-0, [id^="user-query-content-"]') || msg;
      html = textToHtml(userNode.textContent || '');
    } else {
      const modelNode = msg.querySelector('.markdown, .model-response-text, .response-content, .message-content') || msg;
      const clone = modelNode.cloneNode(true);
      sanitizeGeminiNode(clone);
      html = renderGenericNodeTree(clone, new Set(), { boldClass: null, treatDisplayBlockDiv: false });
      html = postProcess(html, false);
    }

    pushTurn(turns, seen, role, html);
  });

  return turns;
}

function sanitizeGeminiNode(root) {
  root.querySelectorAll('button, svg, style, script, form, audio, img, video, canvas, textarea, sources-list, message-actions').forEach(el => el.remove());
  root.querySelectorAll('.katex-html, .sr-only, .response-footer, .response-container-footer, .mat-mdc-tooltip-trigger').forEach(el => el.remove());

  root.querySelectorAll('[data-math]').forEach(el => {
    if (el.closest('[data-math]') !== el) return;
    const formula = (el.getAttribute('data-math') || '').trim();
    if (!formula) return;
    const isDisplay = el.classList.contains('math-display') || /\\begin|\\\\\[|^\s*\\displaystyle/.test(formula);
    const replacement = document.createElement(isDisplay ? 'div' : 'span');
    if (isDisplay) replacement.className = 'math-block';
    replacement.innerHTML = isDisplay ? `$$ ${escHtml(formula)} $$` : ` \\(${escHtml(formula)}\\) `;
    el.replaceWith(replacement);
  });

  root.querySelectorAll('.query-text').forEach(el => {
    el.innerHTML = escHtml(el.textContent || '');
  });
}

function extractGrok(doc) {
  const msgs = Array.from(doc.querySelectorAll('.r-imh66m'));
  const turns = [];
  const seen = new Set();

  msgs.forEach(msg => {
    const role = msg.classList.contains('r-1kt6imw') ? 'user' : 'model';
    const html = postProcess(
      renderGenericNodeTree(msg, new Set(), { boldClass: 'r-b88u0q', treatDisplayBlockDiv: true }),
      true
    );
    pushTurn(turns, seen, role, html);
  });

  return turns;
}

function pushTurn(turns, seen, role, html) {
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain && !seen.has(plain)) {
    seen.add(plain);
    turns.push({ role, html, plain });
  }
}

function renderGenericNodeTree(node, mathSeen, options) {
  return Array.from(node.childNodes).map(child => renderGenericNode(child, mathSeen, options)).join('');
}

function renderGenericNode(node, mathSeen, options) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  const classes = node.classList;
  const style = node.getAttribute('style') || '';
  if (COMMON_NOISE.has(tag)) return '';

  if (node.hasAttribute && node.hasAttribute('data-math')) {
    const formula = (node.getAttribute('data-math') || '').trim();
    const norm = formula.replace(/\s+/g, '');
    if (!formula || mathSeen.has(norm)) return '';
    mathSeen.add(norm);
    return node.classList.contains('math-display')
      ? `<div class="math-block">$$ ${formula} $$</div>`
      : ` \\(${formula}\\) `;
  }

  if (classes.contains('katex-mathml')) {
    const ann = node.querySelector('annotation');
    if (!ann) return '';
    const formula = ann.textContent.trim();
    const norm = formula.replace(/\s+/g, '');
    if (mathSeen.has(norm)) return '';
    mathSeen.add(norm);
    let parent = node.parentNode;
    while (parent) {
      if (parent.classList && parent.classList.contains('katex-display')) {
        return `<div class="math-block">$$ ${formula} $$</div>`;
      }
      parent = parent.parentNode;
    }
    return ` \\(${formula}\\) `;
  }

  if (classes.contains('katex-html')) return '';
  if (classes.contains('katex') || classes.contains('katex-display')) {
    return renderGenericNodeTree(node, mathSeen, options);
  }

  if (classes.contains('raw_katex')) {
    const formula = node.textContent.trim();
    const norm = formula.replace(/\s+/g, '');
    if (mathSeen.has(norm)) return '';
    mathSeen.add(norm);
    return formula.length > 50 || formula.includes('\\begin')
      ? `<div class="math-block">$$ ${formula} $$</div>`
      : ` \\(${formula}\\) `;
  }

  if (/margin-top:\s*1\.5em/.test(style) || ['h1', 'h2', 'h3', 'h4'].includes(tag)) {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    return inner ? `<h3>${inner}</h3>\n` : '';
  }

  if (tag === 'strong' || tag === 'b' || (options.boldClass && classes.contains(options.boldClass))) {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    return inner ? `<b>${inner}</b>` : '';
  }

  if (tag === 'em' || tag === 'i') {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    return inner ? `<i>${inner}</i>` : '';
  }

  if (tag === 'br') return '<br>\n';
  if (tag === 'hr') return '\n<hr>\n';

  if (['ul', 'ol', 'pre', 'table', 'tr', 'thead', 'tbody', 'blockquote'].includes(tag)) {
    return `<${tag}>${renderGenericNodeTree(node, mathSeen, options)}</${tag}>\n`;
  }

  if (tag === 'li') {
    return `<li>${renderGenericNodeTree(node, mathSeen, options).trim()}</li>\n`;
  }

  if (['th', 'td'].includes(tag)) {
    return `<${tag}>${renderGenericNodeTree(node, mathSeen, options).trim()}</${tag}>`;
  }

  if (tag === 'p' || (tag === 'div' && options.treatDisplayBlockDiv && /display:\s*block/.test(style))) {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    return inner ? `<p>${inner}</p>\n` : '';
  }

  if (tag === 'div') {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    if (!inner) return '';
    if (node.querySelector('p, ul, ol, pre, table, blockquote, h1, h2, h3, h4')) return inner + '\n';
    return `<p>${inner}</p>\n`;
  }

  if (tag === 'span') return renderGenericNodeTree(node, mathSeen, options);

  if (tag === 'a') {
    return `<a href="${escAttr(node.getAttribute('href') || '#')}" target="_blank">${renderGenericNodeTree(node, mathSeen, options)}</a>`;
  }

  if (tag === 'code') {
    const text = node.textContent.trim();
    if (text.startsWith('\\') || (text.includes('{') && text.includes('\\'))) return '';
    return node.parentElement && node.parentElement.tagName && node.parentElement.tagName.toLowerCase() === 'pre'
      ? escHtml(node.textContent)
      : `<code>${escHtml(node.textContent)}</code>`;
  }

  return renderGenericNodeTree(node, mathSeen, options);
}

function textToHtml(text) {
  return text.trim()
    .split(/\n{2,}/)
    .map(block => `<p>${escHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function postProcess(html, grokMode) {
  const store = [];

  function stashInline(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
      if (source[i] === '\\' && source[i + 1] === '(') {
        let j = i + 2;
        let found = false;
        while (j < source.length - 1) {
          if (source[j] === '\\' && source[j + 1] === ')') {
            const formula = source.slice(i, j + 2);
            store.push(formula);
            out += `@@M${store.length - 1}@@`;
            i = j + 2;
            found = true;
            break;
          }
          j++;
        }
        if (!found) out += source[i++];
      } else {
        out += source[i++];
      }
    }
    return out;
  }

  html = html.replace(/<div class="math-block">[\s\S]*?<\/div>/g, m => { store.push(m); return `@@M${store.length - 1}@@`; });
  html = html.replace(/\$\$[\s\S]*?\$\$/g, m => { store.push(m); return `@@M${store.length - 1}@@`; });
  html = stashInline(html);
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<b>$1</b>');
  if (!grokMode) html = html.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');

  for (let i = store.length - 1; i >= 0; i--) {
    html = html.replaceAll(`@@M${i}@@`, store[i]);
  }

  return html
    .replace(/<h3>\s*<\/h3>/g, '')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/(:)([\uAC00-\uD7A3A-Za-z(\\])/g, '$1<br>$2')
    .replace(/([^\n])<h3>/g, '$1\n<h3>')
    .replace(/([^\n])<div class="math-block">/g, '$1\n<div class="math-block">')
    .replace(/<\/div>\s*([^\n<\s])/g, '</div>\n$1')
    .trim();
}

function cleanTitle(title) {
  return title
    .replace(/\(\d+\)\s?/g, '')
    .replace(/ \/ X$/, '')
    .replace(/ - (Claude|ChatGPT|Gemini|Grok)$/, '')
    .replace(/^ChatGPT\s*[-:]\s*/, '')
    .replace(/^Gemini\s*[-:]\s*/, '')
    .replace(/^Grok\s*[-:]\s*/, '')
    .trim();
}

function buildHtml(title, turns) {
  const style = `
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR","Segoe UI",sans-serif; background:#f0f2f5; color:#111; padding:30px 16px; line-height:1.8; font-size:15.5px; }
.container { max-width:840px; margin:0 auto; }
.turn { display:flex; gap:14px; margin-bottom:30px; }
.user { flex-direction:row-reverse; }
.avatar { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; flex-shrink:0; color:#fff; box-shadow:0 2px 8px rgba(0,0,0,.2); }
.model .avatar { background:#111; }
.user .avatar { background:#0ea5e9; }
.bubble { max-width:80%; padding:18px 22px; border-radius:18px; box-shadow:0 2px 14px rgba(0,0,0,.07); overflow-wrap:break-word; word-break:break-word; }
.model .bubble { background:#fff; border-bottom-left-radius:4px; border:1px solid #e0e0e0; }
.user .bubble { background:#dbeafe; border-bottom-right-radius:4px; border:1px solid #bfdbfe; color:#1e3a5f; }
.bubble p { margin:0 0 12px; }
.bubble p:last-child { margin-bottom:0; }
.bubble b { font-weight:700; color:#000; }
.bubble h3 { font-size:1.05em; font-weight:700; color:#111; margin:20px 0 8px; border-left:3px solid #6366f1; padding-left:10px; }
.bubble ul,.bubble ol { margin:8px 0 8px 24px; }
.bubble li { margin-bottom:6px; }
.bubble table { width:100%; border-collapse:separate; border-spacing:0; margin:16px 0; table-layout:auto; }
.bubble th,.bubble td { padding:10px 16px; border-right:1px solid #d9dee7; border-bottom:1px solid #d9dee7; text-align:left; vertical-align:top; line-height:1.7; }
.bubble th { background:#f7f9fc; font-weight:700; white-space:nowrap; }
.bubble td { background:#fff; min-width:96px; }
.bubble tr > *:first-child { border-left:1px solid #d9dee7; }
.bubble tr:first-child > * { border-top:1px solid #d9dee7; }
.bubble pre { background:#1e1e2e; color:#cdd6f4; padding:16px; border-radius:10px; overflow-x:auto; font-family:monospace; font-size:13px; margin:12px 0; }
.bubble code { background:#f0f0f0; padding:2px 5px; border-radius:4px; font-size:13px; }
.math-block { margin:14px auto; padding:10px 16px; background:#fafafa; border:1px solid #e8e8e8; border-radius:8px; overflow-x:auto; text-align:center; }
`;
  const mathjaxConf = `window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$']],processEscapes:true},options:{skipHtmlTags:['script','noscript','style','textarea','pre']}};`;
  const rows = turns.map(t => `<div class="turn ${t.role}"><div class="avatar">${t.role === 'user' ? 'U' : 'AI'}</div><div class="bubble">${t.html}</div></div>`).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${escHtml(title)}</title><script>${mathjaxConf}<\/script><script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" defer><\/script><style>${style}</style></head><body><div class="container">${rows}</div></body></html>`;
}

function buildMarkdown(title, turns) {
  const lines = [`# ${title}`, ''];
  turns.forEach(t => {
    lines.push(`## ${t.role === 'user' ? '질문' : '답변'}`);
    lines.push('');
    lines.push(htmlToMarkdown(t.html));
    lines.push('');
  });
  return lines.join('\n');
}

function buildTxt(turns) {
  return turns.map(t => `[${t.role === 'user' ? 'User' : 'AI'}]\n${htmlToMarkdown(t.html).replace(/[*#`|]/g, '')}`).join('\n\n');
}

function htmlToMarkdown(html) {
  let md = html;
  md = md.replace(/<div class="math-block">\$\$([\s\S]*?)\$\$<\/div>/g, (_, formula) => `\n$$${formula}$$\n`);
  md = md.replace(/<h3>(.*?)<\/h3>/g, '### $1\n');
  md = md.replace(/<b>(.*?)<\/b>/g, '**$1**');
  md = md.replace(/<i>(.*?)<\/i>/g, '*$1*');
  md = md.replace(/<br\s*\/?>/g, '\n');
  md = md.replace(/<p>([\s\S]*?)<\/p>/g, '$1\n\n');
  md = md.replace(/<ul>([\s\S]*?)<\/ul>/g, '$1\n');
  md = md.replace(/<ol>([\s\S]*?)<\/ol>/g, '$1\n');
  md = md.replace(/<li>(.*?)<\/li>/g, '- $1\n');
  md = md.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, '```\n$1\n```\n');
  md = md.replace(/<pre>([\s\S]*?)<\/pre>/g, '```\n$1\n```\n');
  md = md.replace(/<code>([\s\S]*?)<\/code>/g, '`$1`');
  md = md.replace(/<a href="(.*?)".*?>(.*?)<\/a>/g, '[$2]($1)');

  md = md.replace(/<table>([\s\S]*?)<\/table>/g, (_, content) => {
    let tableMd = '\n';
    const rows = content.match(/<tr.*?>[\s\S]*?<\/tr>/g) || [];
    rows.forEach((row, index) => {
      const cols = row.match(/<t[hd].*?>([\s\S]*?)<\/t[hd]>/g) || [];
      const rowStr = '| ' + cols.map(c => c.replace(/<[^>]+>/g, '').trim()).join(' | ') + ' |';
      tableMd += rowStr + '\n';
      if (index === 0) tableMd += '|' + cols.map(() => '---').join('|') + '|\n';
    });
    return tableMd + '\n';
  });

  return md
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }


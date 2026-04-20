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
let pendingExport = null;
let pendingObjectUrl = null;

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

dlBtn.onclick = async e => {
  if (!pendingExport) return;
  e.preventDefault();
  try {
    if (pendingExport.assets.length && pendingExport.format !== 'txt') {
      await saveExportWithAssets(pendingExport);
    } else {
      await saveBlob(pendingExport.filename, new Blob([pendingExport.content], { type: pendingExport.mime }), pendingExport.mime);
      setStatus('done', `저장 완료: ${pendingExport.filename}`);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      setStatus('error', '저장 실패: ' + err.message);
    }
  }
};

convertBtn.onclick = async () => {
  if (!selectedFile) return;
  convertBtn.disabled = true;
  dlBtn.style.display = 'none';
  setPlatformPill('분석 중...');
  setStatus('working', 'MHTML을 분석하고 있습니다...');

  try {
    const text = await selectedFile.text();
    const parts = parseMhtml(text);
    const htmlContent = extractHtmlFromParts(parts);
    const assets = extractAssetsFromParts(parts);
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    rewriteAssetReferences(doc, assets);
    const svgAssets = replaceDynamicVisuals(doc, selectedFmt);

    const source = detectPlatform(doc);
    setPlatformPill(`감지됨: ${source.label}`);
    setStatus('working', `${source.label} 형식으로 변환 중...`);

    const title = cleanTitle(doc.title || selectedFile.name.replace(/\.mhtml$/i, ''));
    const turns = source.extract(doc);
    if (!turns.length && source.id !== 'webpage') throw new Error(`${source.label} 메시지를 찾지 못했습니다.`);

    const baseName = sanitizeFilename(fnInput.value.trim() || selectedFile.name.replace(/\.[^.]+$/, ''), 'converted');
    pendingExport = buildExportPackage(selectedFmt, title, turns, baseName, source, assets, svgAssets);

    const totalAssets = pendingExport.assets.length;
    dlBtn.textContent = totalAssets && selectedFmt !== 'txt'
      ? `⬇ ${pendingExport.filename} + media ${totalAssets}개 (ZIP)`
      : `⬇ ${pendingExport.filename} 저장`;
    dlBtn.style.display = 'block';
    setStatus('done', `변환 완료: ${source.label}${totalAssets ? ` / 미디어 ${totalAssets}개` : ''}`);
  } catch (err) {
    console.error(err);
    setPlatformPill('감지 실패');
    setStatus('error', '오류: ' + err.message);
  }

  convertBtn.disabled = false;
};

function setFile(file) {
  selectedFile = file;
  pendingExport = null;
  const base = file.name.replace(/\.[^.]+$/, '');
  document.getElementById('drop-title').textContent = '📎 ' + file.name;
  document.getElementById('drop-sub').textContent = (file.size / 1024).toFixed(1) + ' KB';
  if (!fnInput.value) fnInput.placeholder = base;
  setPlatformPill('감지 대기 중');
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

function parseMhtml(text) {
  const boundaryMatch = text.match(/boundary="?([^";\r\n]+)"?/i);
  if (!boundaryMatch) throw new Error('MHTML boundary를 찾을 수 없습니다.');
  const boundary = boundaryMatch[1];
  const rawParts = text.split(`--${boundary}`);
  const parts = [];

  for (const rawPart of rawParts) {
    const trimmed = rawPart.trim();
    if (!trimmed || trimmed === '--') continue;
    const sep = rawPart.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const headerEnd = rawPart.indexOf(sep);
    if (headerEnd === -1) continue;

    const headers = parseHeaders(rawPart.slice(0, headerEnd).trim());
    const body = rawPart.slice(headerEnd + sep.length).replace(/\r?\n$/, '');
    const contentType = (headers['content-type'] || '').toLowerCase();
    const charset = parseCharset(headers['content-type']);
    const bytes = decodeBody(body, headers['content-transfer-encoding']);

    parts.push({
      headers,
      contentType,
      charset,
      bytes,
      text: bytesToText(bytes, charset || 'utf-8')
    });
  }

  if (!parts.length) throw new Error('MHTML 파트를 읽지 못했습니다.');
  return parts;
}

function parseHeaders(headerText) {
  const lines = headerText.replace(/\r\n/g, '\n').split('\n');
  const merged = [];
  lines.forEach(line => {
    if (/^[ \t]/.test(line) && merged.length) merged[merged.length - 1] += ' ' + line.trim();
    else merged.push(line.trim());
  });
  const headers = {};
  merged.forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  });
  return headers;
}

function parseCharset(contentType = '') {
  const match = contentType.match(/charset="?([^";]+)"?/i);
  return match ? match[1].trim() : null;
}

function decodeBody(body, encoding = '') {
  const lower = (encoding || '').toLowerCase();
  if (lower.includes('base64')) return decodeBase64(body);
  if (lower.includes('quoted-printable')) return decodeQuotedPrintable(body);
  return latin1ToBytes(body);
}

function decodeBase64(body) {
  const cleaned = body.replace(/[\r\n\s]/g, '');
  const binary = cleaned ? atob(cleaned) : '';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeQuotedPrintable(body) {
  const cleaned = body.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '=' && i + 2 < cleaned.length) {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(cleaned.charCodeAt(i) & 255);
  }
  return new Uint8Array(bytes);
}

function latin1ToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
  return bytes;
}

function bytesToText(bytes, charset) {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function extractHtmlFromParts(parts) {
  const htmlParts = parts.filter(part => part.contentType.includes('text/html'));
  if (!htmlParts.length) throw new Error('HTML 본문을 찾을 수 없습니다.');
  return htmlParts.sort((a, b) => b.text.length - a.text.length)[0].text;
}

function extractAssetsFromParts(parts) {
  const map = new Map();
  const usedNames = new Set();
  let svgCounter = 0;
  let imgCounter = 0;

  parts.forEach((part, index) => {
    if (!part.contentType.startsWith('image/')) return;
    const location = part.headers['content-location'] || '';
    const contentId = stripAngleBrackets((part.headers['content-id'] || '').trim());
    const ext = extensionFromMime(part.contentType, location) || 'bin';
    
    let stem = '';
    if (ext === 'svg') {
      stem = `svg${svgCounter++}`;
    } else {
      stem = `img${imgCounter++}`;
    }
    
    const filename = uniqueName(`${stem}.${ext}`, usedNames);
    const asset = { filename, relPath: `media/${filename}`, mime: mimeOnly(part.contentType), bytes: part.bytes };
    map.set(filename, asset);
    collectAssetKeys(location, contentId, filename).forEach(key => map.set(key, asset));
  });

  return map;
}

function collectAssetKeys(location, contentId, filename) {
  const keys = new Set([filename]);
  if (location) {
    keys.add(location);
    keys.add(decodeURIComponentSafe(location));
    keys.add(location.replace(/^\.?\//, ''));
    try {
      const url = new URL(location, 'https://mhtml.local/');
      keys.add(url.href);
      keys.add(url.pathname);
      keys.add(url.pathname.replace(/^\//, ''));
      const leaf = url.pathname.split('/').pop();
      if (leaf) keys.add(leaf);
    } catch {}
  }
  if (contentId) {
    keys.add(contentId);
    keys.add(`<${contentId}>`);
    keys.add(`cid:${contentId}`);
  }
  return [...keys].filter(Boolean);
}

function rewriteAssetReferences(doc, assets) {
  [['img', 'src'], ['img', 'srcset'], ['source', 'src'], ['source', 'srcset'], ['image', 'href'], ['image', 'xlink:href']].forEach(([selector, attr]) => {
    doc.querySelectorAll(selector).forEach(node => {
      const value = node.getAttribute(attr);
      if (!value) return;
      const rewritten = attr === 'srcset' ? rewriteSrcSet(value, assets) : resolveAssetPath(value, assets);
      if (rewritten) node.setAttribute(attr, rewritten);
    });
  });
}

function replaceDynamicVisuals(doc, format) {
  const svgAssets = [];
  let svgSeq = 0;

  doc.querySelectorAll('svg').forEach(svg => {
    if (!isLargeDynamicVisual(svg)) return;

    if (format === 'md') {
      // For Markdown: extract as separate .svg file
      const svgAsset = extractSvgAsAsset(svg, svgSeq++);
      if (svgAsset) {
        svgAssets.push(svgAsset);
        const img = document.createElement('img');
        img.setAttribute('src', svgAsset.relPath);
        img.setAttribute('alt', svgAsset.label);
        img.setAttribute('data-generated-visual', 'svg-chart');
        img.className = 'content-image';
        svg.replaceWith(img);
      }
    } else {
      const img = svgToImg(svg);
      if (img) svg.replaceWith(img);
    }
  });

  doc.querySelectorAll('canvas').forEach((canvas, index) => {
    const label = canvas.getAttribute('aria-label') || canvas.getAttribute('title') || canvas.getAttribute('data-testid') || `dynamic-visual-${index + 1}`;
    canvas.replaceWith(createDynamicNotice(label));
  });

  return svgAssets;
}

function extractSvgAsAsset(svg, seq) {
  try {
    const titleEl = svg.querySelector('text');
    const label = svg.getAttribute('aria-label')
      || svg.getAttribute('title')
      || (titleEl ? titleEl.textContent.trim() : '')
      || `chart-${seq}`;

    const serialized = new XMLSerializer().serializeToString(svg);
    // Normalize SVG: restore camelCase attributes that some HTML parsers lowercase
    let svgContent = normalizeSvgMarkup(serialized);

    const bytes = new TextEncoder().encode(svgContent);
    const filename = `svg${seq}.svg`;
    const relPath = `media/${filename}`;

    return {
      filename,
      relPath,
      mime: 'image/svg+xml',
      bytes,
      label
    };
  } catch {
    return null;
  }
}

function normalizeSvgMarkup(svgText) {
  const attrMap = {
    'viewbox=': 'viewBox=',
    'markerwidth=': 'markerWidth=',
    'markerheight=': 'markerHeight=',
    'refx=': 'refX=',
    'refy=': 'refY=',
    'preserveaspectratio=': 'preserveAspectRatio=',
    'baseprofile=': 'baseProfile=',
    'clippathunits=': 'clipPathUnits=',
    'gradientunits=': 'gradientUnits=',
    'gradienttransform=': 'gradientTransform=',
    'patternunits=': 'patternUnits=',
    'patterncontentunits=': 'patternContentUnits=',
    'patterntransform=': 'patternTransform=',
    'maskunits=': 'maskUnits=',
    'maskcontentunits=': 'maskContentUnits=',
    'contentscripttype=': 'contentScriptType=',
    'contentstyletype=': 'contentStyleType=',
    'textlength=': 'textLength=',
    'startoffset=': 'startOffset=',
    'calcmode=': 'calcMode=',
    'attributename=': 'attributeName=',
    'attributetype=': 'attributeType=',
    'repeatcount=': 'repeatCount=',
    'repeatdur=': 'repeatDur=',
  };
  let fixed = svgText;
  for (const [low, camel] of Object.entries(attrMap)) {
    fixed = fixed.replace(new RegExp(`\\b${low.replace('=', '\\s*=')}`, 'gi'), camel);
  }
  // Add XML declaration if missing
  if (!fixed.startsWith('<?xml')) {
    fixed = '<?xml version="1.0" encoding="UTF-8"?>\n' + fixed;
  }
  return fixed;
}

function isLargeDynamicVisual(svg) {
  const width = parseDimension(svg.getAttribute('width'));
  const height = parseDimension(svg.getAttribute('height'));
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  const vbWidth = viewBox.length === 4 ? viewBox[2] : 0;
  const vbHeight = viewBox.length === 4 ? viewBox[3] : 0;
  const effectiveWidth = width || vbWidth;
  const effectiveHeight = height || vbHeight;
  const complexShapeCount = svg.querySelectorAll('path, rect, circle, line, polyline, polygon, text').length;
  return (effectiveWidth >= 400 && effectiveHeight >= 180) || complexShapeCount >= 20;
}

function parseDimension(value) {
  if (!value) return 0;
  const match = String(value).match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

function createDynamicNotice(label) {
  const p = document.createElement('p');
  p.className = 'dynamic-omitted';
  p.textContent = `(동적 차트 영역 생략: ${label})`;
  return p;
}

function svgToImg(svg) {
  try {
    const serialized = new XMLSerializer().serializeToString(svg);
    const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    const img = document.createElement('img');
    img.setAttribute('src', encoded);
    img.setAttribute('alt', svg.getAttribute('aria-label') || svg.getAttribute('title') || 'chart');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('data-generated-visual', 'chart');
    img.className = 'content-image';
    return img;
  } catch {
    return null;
  }
}
function rewriteSrcSet(srcset, assets) {
  return srcset.split(',').map(entry => {
    const parts = entry.trim().split(/\s+/);
    if (!parts[0]) return entry;
    parts[0] = resolveAssetPath(parts[0], assets) || parts[0];
    return parts.join(' ');
  }).join(', ');
}

function resolveAssetPath(value, assets) {
  const raw = value.trim().replace(/^['"]|['"]$/g, '');
  if (!raw || /^data:|^blob:|^https?:/i.test(raw)) return null;
  const candidates = new Set([raw, decodeURIComponentSafe(raw), stripAngleBrackets(raw), raw.replace(/^cid:/i, ''), raw.replace(/^\.?\//, '')]);
  try {
    const url = new URL(raw, 'https://mhtml.local/');
    candidates.add(url.href);
    candidates.add(url.pathname);
    candidates.add(url.pathname.replace(/^\//, ''));
    const leaf = url.pathname.split('/').pop();
    if (leaf) candidates.add(leaf);
  } catch {}
  for (const candidate of candidates) {
    const asset = assets.get(candidate);
    if (asset) return asset.relPath;
  }
  return null;
}

function buildExportPackage(format, title, turns, baseName, source, assets, svgAssets = []) {
  if (format === 'html') {
    return {
      format,
      filename: `${baseName}.html`,
      content: buildHtml(title, turns, source),
      mime: 'text/html',
      assets: collectHtmlAssets(turns, assets)
    };
  }

  if (format === 'md') {
    const markdownExport = buildMarkdownExport(title, turns, source, assets, svgAssets);
    return {
      format,
      filename: `${baseName}.md`,
      content: markdownExport.content,
      mime: 'text/markdown',
      assets: markdownExport.assets
    };
  }

  return {
    format,
    filename: `${baseName}.txt`,
    content: buildTxt(turns, source),
    mime: 'text/plain',
    assets: []
  };
}

function collectHtmlAssets(turns, assets) {
  const parser = new DOMParser();
  const used = new Map();
  turns.forEach(turn => {
    const doc = parser.parseFromString(`<body>${turn.html}</body>`, 'text/html');
    doc.querySelectorAll('[src]').forEach(node => {
      const src = node.getAttribute('src');
      if (!src || !src.startsWith('media/')) return;
      const asset = assets.get(src.replace(/^media\//, ''));
      if (asset) used.set(asset.filename, asset);
    });
  });
  return [...used.values()];
}

async function saveExportWithAssets(exportData) {
  exportData = await materializeEmbeddedAssets(exportData);

  // Package main file + media assets into a ZIP
  await saveAsZip(exportData);
}

async function saveAsZip(exportData) {
  const baseName = exportData.filename.replace(/\.[^.]+$/, '');
  const files = [];

  // Main file (md, html, etc.)
  const mainBytes = new TextEncoder().encode(exportData.content);
  files.push({ name: exportData.filename, data: mainBytes });

  // Media assets
  for (const asset of exportData.assets) {
    files.push({ name: `media/${asset.filename}`, data: asset.bytes });
  }

  const zipBlob = buildZipBlob(files);
  const zipName = `${baseName}.zip`;

  // Try showSaveFilePicker for nice save dialog
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: zipName,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(zipBlob);
      await writable.close();
      setStatus('done', `ZIP 저장 완료: ${zipName} (${exportData.assets.length}개 미디어 포함)`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('showSaveFilePicker failed, falling back to download link');
    }
  }

  // Ultimate fallback: anchor download
  if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
  pendingObjectUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = pendingObjectUrl;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setStatus('done', `ZIP 다운로드: ${zipName} (${exportData.assets.length}개 미디어 포함)`);
}

function buildZipBlob(files) {
  // Minimal ZIP builder (store method, no compression)
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(data);

    // Local file header (30 + name + data)
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // signature
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, 0, true);             // flags
    lv.setUint16(8, 0, true);             // compression (store)
    lv.setUint16(10, 0, true);            // mod time
    lv.setUint16(12, 0, true);            // mod date
    lv.setUint32(14, crc, true);          // crc32
    lv.setUint32(18, data.length, true);  // compressed size
    lv.setUint32(22, data.length, true);  // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // name length
    lv.setUint16(28, 0, true);            // extra length
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localHeaders.push(local);

    // Central directory header (46 + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);    // signature
    cv.setUint16(4, 20, true);            // version made by
    cv.setUint16(6, 20, true);            // version needed
    cv.setUint16(8, 0, true);             // flags
    cv.setUint16(10, 0, true);            // compression
    cv.setUint16(12, 0, true);            // mod time
    cv.setUint16(14, 0, true);            // mod date
    cv.setUint32(16, crc, true);          // crc32
    cv.setUint32(20, data.length, true);  // compressed size
    cv.setUint32(24, data.length, true);  // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // name length
    cv.setUint16(30, 0, true);            // extra length
    cv.setUint16(32, 0, true);            // comment length
    cv.setUint16(34, 0, true);            // disk start
    cv.setUint16(36, 0, true);            // internal attrs
    cv.setUint32(38, 0, true);            // external attrs
    cv.setUint32(42, offset, true);       // local header offset
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  centralHeaders.forEach(h => centralDirSize += h.length);

  // End of central directory (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);               // disk number
  ev.setUint16(6, 0, true);               // central dir disk
  ev.setUint16(8, files.length, true);     // entries on disk
  ev.setUint16(10, files.length, true);    // total entries
  ev.setUint32(12, centralDirSize, true);  // central dir size
  ev.setUint32(16, centralDirOffset, true);// central dir offset
  ev.setUint16(20, 0, true);              // comment length

  return new Blob([...localHeaders, ...centralHeaders, eocd], { type: 'application/zip' });
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32.table[i] = c;
    }
  }
  for (let i = 0; i < data.length; i++) {
    crc = crc32.table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function saveBlob(filename, blob, mime) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: mime === 'text/html' ? 'HTML file' : 'Text file', accept: { [mime]: ['.' + filename.split('.').pop()] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('showSaveFilePicker failed, falling back to anchor download');
    }
  }
  if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
  pendingObjectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = pendingObjectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function inlineAssets(html, assets) {
  let out = html;
  assets.forEach(asset => {
    out = out.replaceAll(asset.relPath, `data:${asset.mime};base64,${bytesToBase64(asset.bytes)}`);
  });
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(binary);
}

function detectPlatform(doc) {
  return [
    { id: 'gpt', label: 'ChatGPT', extract: extractChatGPT, score: doc.querySelectorAll('[data-message-author-role]').length * 5 + doc.querySelectorAll('.markdown').length },
    { id: 'gemini', label: 'Gemini', extract: extractGemini, score: doc.querySelectorAll('user-query').length * 5 + doc.querySelectorAll('message-content').length * 4 + doc.querySelectorAll('[data-math]').length },
    { id: 'grok', label: 'Grok', extract: extractGrok, score: scoreGrokDocument(doc) },
    { id: 'webpage', label: '일반 웹페이지', extract: extractGenericWebpage, score: 1 }
  ].sort((a, b) => b.score - a.score)[0];
}

const COMMON_NOISE = new Set(['script', 'style', 'button', 'svg', 'form', 'audio', 'video', 'canvas', 'textarea', 'annotation', 'math', 'semantics', 'mrow', 'mn', 'mi', 'mo', 'mtext', 'mspace', 'mtable', 'mtr', 'mtd', 'msub', 'msqrt', 'munder', 'mover', 'msup', 'moverunder', 'mpadded', 'mphantom', 'merror']);

function scoreGrokDocument(doc) {
  const legacyMessages = doc.querySelectorAll('.r-imh66m').length;
  const modernMessages = getModernGrokMessageNodes(doc).length;
  const markdownBlocks = doc.querySelectorAll('.response-content-markdown').length;
  const messageBubbles = doc.querySelectorAll('.message-bubble').length;
  const roleHints = doc.querySelectorAll('[id^="response-"].items-start, [id^="response-"].items-end').length;
  return (legacyMessages * 5) + (modernMessages * 5) + (markdownBlocks * 2) + messageBubbles + roleHints;
}

function getModernGrokMessageNodes(doc) {
  return Array.from(doc.querySelectorAll('[id^="response-"]')).filter(node => {
    const className = node.className || '';
    return /(^|\s)items-(start|end)(\s|$)/.test(className) && !!node.querySelector('.message-bubble, .response-content-markdown');
  });
}

function getGrokMessageNodes(doc) {
  const legacy = Array.from(doc.querySelectorAll('.r-imh66m'));
  return legacy.length ? legacy : getModernGrokMessageNodes(doc);
}

function getGrokRole(node) {
  if (node.classList.contains('r-1kt6imw') || node.classList.contains('items-end')) return 'user';
  if (node.classList.contains('items-start')) return 'model';
  return 'model';
}

function extractChatGPT(doc) {
  const turns = [];
  const seen = new Set();
  doc.querySelectorAll('[data-message-author-role]').forEach(msg => {
    const role = msg.getAttribute('data-message-author-role') === 'user' ? 'user' : 'model';
    let html = '';
    if (role === 'user') {
      const userNode = msg.querySelector('.whitespace-pre-wrap') || msg;
      html = textToHtml(userNode.textContent || '');
    } else {
      const clone = (msg.querySelector('.markdown') || msg).cloneNode(true);
      sanitizeChatNode(clone);
      html = postProcess(renderGenericNodeTree(clone, new Set(), { boldClass: null, treatDisplayBlockDiv: false, keepImages: true }), false);
    }
    pushTurn(turns, seen, role, html);
  });
  return turns;
}

function extractGemini(doc) {
  const turns = [];
  const seen = new Set();
  doc.querySelectorAll('user-query, message-content').forEach(msg => {
    const role = msg.tagName.toLowerCase() === 'user-query' ? 'user' : 'model';
    let html = '';
    if (role === 'user') {
      const userNode = msg.querySelector('.query-text, .query-content, [id^="user-query-content-"]') || msg;
      html = textToHtml(userNode.textContent || '');
    } else {
      const clone = (msg.querySelector('.markdown, .model-response-text, .response-content, .message-content') || msg).cloneNode(true);
      sanitizeChatNode(clone);
      clone.querySelectorAll('[data-math]').forEach(el => {
        const formula = (el.getAttribute('data-math') || '').trim();
        if (!formula) return;
        const repl = document.createElement(el.classList.contains('math-display') ? 'div' : 'span');
        if (repl.tagName.toLowerCase() === 'div') repl.className = 'math-block';
        repl.innerHTML = repl.tagName.toLowerCase() === 'div' ? `$$ ${escHtml(formula)} $$` : ` \\(${escHtml(formula)}\\) `;
        el.replaceWith(repl);
      });
      html = postProcess(renderGenericNodeTree(clone, new Set(), { boldClass: null, treatDisplayBlockDiv: false, keepImages: true }), false);
    }
    pushTurn(turns, seen, role, html);
  });
  return turns;
}

function extractGrok(doc) {
  const turns = [];
  const seen = new Set();
  getGrokMessageNodes(doc).forEach(msg => {
    const role = getGrokRole(msg);
    const html = postProcess(renderGenericNodeTree(msg, new Set(), { boldClass: 'r-b88u0q', treatDisplayBlockDiv: true, keepImages: true }), true);
    pushTurn(turns, seen, role, html);
  });
  return turns;
}

function extractGenericWebpage(doc) {
  const clone = (doc.body || doc).cloneNode(true);
  clone.querySelectorAll('script, style, nav, header, footer, aside, form, button, input, textarea, noscript, iframe, svg, audio, video').forEach(el => el.remove());
  const html = postProcess(renderGenericNodeTree(clone, new Set(), { boldClass: null, treatDisplayBlockDiv: true, keepImages: true }), false);
  return html.trim() ? [{ role: 'model', html, plain: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }] : [];
}

function sanitizeChatNode(root) {
  root.querySelectorAll('button, svg, style, script, form, audio, video, canvas, textarea, sources-list, message-actions').forEach(el => el.remove());
  root.querySelectorAll('.katex-html, .sr-only, .response-footer, .response-container-footer, .mat-mdc-tooltip-trigger').forEach(el => el.remove());
  root.querySelectorAll('[data-testid*="citation"], [data-testid*="copy"], [aria-label*="Copy"], [aria-label*="좋아요"], [aria-label*="싫어요"]').forEach(el => el.remove());
  root.querySelectorAll('.katex-mathml').forEach(el => {
    const ann = el.querySelector('annotation');
    if (!ann) return el.remove();
    const formula = ann.textContent.trim();
    const display = !!el.closest('.katex-display');
    const repl = document.createElement(display ? 'div' : 'span');
    if (display) repl.className = 'math-block';
    repl.innerHTML = display ? `$$ ${escHtml(formula)} $$` : ` \\(${escHtml(formula)}\\) `;
    (display ? el.closest('.katex-display') : el).replaceWith(repl);
  });
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
  if (node.nodeType === 3) return escHtml(node.textContent || '');
  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  const classes = node.classList;
  const style = node.getAttribute('style') || '';
  if (COMMON_NOISE.has(tag)) return '';

  if (node.hasAttribute('data-math')) {
    const formula = (node.getAttribute('data-math') || '').trim();
    const norm = formula.replace(/\s+/g, '');
    if (!formula || mathSeen.has(norm)) return '';
    mathSeen.add(norm);
    return node.classList.contains('math-display') ? `<div class="math-block">$$ ${escHtml(formula)} $$</div>` : ` \\(${escHtml(formula)}\\) `;
  }

  if (classes.contains('katex-mathml')) return '';
  if (classes.contains('katex') || classes.contains('katex-display')) return renderGenericNodeTree(node, mathSeen, options);
  if (/margin-top:\s*1\.5em/.test(style) || ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
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
  if (tag === 'img' && options.keepImages) {
    const rawSrc = node.getAttribute('src') || '';
    if (isLikelyDecorativeImage(node, rawSrc)) return '';
    const src = escAttr(rawSrc);
    if (!src) return '';
    const alt = escAttr(node.getAttribute('alt') || '');
    return `<p><img class="content-image" src="${src}" alt="${alt}" loading="lazy"></p>\n`;
  }
  if (tag === 'a') {
    const href = node.getAttribute('href') || '#';
    const inner = renderGenericNodeTree(node, mathSeen, options).trim() || escHtml(href);
    return `<a href="${escAttr(href)}"${href.startsWith('media/') ? '' : ' target="_blank" rel="noreferrer"'}>${inner}</a>`;
  }
  if (tag === 'code') {
    return node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre' ? escHtml(node.textContent) : `<code>${escHtml(node.textContent)}</code>`;
  }
  if (tag === 'pre') return `<pre>${renderGenericNodeTree(node, mathSeen, options)}</pre>\n`;
  if (['ul', 'ol', 'blockquote', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup'].includes(tag)) return `<${tag}>${renderGenericNodeTree(node, mathSeen, options)}</${tag}>\n`;
  if (tag === 'li') {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    return inner ? `<li>${inner}</li>\n` : '';
  }
  if (tag === 'table') return `<div class="table-wrap"><table>${renderGenericNodeTree(node, mathSeen, options)}</table></div>\n`;
  if (tag === 'tr') return `<tr>${renderGenericNodeTree(node, mathSeen, options)}</tr>\n`;
  if (tag === 'th' || tag === 'td') {
    const attrs = [];
    if (node.hasAttribute('colspan')) attrs.push(` colspan="${escAttr(node.getAttribute('colspan'))}"`);
    if (node.hasAttribute('rowspan')) attrs.push(` rowspan="${escAttr(node.getAttribute('rowspan'))}"`);
    return `<${tag}${attrs.join('')}>${renderGenericNodeTree(node, mathSeen, options).trim()}</${tag}>`;
  }
  if (tag === 'col') return `<col${node.hasAttribute('span') ? ` span="${escAttr(node.getAttribute('span'))}"` : ''}>`;
  if (tag === 'p' || (tag === 'div' && options.treatDisplayBlockDiv && /display:\s*block/.test(style))) {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    return inner ? `<p>${inner}</p>\n` : '';
  }
  if (['div', 'section', 'article', 'main'].includes(tag)) {
    const inner = renderGenericNodeTree(node, mathSeen, options).trim();
    if (!inner) return '';
    return node.querySelector('p, ul, ol, pre, table, blockquote, h1, h2, h3, h4, h5, h6') ? inner + '\n' : `<p>${inner}</p>\n`;
  }
  if (tag === 'span') return renderGenericNodeTree(node, mathSeen, options);
  return renderGenericNodeTree(node, mathSeen, options);
}

function textToHtml(text) {
  return text.trim().split(/\n{2,}/).map(block => `<p>${escHtml(block).replace(/\n/g, '<br>')}</p>`).join('\n');
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
      } else out += source[i++];
    }
    return out;
  }
  html = html.replace(/<div class="math-block">[\s\S]*?<\/div>/g, m => { store.push(m); return `@@M${store.length - 1}@@`; });
  html = html.replace(/\$\$[\s\S]*?\$\$/g, m => { store.push(m); return `@@M${store.length - 1}@@`; });
  html = stashInline(html);
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<b>$1</b>');
  if (!grokMode) html = html.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  for (let i = store.length - 1; i >= 0; i--) html = html.replaceAll(`@@M${i}@@`, store[i]);
  return html.replace(/<h3>\s*<\/h3>/g, '').replace(/<p>\s*<\/p>/g, '').replace(/(:)([\uAC00-\uD7A3A-Za-z(\\])/g, '$1<br>$2').replace(/([^\n])<h3>/g, '$1\n<h3>').replace(/([^\n])<div class="math-block">/g, '$1\n<div class="math-block">').replace(/<\/div>\s*([^\n<\s])/g, '</div>\n$1').trim();
}

function cleanTitle(title) {
  return title.replace(/\(\d+\)\s?/g, '').replace(/ \/ X$/, '').replace(/ - (Claude|ChatGPT|Gemini|Grok)$/, '').replace(/^ChatGPT\s*[-:]\s*/, '').replace(/^Gemini\s*[-:]\s*/, '').replace(/^Grok\s*[-:]\s*/, '').trim();
}

function buildHtml(title, turns, source) {
  const isWebpage = source.id === 'webpage';
  const style = `
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR","Segoe UI",sans-serif; background:#f0f2f5; color:#111; padding:30px 16px; line-height:1.8; font-size:15.5px; }
.container { max-width:${isWebpage ? '920px' : '840px'}; margin:0 auto; }
.turn { display:flex; gap:14px; margin-bottom:30px; align-items:flex-start; }
.user { flex-direction:row-reverse; }
.avatar { width:${isWebpage ? '48px' : '40px'}; height:${isWebpage ? '48px' : '40px'}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:${isWebpage ? '11px' : '13px'}; flex-shrink:0; color:#fff; box-shadow:0 2px 8px rgba(0,0,0,.2); }
.model .avatar { background:#111; }
.user .avatar { background:#0ea5e9; }
.bubble { max-width:${isWebpage ? '100%' : '80%'}; width:${isWebpage ? '100%' : 'auto'}; padding:18px 22px; border-radius:18px; box-shadow:0 2px 14px rgba(0,0,0,.07); overflow-wrap:anywhere; word-break:break-word; }
.model .bubble { background:#fff; border-bottom-left-radius:4px; border:1px solid #e0e0e0; }
.user .bubble { background:#dbeafe; border-bottom-right-radius:4px; border:1px solid #bfdbfe; color:#1e3a5f; }
.bubble p { margin:0 0 12px; }
.bubble p:last-child { margin-bottom:0; }
.bubble img.content-image { display:block; width:100%; max-width:520px; height:auto; max-height:70vh; margin:10px auto; border-radius:10px; object-fit:contain; }
.bubble h3 { font-size:1.05em; font-weight:700; color:#111; margin:20px 0 8px; border-left:3px solid #6366f1; padding-left:10px; }
.bubble ul,.bubble ol { margin:8px 0 8px 24px; }
.table-wrap { width:100%; overflow-x:auto; margin:16px 0; }
.bubble table { width:100%; max-width:100%; border-collapse:collapse; background:#fff; table-layout:fixed; }
.bubble caption { caption-side:top; text-align:left; font-weight:700; padding:0 0 8px; }
.bubble th,.bubble td { padding:7px 8px; border:1px solid #d9dee7; text-align:left; vertical-align:top; line-height:1.45; min-width:0; overflow-wrap:anywhere; word-break:break-word; font-size:11px; }
.bubble th { background:#f7f9fc; font-weight:700; white-space:normal; }
.bubble td { min-width:0; }
.dynamic-omitted { margin:12px 0; padding:12px 14px; border-radius:10px; background:#f8fafc; color:#475569; border:1px dashed #cbd5e1; font-style:italic; }
.bubble pre { background:#1e1e2e; color:#cdd6f4; padding:16px; border-radius:10px; overflow-x:auto; font-family:monospace; font-size:13px; margin:12px 0; }
.bubble code { background:#f0f0f0; padding:2px 5px; border-radius:4px; font-size:13px; }
.math-block { margin:14px auto; padding:10px 16px; background:#fafafa; border:1px solid #e8e8e8; border-radius:8px; overflow-x:auto; text-align:center; }
`;
  const mathjaxConf = `window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$']],processEscapes:true},options:{skipHtmlTags:['script','noscript','style','textarea','pre']}};`;
  const rows = turns.map(t => `<div class="turn ${t.role}"><div class="avatar">${t.role === 'user' ? 'U' : (isWebpage ? 'WEB' : 'AI')}</div><div class="bubble">${t.html}</div></div>`).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escHtml(title)}</title><script>${mathjaxConf}<\/script><script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" defer><\/script><style>${style}</style></head><body><div class="container">${rows}</div></body></html>`;
}

function buildMarkdown(title, turns, source) {
  const lines = [`# ${title}`, ''];
  const isWebpage = source && source.id === 'webpage';
  turns.forEach(t => {
    if (!isWebpage) {
      lines.push(`## ${t.role === 'user' ? '질문' : '답변'}`);
      lines.push('');
    }
    lines.push(htmlToMarkdown(t.html));
    lines.push('');
  });
  return lines.join('\n');
}

function buildMarkdownExport(title, turns, source, assets, svgAssets = []) {
  const content = buildMarkdown(title, turns, source);
  const imageAssets = collectHtmlAssets(turns, assets);
  // Merge SVG assets with image assets, avoiding duplicates
  const allAssets = [...imageAssets];
  const usedNames = new Set(imageAssets.map(a => a.filename));
  for (const svgAsset of svgAssets) {
    if (!usedNames.has(svgAsset.filename)) {
      allAssets.push(svgAsset);
      usedNames.add(svgAsset.filename);
    }
  }
  return {
    content,
    assets: allAssets
  };
}

function buildTxt(turns, source) {
  const isWebpage = source && source.id === 'webpage';
  return turns.map(t => {
    const body = htmlToMarkdown(t.html).replace(/[*#`|!]/g, '');
    return isWebpage ? body : `[${t.role === 'user' ? 'User' : 'AI'}]\n${body}`;
  }).join('\n\n');
}

function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const md = renderMarkdownChildren(doc.body).trim();
  return md
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function extractEmbeddedMarkdownAssets(content) {
  const assets = [];
  let assetIndex = 0;

  function persistDataImage(src) {
    const match = src.match(/^data:(image\/[^;,\s]+)(?:;charset=[^;,]+)?(?:;(base64))?,(.*)$/i);
    if (!match) return null;

    const mime = match[1].toLowerCase();
    const isBase64 = !!match[2];
    const payload = match[3] || '';
    const bytes = isBase64
      ? decodeBase64(payload)
      : new TextEncoder().encode(decodeURIComponentSafe(payload));

    const ext = extensionFromMime(mime) || 'bin';
    const filename = `embedded-${++assetIndex}.${ext}`;
    assets.push({ filename, relPath: `media/${filename}`, mime, bytes });
    return `media/${filename}`;
  }

  let rewritten = content.replace(/<img\b([^>]*?)src="([^"]+)"([^>]*)>/gi, (full, before, src, after) => {
    if (!src.startsWith('data:image/')) return full;
    const rewrittenSrc = persistDataImage(src);
    return rewrittenSrc ? `<img${before}src="${rewrittenSrc}"${after}>` : full;
  });

  rewritten = rewritten.replace(/!\[([^\]]*)\]\((data:image\/[^\)]+)\)/gi, (full, alt, src) => {
    const rewrittenSrc = persistDataImage(src);
    return rewrittenSrc ? `![${alt}](${rewrittenSrc})` : full;
  });

  return { content: rewritten, assets };
}

function renderMarkdownChildren(node) {
  return Array.from(node.childNodes).map(renderMarkdownNode).join('');
}

function renderMarkdownNode(node) {
  if (node.nodeType === 3) return normalizeMarkdownText(node.textContent || '');
  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();

  if (tag === 'br') return '\n';
  if (tag === 'hr') return '\n---\n\n';
  if (tag === 'h1') return `# ${renderMarkdownInline(node).trim()}\n\n`;
  if (tag === 'h2') return `## ${renderMarkdownInline(node).trim()}\n\n`;
  if (tag === 'h3') return `### ${renderMarkdownInline(node).trim()}\n\n`;
  if (tag === 'h4') return `#### ${renderMarkdownInline(node).trim()}\n\n`;
  if (tag === 'h5') return `##### ${renderMarkdownInline(node).trim()}\n\n`;
  if (tag === 'h6') return `###### ${renderMarkdownInline(node).trim()}\n\n`;
  if (tag === 'p') return `${renderMarkdownInline(node).trim()}\n\n`;
  if (tag === 'b' || tag === 'strong') return `**${renderMarkdownInline(node).trim()}**`;
  if (tag === 'i' || tag === 'em') return `*${renderMarkdownInline(node).trim()}*`;
  if (tag === 'code') return `\`${renderMarkdownInline(node).trim()}\``;
  if (tag === 'pre') return `\`\`\`\n${node.textContent.replace(/\n$/, '')}\n\`\`\`\n\n`;
  if (tag === 'a') {
    const text = renderMarkdownInline(node).trim();
    const href = node.getAttribute('href') || '';
    if (!text) return '';
    return href ? `[${text}](${href})` : text;
  }
  if (tag === 'img') {
    const src = normalizeMarkdownImageSrc(node.getAttribute('src') || '');
    const alt = node.getAttribute('alt') || '';
    if (!src || isLikelyDecorativeImage(node, src)) return '';
    // Always allow media/ refs (extracted SVGs and images)
    if (src.startsWith('media/')) return `<img src="${escAttr(src)}" alt="${escAttr(alt)}" style="max-width: 100%; height: auto;">\n\n`;
    if (/^data:image\//i.test(src) && !node.hasAttribute('data-generated-visual')) return '';
    return `<img src="${escAttr(src)}" alt="${escAttr(alt)}" style="max-width: 100%; height: auto;">\n\n`;
  }
  if (tag === 'ul') return renderMarkdownList(node, '-');
  if (tag === 'ol') return renderMarkdownList(node, '1.');
  if (tag === 'blockquote') return renderMarkdownBlockquote(node);
  if (tag === 'table') return renderMarkdownTable(node);
  if (tag === 'div' && node.classList.contains('table-wrap')) return renderMarkdownChildren(node);
  if (tag === 'div' && node.classList.contains('math-block')) return `${node.textContent.trim()}\n\n`;

  return ['li', 'tbody', 'thead', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'].includes(tag)
    ? renderMarkdownChildren(node)
    : renderMarkdownChildren(node);
}

function renderMarkdownInline(node) {
  return Array.from(node.childNodes).map(child => {
    if (child.nodeType === 3) return normalizeMarkdownText(child.textContent || '');
    if (child.nodeType !== 1) return '';
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'b' || tag === 'strong') return `**${renderMarkdownInline(child).trim()}**`;
    if (tag === 'i' || tag === 'em') return `*${renderMarkdownInline(child).trim()}*`;
    if (tag === 'code') return `\`${renderMarkdownInline(child).trim()}\``;
    if (tag === 'a') {
      const text = renderMarkdownInline(child).trim();
      const href = child.getAttribute('href') || '';
      if (!text) return '';
      return href ? `[${text}](${href})` : text;
    }
    if (tag === 'img') {
      const src = normalizeMarkdownImageSrc(child.getAttribute('src') || '');
      const alt = child.getAttribute('alt') || '';
      if (!src || isLikelyDecorativeImage(child, src)) return '';
      if (src.startsWith('media/')) return `<img src="${escAttr(src)}" alt="${escAttr(alt)}" style="max-width: 100%; height: auto;">`;
      if (/^data:image\//i.test(src) && !child.hasAttribute('data-generated-visual')) return '';
      return `<img src="${escAttr(src)}" alt="${escAttr(alt)}" style="max-width: 100%; height: auto;">`;
    }
    if (tag === 'div' && child.classList.contains('math-block')) return child.textContent.trim();
    return renderMarkdownInline(child);
  }).join('').replace(/[ \t]+/g, ' ');
}

function renderMarkdownList(listNode, marker) {
  const items = Array.from(listNode.children).filter(child => child.tagName && child.tagName.toLowerCase() === 'li');
  const lines = items.map((item, index) => {
    const prefix = marker === '1.' ? `${index + 1}.` : marker;
    const content = renderMarkdownInline(item).trim() || renderMarkdownChildren(item).trim();
    return `${prefix} ${content}`;
  });
  return lines.join('\n') + '\n\n';
}

function renderMarkdownBlockquote(node) {
  const content = renderMarkdownChildren(node).trim().split('\n').map(line => line ? `> ${line}` : '>').join('\n');
  return `${content}\n\n`;
}

function renderMarkdownTable(table) {
  const clone = table.cloneNode(true);
  clone.querySelectorAll('img, svg, canvas').forEach(el => el.remove());
  clone.querySelectorAll('a').forEach(anchor => {
    const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    anchor.replaceWith(text);
  });
  clone.querySelectorAll('th, td').forEach(cell => {
    cell.innerHTML = escHtml((cell.textContent || '').replace(/\s+/g, ' ').trim());
  });
  return `\n${clone.outerHTML}\n\n`;
}

function escapeMarkdownTableCell(value) {
  return (value || ' ').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim() || ' ';
}

function normalizeMarkdownText(text) {
  return (text || '').replace(/\s+/g, ' ');
}

function normalizeMarkdownImageSrc(src) {
  return String(src || '').replace(/<br\s*\/?>/gi, '').trim();
}

async function materializeEmbeddedAssets(exportData) {
  const usedNames = new Set(exportData.assets.map(asset => asset.filename));
  const assets = [...exportData.assets];
  const cache = new Map();
  let content = exportData.content;
  let assetIndex = 0;

  async function persistDataImage(rawSrc) {
    const src = normalizeMarkdownImageSrc(rawSrc);
    if (!/^data:image\//i.test(src)) return null;
    if (cache.has(src)) return cache.get(src);

    const parsed = parseDataImageUrl(src);
    if (!parsed) return null;

    let { mime, bytes } = parsed;
    if (mime === 'image/svg+xml' && exportData.format !== 'md') {
      const rasterized = await rasterizeSvgBytes(bytes);
      if (!rasterized) return null;
      mime = 'image/png';
      bytes = rasterized;
    }

    const ext = extensionFromMime(mime) || 'bin';
    const basePrefix = ext === 'svg' ? 'svg' : 'img';
    let filename = uniqueName(`${basePrefix}${assetIndex++}.${ext}`, usedNames);
    
    const relPath = `media/${filename}`;
    assets.push({ filename, relPath, mime, bytes });
    cache.set(src, relPath);
    return relPath;
  }

  if (exportData.format === 'html') {
    const doc = new DOMParser().parseFromString(content, 'text/html');
    const images = Array.from(doc.querySelectorAll('img[src]'));
    for (const img of images) {
      const src = normalizeMarkdownImageSrc(img.getAttribute('src') || '');
      const relPath = await persistDataImage(src);
      if (relPath) img.setAttribute('src', relPath);
      else if (/^data:image\//i.test(src)) img.remove();
    }
    content = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  } else if (exportData.format === 'md') {
    content = await replaceMarkdownDataImages(content, persistDataImage);
  }

  return { ...exportData, content, assets };
}

async function replaceMarkdownDataImages(content, persistDataImage) {
  let rewritten = content;

  const htmlImgPattern = /<img\b([^>]*?)src="([^"]+)"([^>]*)>/gi;
  const htmlMatches = [...rewritten.matchAll(htmlImgPattern)];
  for (const match of htmlMatches) {
    const [full, before, src, after] = match;
    // skip non-data URLs as they are already handled or external
    if (!/^data:image\//i.test(src)) continue;
    const relPath = await persistDataImage(src);
    if (relPath) {
       rewritten = rewritten.replace(full, `<img${before}src="${relPath}"${after}>`);
    } else {
       rewritten = rewritten.replace(full, '');
    }
  }

  // legacy markdown syntax replace just in case
  const markdownPattern = /!\[([^\]]*)\]\((data:[^)]+)\)/gi;
  const markdownMatches = [...rewritten.matchAll(markdownPattern)];
  for (const match of markdownMatches) {
    const [full, alt, src] = match;
    const relPath = await persistDataImage(src);
    rewritten = rewritten.replace(full, relPath ? `<img src="${escAttr(relPath)}" alt="${escAttr(alt)}" style="max-width: 100%; height: auto;">` : '');
  }

  return rewritten;
}

function parseDataImageUrl(src) {
  const match = String(src || '').match(/^data:(image\/[^;,\s]+)(?:;charset=[^;,]+)?(?:;(base64))?,([\s\S]*)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const isBase64 = !!match[2];
  const payload = match[3] || '';
  const bytes = isBase64
    ? decodeBase64(payload)
    : new TextEncoder().encode(decodeURIComponentSafe(payload));
  return { mime, bytes };
}

async function rasterizeSvgBytes(bytes) {
  try {
    const svgText = new TextDecoder('utf-8').decode(bytes);
    const dims = inferSvgSize(svgText);
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, dims.width, dims.height);
      const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!pngBlob) return null;
      return new Uint8Array(await pngBlob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function inferSvgSize(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const width = parseDimension(svg.getAttribute('width'));
  const height = parseDimension(svg.getAttribute('height'));
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  const vbWidth = viewBox.length === 4 ? viewBox[2] : 0;
  const vbHeight = viewBox.length === 4 ? viewBox[3] : 0;
  const safeWidth = Math.max(1, Math.round(width || vbWidth || 960));
  const safeHeight = Math.max(1, Math.round(height || vbHeight || 520));
  return { width: safeWidth, height: safeHeight };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function isLikelyDecorativeImage(node, src = '') {
  const text = `${src} ${node.getAttribute('alt') || ''}`.toLowerCase();
  const classText = (node.getAttribute('class') || '').toLowerCase();
  const role = (node.getAttribute('role') || '').toLowerCase();
  const inInlineMedia = !!node.closest('.inline-media-container');
  const inFigure = !!node.closest('figure');
  const inTable = !!node.closest('table');
  const inMainContent = !!node.closest('.response-content-markdown, .message-bubble');
  const isLarge = isLargeContentImage(node);
  const isGeneratedVisual = node.hasAttribute('data-generated-visual');

  if (/google\.com\/s2\/favicons/i.test(src)) return true;
  if (/assets\.grok\.com\/users\/.+profile-picture/i.test(src)) return true;
  if (/(^|[\/_-])(icon|logo|mark|favicon|emoji|avatar|profile-picture)([\/_.-]|$)/.test(text)) return true;
  if (/(^|[\s_-])(pfp|avatar|presentation)([\s_-]|$)/.test(text)) return true;
  if (/(company logo|powered by|onetrust)/.test(text)) return true;
  if (role === 'presentation' || node.getAttribute('aria-hidden') === 'true') return true;
  if (/(^|[\s-])(size-4|size-5|size-6|size-8|rounded-full|aspect-square)([\s-]|$)/.test(classText) && !isLarge) return true;
  if (node.closest('button, nav, header, aside, [data-sidebar], .action-buttons, .order-first, .query-bar, .ot-sdk-container')) return true;

  // Keep only explanation-oriented images in the body: inline media blocks,
  // figures/tables, large in-content images, or generated chart visuals.
  const isMeaningfulContentImage = isGeneratedVisual || inInlineMedia || inFigure || inTable || (inMainContent && isLarge);
  if (!isMeaningfulContentImage) return true;

  if (node.closest('a') && !inFigure && !inInlineMedia && !isLarge) return true;
  return false;
}

function isLargeContentImage(node) {
  const width = parseDimension(node.getAttribute('width') || node.style.width || '');
  const height = parseDimension(node.getAttribute('height') || node.style.height || '');
  return width >= 240 || height >= 160;
}

function sanitizeFilename(name, fallback = 'file') {
  const cleaned = (name || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  return cleaned || fallback;
}

function mimeOnly(contentType) {
  return (contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
}

function extensionFromMime(contentType, fallbackLocation = '') {
  const mime = mimeOnly(contentType);
  const known = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/x-icon': 'ico' };
  if (known[mime]) return known[mime];
  const fallback = fallbackLocation.split('.').pop();
  return fallback && /^[a-z0-9]+$/i.test(fallback) ? fallback.toLowerCase() : null;
}

function fileStem(location) {
  const leaf = (location || '').split(/[?#]/)[0].split('/').pop() || '';
  return leaf.replace(/\.[^.]+$/, '');
}

function uniqueName(name, used) {
  const match = name.match(/^(.*?)(\.[^.]+)?$/);
  const stem = match[1];
  const ext = match[2] || '';
  let candidate = name;
  let i = 1;
  while (used.has(candidate)) candidate = `${stem}-${++i}${ext}`;
  used.add(candidate);
  return candidate;
}

function stripAngleBrackets(value) { return (value || '').replace(/^<|>$/g, ''); }
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }
function escHtml(s = '') { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s = '') { return escHtml(s).replace(/"/g, '&quot;'); }
function escapeHtmlAttribute(s = '') { return escAttr(s); }
function escapeMarkdownImageAlt(s = '') { return String(s).replace(/[\[\]]/g, '\\$&'); }
function escapeMarkdownLinkDest(s = '') { return String(s).replace(/[() ]/g, ch => encodeURIComponent(ch)); }

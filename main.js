const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const fs = require('fs'), path = require('path');
const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');
const ALLOWED = ['https://www.paypal.com/donate/?hosted_button_id=5ZAE37YBUL6Z8', 'https://developed-by-mo.web.app'];
let win;
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1200, height: 800, minWidth: 920, minHeight: 620, titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#8e8e93', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.setMenuBarVisibility(false); win.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());

const load = p => PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true });
const parse = (s, n) => { const r = []; String(s || '').split(',').forEach(x => { const [a, b] = x.split('-').map(v => parseInt(v)); if (!a) return; for (let i = a; i <= (b || a) && i <= n; i++) r.push(i - 1); }); return r; };
const uniq = p => { let q = p, i = 1; const e = path.extname(p), b = p.slice(0, -e.length); while (fs.existsSync(q)) q = `${b} (${i++})${e}`; return q; };
const save = async (d, p) => { p = uniq(p); fs.writeFileSync(p, await d.save({ useObjectStreams: true })); return p; };
const dir = (f, o) => o.out || (f && f[0] ? path.dirname(f[0]) : app.getPath('documents'));
const nm = (f, s) => path.basename(f, path.extname(f)) + s + '.pdf';
const kb = b => (b / 1024).toFixed(0) + ' KB';

const T = {
  async merge(f, o) { const d = await PDFDocument.create(); for (const p of f) { const s = await load(p); (await d.copyPages(s, s.getPageIndices())).forEach(x => d.addPage(x)); } return { files: [await save(d, path.join(dir(f, o), 'merged.pdf'))] }; },
  async split(f, o) { const s = await load(f[0]), n = s.getPageCount();
    const groups = o.mode === 'each' ? s.getPageIndices().map(i => [i]) : String(o.pages).split(',').map(x => parse(x, n)).filter(g => g.length);
    const files = []; let i = 1;
    for (const g of groups) { const d = await PDFDocument.create(); (await d.copyPages(s, g)).forEach(x => d.addPage(x)); files.push(await save(d, path.join(dir(f, o), nm(f[0], '_part' + i++)))); }
    return { files }; },
  async extract(f, o) { const s = await load(f[0]), idx = parse(o.pages, s.getPageCount()); if (!idx.length) throw new Error('No valid pages');
    const d = await PDFDocument.create(); (await d.copyPages(s, idx)).forEach(x => d.addPage(x)); return { files: [await save(d, path.join(dir(f, o), nm(f[0], '_extract')))] }; },
  async delete(f, o) { const s = await load(f[0]), idx = parse(o.pages, s.getPageCount()); if (!idx.length) throw new Error('No valid pages');
    [...new Set(idx)].sort((a, b) => b - a).forEach(i => s.removePage(i)); return { files: [await save(s, path.join(dir(f, o), nm(f[0], '_edited')))] }; },
  async rotate(f, o) { const s = await load(f[0]), n = s.getPageCount(), idx = o.pages ? parse(o.pages, n) : s.getPageIndices();
    idx.forEach(i => { const p = s.getPage(i); p.setRotation(degrees((p.getRotation().angle + Number(o.angle)) % 360)); });
    return { files: [await save(s, path.join(dir(f, o), nm(f[0], '_rotated')))] }; },
  async reverse(f, o) { const s = await load(f[0]), d = await PDFDocument.create(); (await d.copyPages(s, s.getPageIndices().reverse())).forEach(x => d.addPage(x));
    return { files: [await save(d, path.join(dir(f, o), nm(f[0], '_reversed')))] }; },
  async compress(f, o) { const files = [], info = [];
    for (const p of f) { const s = await load(p); const out = await save(s, path.join(dir([p], o), nm(p, '_compressed'))); files.push(out); info.push(`${path.basename(p)}: ${kb(fs.statSync(p).size)} → ${kb(fs.statSync(out).size)}`); }
    return { files, msg: info.join('\n') + '\n(Structural optimization, lossless)' }; },
  async img2pdf(f, o) { const d = await PDFDocument.create();
    for (const p of f) { const b = fs.readFileSync(p), im = /png$/i.test(p) ? await d.embedPng(b) : await d.embedJpg(b); d.addPage([im.width, im.height]).drawImage(im, { x: 0, y: 0, width: im.width, height: im.height }); }
    return { files: [await save(d, path.join(dir(f, o), 'images.pdf'))] }; },
  async watermark(f, o) { const s = await load(f[0]), ft = await s.embedFont(StandardFonts.HelveticaBold), t = o.text || 'CONFIDENTIAL', X = o.pages ? new Set(parse(o.pages, s.getPageCount())) : null;
    s.getPages().forEach((p, i) => { if (X && !X.has(i)) return; const { width: w, height: h } = p.getSize(), sz = Math.min(w, h) / 9, tw = ft.widthOfTextAtSize(t, sz), c = Math.SQRT1_2;
      p.drawText(t, { x: w / 2 - tw / 2 * c + sz / 3 * c, y: h / 2 - tw / 2 * c - sz / 3 * c, size: sz, font: ft, color: rgb(.5, .5, .5), opacity: Number(o.opacity || 25) / 100, rotate: degrees(45) }); });
    return { files: [await save(s, path.join(dir(f, o), nm(f[0], '_watermark')))] }; },
  async numbers(f, o) { const s = await load(f[0]), ft = await s.embedFont(StandardFonts.Helvetica), n = s.getPageCount(), X = o.pages ? new Set(parse(o.pages, n)) : null;
    s.getPages().forEach((p, i) => { if (X && !X.has(i)) return; const t = `${i + 1} / ${n}`, w = ft.widthOfTextAtSize(t, 10); p.drawText(t, { x: (p.getWidth() - w) / 2, y: 22, size: 10, font: ft, color: rgb(.3, .3, .3) }); });
    return { files: [await save(s, path.join(dir(f, o), nm(f[0], '_numbered')))] }; },
  async info(f) { const l = []; for (const p of f) { const s = await load(p); l.push(`${path.basename(p)}\n  Pages: ${s.getPageCount()} · Size: ${kb(fs.statSync(p).size)}\n  Title: ${s.getTitle() || '-'} · Author: ${s.getAuthor() || '-'}`); } return { files: [], msg: l.join('\n\n') }; }
};
ipcMain.handle('pick', async (_, { ext, multi }) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters: [{ name: 'Files', extensions: ext }] }); return r.canceled ? [] : r.filePaths; });
ipcMain.handle('folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('theme', (_, t) => { nativeTheme.themeSource = t; });
ipcMain.handle('open', (_, u) => { if (ALLOWED.includes(u)) shell.openExternal(u); });
ipcMain.handle('reveal', (_, p) => shell.showItemInFolder(p));
ipcMain.handle('run', async (_, t, f, o) => { try { if (!T[t]) throw new Error('Unknown tool'); return { ok: 1, ...await T[t](f, o || {}) }; } catch (e) { return { ok: 0, error: e.message }; } });

const uniqD = p => { let q = p, i = 1; while (fs.existsSync(q)) q = `${p} (${i++})`; return q; };
Object.assign(T, {
  async organize(f, o) { const s = await load(f[0]), d = await PDFDocument.create(), L = JSON.parse(o.order); if (!L.length) throw new Error('No pages left');
    (await d.copyPages(s, L.map(x => x.i))).forEach((p, k) => { if (L[k].r) p.setRotation(degrees((p.getRotation().angle + L[k].r) % 360)); d.addPage(p); });
    return { files: [await save(d, path.join(dir(f, o), nm(f[0], '_organized')))] }; },
  async blank(f, o) { const s = await load(f[0]), X = new Set(parse(o.pages, s.getPageCount())); if (!X.size) throw new Error('Select the pages to insert a blank page after');
    const d = await PDFDocument.create(); (await d.copyPages(s, s.getPageIndices())).forEach((p, i) => { d.addPage(p); if (X.has(i)) { const { width, height } = p.getSize(); d.addPage([width, height]); } });
    return { files: [await save(d, path.join(dir(f, o), nm(f[0], '_blanks')))] }; },
  async duplicate(f, o) { const s = await load(f[0]), X = new Set(parse(o.pages, s.getPageCount())); if (!X.size) throw new Error('Select the pages to duplicate');
    const d = await PDFDocument.create(); for (let i = 0; i < s.getPageCount(); i++) { for (let k = 0; k < (X.has(i) ? 2 : 1); k++) d.addPage((await d.copyPages(s, [i]))[0]); }
    return { files: [await save(d, path.join(dir(f, o), nm(f[0], '_duplicated')))] }; },
  async crop(f, o) { const s = await load(f[0]), X = new Set(o.pages ? parse(o.pages, s.getPageCount()) : s.getPageIndices()), v = k => Math.min(45, Math.max(0, +o[k] || 0)) / 100;
    s.getPages().forEach((p, i) => { if (!X.has(i)) return; const { x, y, width: w, height: h } = p.getMediaBox(), l = x + w * v('l'), b = y + h * v('b'), nw = w * (1 - v('l') - v('r')), nh = h * (1 - v('t') - v('b')); p.setCropBox(l, b, nw, nh); p.setMediaBox(l, b, nw, nh); });
    return { files: [await save(s, path.join(dir(f, o), nm(f[0], '_cropped')))] }; },
  async meta(f, o) { const s = await PDFDocument.load(fs.readFileSync(f[0]), { ignoreEncryption: true, updateMetadata: false });
    if (o.clear === '1') { s.setTitle(''); s.setAuthor(''); s.setSubject(''); s.setKeywords([]); s.setProducer(''); s.setCreator(''); }
    else { if (o.title) s.setTitle(o.title); if (o.author) s.setAuthor(o.author); if (o.subject) s.setSubject(o.subject); if (o.keywords) s.setKeywords(o.keywords.split(',').map(x => x.trim())); }
    return { files: [await save(s, path.join(dir(f, o), nm(f[0], '_meta')))] }; }
});
ipcMain.handle('read', (_, p) => fs.readFileSync(p));
ipcMain.handle('write', (_, d, sub, fl) => { try { const t = sub ? uniqD(path.join(d, sub)) : d; fs.mkdirSync(t, { recursive: true });
  const out = fl.map(x => { const p = uniq(path.join(t, path.basename(x.name))); fs.writeFileSync(p, Buffer.from(x.data)); return p; });
  return { ok: 1, files: sub ? [t] : out, msg: out.length + ' file(s) written' }; } catch (e) { return { ok: 0, error: e.message }; } });

const { pathToFileURL } = require('url');
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const CSS = '<meta charset="utf-8"><style>body{font:12pt "Segoe UI",Arial,sans-serif;line-height:1.55}p{margin:0 0 6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 8px;font-size:10pt}th{background:#eee}img{max-width:100%}</style>';
async function toPdf(html, out, raw) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  const tmp = path.join(require('os').tmpdir(), 'ptk_' + Date.now() + '.html');
  fs.writeFileSync(tmp, raw ? `<base href="${pathToFileURL(raw + path.sep).href}">` + html : CSS + '<body>' + html);
  await w.loadFile(tmp); fs.writeFileSync(out, await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
  w.destroy(); fs.unlinkSync(tmp); return out;
}
const lines = t => t.split(/\r?\n/).map(l => `<p dir="auto">${esc(l) || '&nbsp;'}</p>`).join('');
const csv = t => t.split(/\r?\n/).filter(Boolean).map(l => { const c = []; let s = '', q = 0; for (const ch of l) { if (ch == '"') q = !q; else if ((ch == ',' || ch == ';') && !q) { c.push(s); s = ''; } else s += ch; } c.push(s); return c; });
Object.assign(T, {
  async html2pdf(f, o) { const files = []; for (const p of f) { const raw = fs.readFileSync(p, 'utf8'), h = /\.html?$/i.test(p); files.push(await toPdf(h ? raw : lines(raw), uniq(path.join(dir([p], o), nm(p, ''))), h ? path.dirname(p) : null)); } return { files }; },
  async docx2pdf(f, o) { const mammoth = require('mammoth'), files = []; for (const p of f) { const r = await mammoth.convertToHtml({ path: p }); files.push(await toPdf(r.value, uniq(path.join(dir([p], o), nm(p, ''))))); } return { files, msg: 'Basic formatting is preserved (text, headings, lists, tables, images).' }; },
  async csv2pdf(f, o) { const files = []; for (const p of f) { const rows = csv(fs.readFileSync(p, 'utf8')); files.push(await toPdf('<table dir="auto">' + rows.map((r, i) => `<tr>${r.map(c => `<${i ? 'td' : 'th'}>${esc(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('') + '</table>', uniq(path.join(dir([p], o), nm(p, ''))))); } return { files }; },
  async textpdf(f, o) { if (!String(o.text || '').trim()) throw new Error('Type some text first'); const name = (o.name || 'document').replace(/[\\/:*?"<>|]/g, '_'); return { files: [await toPdf(lines(o.text), uniq(path.join(dir(f, o), name + '.pdf')))] }; },
  async newpdf(f, o) { const d = await PDFDocument.create(), sz = { a4: [595.28, 841.89], letter: [612, 792], a5: [419.53, 595.28] }[o.size] || [595.28, 841.89];
    for (let i = 0; i < Math.min(500, Math.max(1, +o.count || 1)); i++) d.addPage(sz); return { files: [await save(d, path.join(dir(f, o), 'blank.pdf'))] }; }
});

Object.assign(T, {
  async qrcode(f, o) { if (!String(o.text || '').trim()) throw new Error('Enter some text or a link'); const p = uniq(path.join(dir(f, o), 'qrcode.png'));
    await require('qrcode').toFile(p, o.text, { width: Math.min(2000, Math.max(128, +o.size || 512)), margin: 2 }); return { files: [p] }; },
  async zip(f, o) { const Z = require('adm-zip'), z = new Z(); f.forEach(p => z.addLocalFile(p)); const p = uniq(path.join(dir(f, o), 'archive.zip')); z.writeZip(p); return { files: [p] }; },
  async unzip(f, o) { const Z = require('adm-zip'), files = []; for (const p of f) { const d = uniqD(path.join(dir([p], o), path.basename(p, '.zip'))); new Z(p).extractAllTo(d, false); files.push(d); } return { files }; },
  async bulkrename(f, o) { if (!o.prefix && !o.suffix && o.num != '1') throw new Error('Set a prefix, suffix or numbering'); const files = [];
    f.forEach((p, i) => { const e = path.extname(p), b = path.basename(p, e), nn = o.num == '1' ? String(i + 1).padStart(String(f.length).length, '0') : b,
      t = uniq(path.join(path.dirname(p), `${o.prefix || ''}${nn}${o.suffix || ''}${e}`)); (o.act == 'move' ? fs.renameSync : fs.copyFileSync)(p, t); files.push(t); });
    return { files }; },
  async filehash(f, o) { const c = require('crypto'), l = []; for (const p of f) { const h = c.createHash(o.alg || 'sha256'); await new Promise((res, rej) => fs.createReadStream(p).on('data', d => h.update(d)).on('end', res).on('error', rej)); l.push(`${path.basename(p)}\n  ${h.digest('hex')}`); } return { files: [], msg: l.join('\n') }; }
});

const ff = a => new Promise((res, rej) => require('child_process').execFile(require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked'), ['-y', '-hide_banner', '-loglevel', 'error', ...a], { maxBuffer: 1 << 26 },
  (e, so, se) => e ? rej(new Error(String(se || e.message).trim().split('\n').slice(-2).join(' '))) : res()));
const sec = s => String(s || '0').split(':').reduce((a, v) => a * 60 + (+v || 0), 0), bn = (p, s, e) => path.basename(p, path.extname(p)) + s + e;
Object.assign(T, {
  async audio(f, o) { const files = []; for (const p of f) { const out = uniq(path.join(dir([p], o), bn(p, '', '.' + o.fmt))); await ff(['-i', p, '-vn', ...(['wav', 'flac'].includes(o.fmt) ? [] : ['-b:a', o.br]), out]); files.push(out); } return { files }; },
  async video(f, o) { const files = [], c = +o.crf; for (const p of f) { const out = uniq(path.join(dir([p], o), bn(p, '_converted', '.' + o.fmt)));
    await ff(['-i', p, ...(+o.h ? ['-vf', `scale=-2:${o.h}`] : []), ...(o.fmt == 'webm' ? ['-c:v', 'libvpx-vp9', '-crf', String(c + 8), '-b:v', '0', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-crf', String(c), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']), out]); files.push(out); } return { files }; },
  async gif(f, o) { const out = uniq(path.join(dir(f, o), bn(f[0], '', '.gif')));
    await ff(['-ss', String(sec(o.start)), '-t', String(+o.dur || 5), '-i', f[0], '-vf', `fps=${+o.fps || 12},scale=${+o.w || 480}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, out]); return { files: [out] }; },
  async trim(f, o) { const s = sec(o.start), e = sec(o.end); if (!(e > s)) throw new Error('End must be after start'); const out = uniq(path.join(dir(f, o), bn(f[0], '_cut', path.extname(f[0]))));
    await ff(['-ss', String(s), '-i', f[0], '-t', String(e - s), ...(o.mode == 'copy' ? ['-c', 'copy'] : []), out]); return { files: [out] }; }
});

// 把页面依赖的外部资源（CSS / 图片 / 字体 / 正文图）全部下载进仓库，页面只向 github.io 请求
// 大于 500KB 的 GIF 动图转成 WebP（体积约 1/8），其余原样保存
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  // 腾讯 CDN 会按 Accept 协商：浏览器拿到 webp，*/* 拿到 png。要跟浏览器同字节就得照抄这个头
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};
const LOCAL_HOSTS = /^(game\.gtimg\.cn|ossweb-img\.qq\.com|hyrz\.qq\.com|static\.gametalk\.qq\.com|vm\.gtimg\.cn|api\.rail\.tgp\.qq\.com|www\.tencent\.com|mmbiz\.qpic\.cn)$/;
const DIR_CSS = 'assets/css';
const DIR_IMG = 'assets/img';
const GIF_TO_WEBP_ABOVE = 500 * 1024; // 小动图原样保留，大的才转

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'font/woff': '.woff', 'font/woff2': '.woff2',
  'font/ttf': '.ttf', 'text/css': '.css', 'application/x-font-woff': '.woff',
};

function extOf(type, url) {
  if (type && EXT[type.split(';')[0].trim()]) return EXT[type.split(';')[0].trim()];
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
  return m ? '.' + m[1].toLowerCase() : '.bin';
}

const mapped = new Map(); // 原始 URL -> 本地相对路径
const existing = new Set(); // 已经下载过的文件名（按 URL hash 前缀命中，省掉重复下载）

function localOf(url) {
  const h = hash(url);
  for (const f of existing) if (f.startsWith(h + '.')) return `${DIR_IMG}/${f}`;
  return null;
}

let sharpMod = null;
async function toWebp(buf) {
  sharpMod ??= (await import('sharp')).default;
  const img = sharpMod(buf, { animated: true, limitInputPixels: false });
  const meta = await img.metadata();
  if (!meta.pages || meta.pages < 2) return null; // 静态 gif 不折腾
  const out = await sharpMod(buf, { animated: true, limitInputPixels: false })
    .webp({ quality: 70, effort: 4, loop: 0 })
    .toBuffer();
  return out.length < buf.length * 0.9 ? out : null;
}

async function download(url) {
  if (mapped.has(url)) return mapped.get(url);
  // HTML 里的 URL 是 &amp; 转义过的，取图要用解码后的
  const clean = url.replace(/&amp;/g, '&');
  const cache = localOf(clean);
  if (cache) { mapped.set(url, cache); mapped.set(clean, cache); return cache; }

  let res = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(clean, { headers: UA });
      if (res.ok) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    } catch { if (attempt === 3) throw new Error('fetch failed'); await new Promise((r) => setTimeout(r, 400 * attempt)); }
  }
  if (!res || !res.ok) { mapped.set(url, url); return url; }
  let buf = Buffer.from(await res.arrayBuffer());
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  let ext = extOf(type, clean);

  if (type === 'image/gif' && buf.length > GIF_TO_WEBP_ABOVE) {
    try {
      const webp = await toWebp(buf);
      if (webp) { buf = webp; ext = '.webp'; }
    } catch (e) { console.error('  ! gif->webp 失败，保留原图', clean.slice(-40), e.message); }
  }

  const file = `${DIR_IMG}/${hash(clean)}${ext}`;
  if (!existsSync(file)) writeFileSync(file, buf);
  existing.add(hash(clean) + ext);
  mapped.set(url, file);
  mapped.set(clean, file);
  return file;
}

async function css(url) {
  if (mapped.has(url)) return mapped.get(url);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) { mapped.set(url, url); return url; }
  let text = await res.text();
  const refs = new Set([...text.matchAll(/url\((['"]?)([^)'"]+?)\1\)/g)].map((m) => m[2].trim()));
  for (const ref of refs) {
    if (ref.startsWith('data:')) continue;
    let abs;
    try { abs = ref.startsWith('//') ? 'https:' + ref : new URL(ref, url).href; } catch { continue; }
    if (!LOCAL_HOSTS.test(new URL(abs).host)) continue;
    const local = await download(abs);
    if (local !== abs) text = text.split(ref).join('../' + local.replace(/^assets\//, ''));
  }
  const file = `${DIR_CSS}/${hash(url)}-${(url.split('/').pop() || 'style.css').split('?')[0]}`;
  writeFileSync(file, text);
  mapped.set(url, file);
  return file;
}

export async function localizeAll(files) {
  mkdirSync(DIR_CSS, { recursive: true });
  mkdirSync(DIR_IMG, { recursive: true });
  for (const f of readdirSync(DIR_IMG)) existing.add(f);

  // 1. 收集
  const cssLinks = new Set();
  const assets = new Set();
  const texts = new Map();
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    texts.set(f, s);
    for (const m of s.matchAll(/<link[^>]+href="(https?:\/\/[^"]+)"/g)) {
      if (m[1].endsWith('.css') && LOCAL_HOSTS.test(new URL(m[1]).host)) cssLinks.add(m[1]);
    }
    for (const m of s.matchAll(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/g)) assets.add(m[2]);
    for (const m of s.matchAll(/(?:data-)?src="(https?:\/\/[^"]+)"/g)) assets.add(m[1]);
    for (const m of s.matchAll(/data-lazy-bgimg="(https?:\/\/[^"]+)"/g)) assets.add(m[1]);
    for (const m of s.matchAll(/background-image:\s*url\((['"]?)(https?:\/\/[^)'"]+)\1\)/g)) assets.add(m[2]);
  }

  // 2. 下载（CSS 先，CSS 里的 url() 会补进 assets）
  for (const u of cssLinks) await css(u);
  const pending = [...assets].filter((u) => LOCAL_HOSTS.test(new URL(u).host) && !mapped.has(u));
  console.log(`待下载资源 ${pending.length} 个`);
  let n = 0;
  for (let i = 0; i < pending.length; i += 8) {
    await Promise.all(pending.slice(i, i + 8).map((u) => download(u).catch(() => u)));
    n += Math.min(8, pending.length - i);
    if (n % 80 === 0) console.log(`  ${n}/${pending.length}`);
  }

  // 3. 改写
  let changed = 0;
  for (const [f, orig] of texts) {
    let s = orig;
    for (const [url, local] of mapped) {
      if (url === local) continue;
      if (s.includes(url)) s = s.split(url).join(local);
    }
    if (s !== orig) { writeFileSync(f, s); changed++; }
  }
  console.log(`本地资源：${mapped.size} 个（已改写 ${changed} 个页面）`);
}

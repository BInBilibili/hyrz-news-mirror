// 把页面外壳依赖的外部资源（CSS / 图片 / 图标）下载进仓库，页面本身不再请求腾讯域名
// 正文里的微信图床图片（mmbiz.qpic.cn，约 1.4GB）保持外链，见 README
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  // 腾讯 CDN 会按 Accept 协商：浏览器拿到 webp，*/* 拿到 png。要跟浏览器同字节就得照抄这个头
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};
const LOCAL_HOSTS = /^(game\.gtimg\.cn|ossweb-img\.qq\.com|hyrz\.qq\.com|static\.gametalk\.qq\.com|vm\.gtimg\.cn|api\.rail\.tgp\.qq\.com|www\.tencent\.com)$/;
const DIR_CSS = 'assets/css';
const DIR_IMG = 'assets/img';

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

async function download(url) {
  if (mapped.has(url)) return mapped.get(url);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) { mapped.set(url, url); return url; }
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `${DIR_IMG}/${hash(url)}${extOf(res.headers.get('content-type'), url)}`;
  if (!existsSync(file)) writeFileSync(file, buf);
  mapped.set(url, file);
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
    for (const m of s.matchAll(/src="(https?:\/\/[^"]+)"/g)) assets.add(m[1]);
  }

  // 2. 下载（CSS 先，CSS 里的 url() 会补进 assets）
  for (const u of cssLinks) await css(u);
  const pending = [...assets].filter((u) => LOCAL_HOSTS.test(new URL(u).host) && !mapped.has(u));
  for (let i = 0; i < pending.length; i += 8) {
    await Promise.all(pending.slice(i, i + 8).map((u) => download(u).catch(() => u)));
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

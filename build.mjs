// 列表 + 正文全部来自官网 JSON 接口；外壳来自 Edge --dump-dom 抓到的已渲染官方 DOM
// （official_dom.html = 列表页，detail_dom.html = 正文页）
// 用法：node build.mjs
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';

const BASE = 'https://apps.game.qq.com/wmp/v3.1/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  'Referer': 'https://hyrz.qq.com/web202003/newsList.html',
};

const TABS = [
  { file: 'index', text: '最新',   tagId: 18807,  pagesize: 10, layout: 'text',  tag: 'first' },
  { file: 'tab1',  text: '公告',   tagId: 18812,  pagesize: 9,  layout: 'text',  tag: 'fixed' },
  { file: 'tab2',  text: '攻略',   tagId: 18808,  pagesize: 10, layout: 'text',  tag: 'fixed' },
  { file: 'tab3',  text: '赛事',   tagId: 18813,  pagesize: 10, layout: 'text',  tag: 'match' },
  { file: 'tab4',  text: '视频',   tagId: 18806,  pagesize: 12, layout: 'video', tag: 'fixed' },
  { file: 'tab5',  text: '体验服', tagId: 138135, pagesize: 10, layout: 'text',  tag: 'fixed' },
];

const TAG_TEXT = { 18808: '攻略', 18812: '公告', 18813: '活动' };
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  const json = JSON.parse((await res.text()).replace(/^\uFEFF/, ''));
  if (json.status === -2) return null;
  if (json.status !== 0) throw new Error(`API status=${json.status} ${url}`);
  return json.msg;
}

async function list(tab) {
  const p1 = tab.layout === 'video' ? 'searchKeywordsList'
    : tab.tagId === 18813 ? 'searchKeywordsList' : 'searchNewsKeywordsList';
  const url = `${BASE}?p0=25&p1=${p1}&page=1&pagesize=${tab.pagesize}` +
    `&order=sIdxTime&r0=cors&r1=NewsObj&type=iTag&id=${tab.tagId}&source=web_ingame`;
  return (await getJSON(url)) || { result: [], totalpage: 0 };
}

async function article(aid) {
  return getJSON(`${BASE}public/searchNews.php?p0=25&p1=1&source=web_ingame&id=${aid}`);
}

// 找到 openIdx 处开始的那个 <div> 元素真正闭合的位置
function elementEnd(html, openIdx) {
  const re = /<\/?div\b/gi;
  re.lastIndex = openIdx;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') { depth--; if (depth === 0) return html.indexOf('>', m.index) + 1; }
    else depth++;
  }
  return -1;
}

function fixUrls(html) {
  return html
    // 微信图床按 Referer 防盗链，github.io 会被拦成“未经允许不可引用”，去掉 Referer 即可
    .replace(/<head([^>]*)>/i, '<head$1><meta name="referrer" content="no-referrer" />')
    .replace(/<img\b(?![^>]*referrerpolicy)/gi, '<img referrerpolicy="no-referrer"')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<meta[^>]*charset=[^>]*>/i, '<meta charset="utf-8" />')
    // 只补协议相对地址；已经带 http(s): 的不要重复加
    .replace(/(?<!:)\/\/((?:game\.gtimg\.cn|ossweb-img\.qq\.com|hyrz\.qq\.com|static\.gametalk\.qq\.com)[^"')\s]*)/g, 'https://$1')
    .replace(/\s+v-cloak/g, '');
}

function tagOf(tab, it) {
  if (tab.tag === 'first') return TAG_TEXT[String(it.sTagIds || '').split(',')[0]] || '新闻';
  if (tab.tag === 'match') return '赛事';
  return TAG_TEXT[tab.tagId] || '新闻';
}

function rows(tab, items) {
  if (tab.layout === 'video') {
    return items.map((it) => `
              <li class="list-item video-item">
                <a href="https://hyrz.qq.com/web202003/videoDetails.html?aid=${esc(it.iVideoId || it.iNewsId)}" target="_blank">
                  <div class="video-box">
                    <img class="video-cover" src="${esc(it.sIMG)}" alt="" />
                    <div class="video-mask"><span class="icon-play"></span></div>
                  </div>
                  <p class="item-desc">${esc(it.sTitle)}</p>
                  <p class="item-info">
                    <span class="item-subtitle">${esc(it.sAuthor)}</span>
                    <span class="item-time">${esc(String(it.sCreated).slice(0, 11))}</span>
                  </p>
                </a>
              </li>`).join('');
  }
  return items.map((it) => `
              <li class="list-item">
                <a href="news-${esc(it.iNewsId)}.html">
                  <span class="item-tag">${esc(tagOf(tab, it))}</span>
                  <h5 class="item-title">${esc(it.sTitle)}</h5>
                </a>
              </li>`).join('');
}

function listPage(shell, data, active) {
  const tab = TABS[active];
  const d = data[active];
  const total = Math.min(d.totalpage || 0, 50);
  const tabStrip = '<ul class="tab-list">' + TABS.map((t, i) => `
            <li class="list-item${i === active ? ' on' : ''}"><a href="${t.file}.html">${t.text}</a></li>`).join('') + `
          </ul>`;
  return fixUrls(shell
    .replace(/<ul class="tab-list">[\s\S]*?<\/ul>/, tabStrip)
    .replace(/(<ul class="content-list[^"]*">)[\s\S]*?(<\/ul>)/, (_m, a, b) => a + rows(tab, d.result) + '\n            ' + b)
    .replace(/(<span class="paging-info">)[^<]*(<\/span>)/, (_m, a, b) => `${a}1 / ${total}${b}`));
}

function articlePage(shell, art) {
  let out = shell
    .replace(/(<h1 class="detail-title">)[\s\S]*?(<\/h1>)/, (_m, a, b) => a + esc(art.sTitle) + b)
    .replace(/(<span class="item-author">)[\s\S]*?(<\/span>)/, (_m, a, b) => a + '作者：' + esc(art.sAuthor) + b)
    .replace(/(<span class="item-time">)[\s\S]*?(<\/span>)/, (_m, a, b) => a + esc(art.sCreated) + b);

  const i = out.indexOf('<div id="js_content"');
  const end = i >= 0 ? elementEnd(out, i) : -1;
  if (i >= 0 && end > 0) out = out.slice(0, i) + art.sContent + out.slice(end);
  return fixUrls(out);
}

// ---- main ----
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const listShell = read('official_dom.html');
const detailShell = read('detail_dom.html');

const data = [];
for (const t of TABS) {
  const d = await list(t);
  data.push(d);
  console.error(`${t.text}: ${d.result.length} 条 / 共 ${d.totalpage} 页`);
}

// 正文页
const seen = new Set();
let done = 0;
for (const d of data) {
  for (const it of d.result) {
    const aid = it.iNewsId;
    if (!aid || seen.has(aid)) continue;
    seen.add(aid);
    const art = await article(aid);
    if (!art || !art.sContent) { console.error(`! 无正文 ${aid}`); continue; }
    writeFileSync(new URL(`news-${aid}.html`, import.meta.url), articlePage(detailShell, art), 'utf8');
    done++;
  }
}
console.error(`正文页 ${done} 篇`);

let first = null;
TABS.forEach((t, i) => {
  const html = listPage(listShell, data, i);
  if (i === 0) first = html;
  writeFileSync(new URL(`${t.file}.html`, import.meta.url), html, 'utf8');
});
writeFileSync(new URL('index.html', import.meta.url), first, 'utf8');
writeFileSync(new URL('tab0.html', import.meta.url), first, 'utf8');

// 把 CSS / 图片下载进 assets/，页面外壳不再请求腾讯域名
const { localizeAll } = await import('./localize.mjs');
const htmlFiles = readdirSync('.').filter((f) => f.endsWith('.html') && !f.includes('_dom')).sort();
await localizeAll(htmlFiles);
console.error('done');

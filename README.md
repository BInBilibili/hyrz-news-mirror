# 火影忍者手游 · 官网资讯静态镜像

把 <https://hyrz.qq.com/web202003/newsList.html> 的列表页和正文页，用官网自己调用的 JSON 接口取数据、套官网自己的 CSS 还原成纯静态页。

样式、图片、字体、正文配图全部下载进 `assets/`（904 个文件，599 MB），**页面打开后只向 GitHub 请求，不访问任何腾讯/微信域名**。

> 正文里的 GIF 动图原始体积 1.36 GB，构建时用 sharp 自动转成动画 WebP（质量 70，约 1/3.5），所以仓库能压到 599 MB，在 GitHub Pages 单站 1 GB 上限内。

## 在线看

启用 GitHub Pages 后：<https://binbilibili.github.io/hyrz-news-mirror/>

- `index.html` — 最新
- `tab1.html` … `tab5.html` — 公告 / 攻略 / 赛事 / 视频 / 体验服
- `news-<aid>.html` — 各条资讯的正文页

## 数据来源

列表（6 个标签页各自的 `id`）：

```
https://apps.game.qq.com/wmp/v3.1/?p0=25&p1=searchNewsKeywordsList&page=1&pagesize=10
  &order=sIdxTime&r0=cors&r1=NewsObj&type=iTag&id=18807&source=web_ingame
```

正文：

```
https://apps.game.qq.com/wmp/v3.1/public/searchNews.php?p0=25&p1=1&source=web_ingame&id=<aid>
```

接口无 cookie、无签名，只要 `User-Agent`（带上 `Referer: https://hyrz.qq.com/web202003/newsList.html` 更稳）。

| tab | 官网叫法 | tagId | 实际内容 |
| --- | --- | --- | --- |
| 0 | 最新 | 18807 | 稀疏，多为公告 |
| 1 | 公告 | 18812 | 每周更新公告 |
| 2 | 攻略 | 18808 | **新忍爆料 / 超前爆料 / 新忍预告全在这** |
| 3 | 赛事 | 18813 | 接口 `status:-2`，无数据 |
| 4 | 视频 | 18806 | 走 `searchKeywordsList` |
| 5 | 体验服 | 138135 | 比正式服早 1–2 周 |

## 页面外壳怎么来的

官网列表页和正文页都是 Vue 2 前端渲染（直接抓 HTML 只有 `{{item.sTitle}}` 占位符），所以用 Edge 无头模式把**已渲染完的 DOM** 存下来当外壳：

```bat
msedge --headless --disable-gpu --user-data-dir=%TEMP%\p --virtual-time-budget=12000 ^
  --dump-dom "https://hyrz.qq.com/web202003/newsList.html" > official_dom.html
```

- `official_dom.html` — 列表页外壳
- `detail_dom.html` — 正文页外壳

`build.mjs` 把接口数据填进这两个外壳，剥掉全部 `<script>`（否则 Vue 会重新拉数据覆盖注入内容），协议相对地址补成 `https://`，改 UTF-8 输出。

## 重新生成

```powershell
cd hyrz-page
node build.mjs
```

零依赖，Node 18+（用到内置 `fetch`）。

## 说明

内容版权归腾讯 / 万代南梦宫所有，本项目仅作技术演示与离线阅读，不作商业用途。

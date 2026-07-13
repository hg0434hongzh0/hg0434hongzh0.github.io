const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const START = {
  featured: '<!-- BLOG_FEATURED_START -->',
  recent: '<!-- BLOG_RECENT_START -->',
  archive: '<!-- BLOG_ARCHIVE_START -->'
};
const END = {
  featured: '<!-- BLOG_FEATURED_END -->',
  recent: '<!-- BLOG_RECENT_END -->',
  archive: '<!-- BLOG_ARCHIVE_END -->'
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[c]);
}
function escapeXml(value = '') { return escapeHtml(value); }
function stripHtml(value = '') { return String(value).replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim(); }
function slugify(value = '') {
  const slug = String(value).toLowerCase().trim().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'post';
}
function dateIso(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
}
function displayDate(iso) { return iso.replaceAll('-', '.'); }
function readingMinutes(content) { return Math.max(1, Math.ceil(String(content).replace(/\s/g, '').length / 500)); }
function replaceBlock(source, start, end, body) {
  const a = source.indexOf(start), b = source.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`模板标记缺失：${start} / ${end}`);
  return source.slice(0, a + start.length) + '\n' + body.trim() + '\n    ' + source.slice(b);
}

function loadPosts(root, postsDirectory = 'content/posts') {
  const dir = path.join(root, postsDirectory);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return fs.readdirSync(dir)
    .filter(file => file.toLowerCase().endsWith('.md'))
    .map(file => {
      const fullPath = path.join(dir, file);
      const parsed = matter(fs.readFileSync(fullPath, 'utf8'));
      const data = parsed.data || {};
      const date = dateIso(data.date || file);
      const slug = slugify(data.slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i, ''));
      return {
        sourcePath: fullPath,
        title: String(data.title || path.basename(file, '.md')),
        date,
        category: String(data.category || '研究笔记'),
        summary: String(data.summary || parsed.content.trim().split(/\n\s*\n/)[0].replace(/[#>*_`]/g, '').slice(0, 150)),
        slug,
        coverText: String(data.coverText || '研').slice(0, 2),
        published: data.published !== false && data.published !== 'false',
        content: parsed.content.trim(),
        minutes: Number(data.readingTime) || readingMinutes(parsed.content)
      };
    })
    .filter(post => post.published)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderMarkdown(markdown) {
  let html = marked.parse(markdown, { gfm: true, breaks: false });
  const toc = [];
  let index = 0;
  html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner) => {
    index += 1;
    const text = stripHtml(inner);
    const id = `${slugify(text)}-${index}`;
    toc.push({ id, text });
    return `<h2 id="${escapeHtml(id)}">${inner}</h2>`;
  });
  return { html, toc };
}

function header(relative = '..') {
  return `<a class="skip-link" href="#article">跳到正文</a><header class="site-header"><a class="brand" href="${relative}/index.html"><span class="brand-mark">hz</span><span>hongzh0's Blog</span></a><button class="menu-toggle" aria-label="打开导航" aria-expanded="false"><span></span><span></span></button><nav class="site-nav"><a href="${relative}/index.html">首页</a><a href="${relative}/archive.html">归档</a><a href="${relative}/about.html">关于</a><button class="theme-toggle" aria-label="切换深浅色主题"><span class="sun">☼</span><span class="moon">◐</span></button></nav></header>`;
}
function footer(relative = '..') {
  return `<footer class="site-footer"><div class="wrap footer-grid"><div><a class="brand footer-brand" href="${relative}/index.html"><span class="brand-mark">hz</span><span>hongzh0's Blog</span></a><p>安全研究、漏洞分析与攻防实践。</p></div><div class="footer-links"><span>探索</span><a href="${relative}/archive.html">文章归档</a><a href="${relative}/about.html">关于我</a></div><div class="footer-links"><span>连接</span><a href="https://github.com/hg0434hongzh0">GitHub ↗</a><a href="mailto:hello@example.com">Email ↗</a></div><div class="footer-end"><span>© ${new Date().getFullYear()} HONGZH0</span><button class="back-top" aria-label="返回顶部">↑</button></div></div></footer>`;
}
function articlePage(post) {
  const rendered = renderMarkdown(post.content);
  const toc = rendered.toc.length
    ? rendered.toc.map((item, i) => `<a href="#${escapeHtml(item.id)}">${String(i + 1).padStart(2, '0')} ${escapeHtml(item.text.replace(/^\d+\s*[·.、-]?\s*/, ''))}</a>`).join('')
    : '<a href="#article">正文</a>';
  return `<!doctype html><html lang="zh-CN" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(post.summary)}"><meta name="theme-color" content="#f3f0e9"><title>${escapeHtml(post.title)} — hongzh0's Blog</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Noto+Serif+SC:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="../assets/style.css"><script>document.documentElement.dataset.theme=localStorage.getItem('theme')||'light';</script></head><body>
${header('..')}
<main><header class="article-header wrap"><div class="post-meta"><span>${escapeHtml(post.category)}</span><time datetime="${post.date}">${displayDate(post.date)}</time><span>${post.minutes} 分钟阅读</span></div><h1>${escapeHtml(post.title)}</h1><p class="article-lead">${escapeHtml(post.summary)}</p></header>
<div class="featured-visual article-cover wrap"><span class="visual-grid"></span><span class="visual-orbit orbit-one"></span><span class="visual-orbit orbit-two"></span><span class="visual-center">${escapeHtml(post.coverText)}</span><span class="visual-caption">SECURITY RESEARCH · ${escapeHtml(post.date)}</span></div>
<div class="article-layout" id="article"><aside class="article-toc"><span>CONTENTS</span>${toc}</aside><article class="article-content">${rendered.html}<div class="article-end">最后更新于 ${displayDate(post.date)} · hongzh0's Blog</div></article></div></main>
${footer('..')}<script src="../assets/main.js"></script></body></html>\n`;
}

function featuredSection(post) {
  return `<section id="latest" class="featured wrap section-space">
      <div class="section-head"><div><span class="eyebrow">Latest research</span><h2>最新研究</h2></div><span class="section-no">RESEARCH / 01</span></div>
      <article class="featured-card">
        <a class="featured-visual" href="posts/${escapeHtml(post.slug)}.html" aria-label="阅读：${escapeHtml(post.title)}"><span class="visual-grid"></span><span class="visual-orbit orbit-one"></span><span class="visual-orbit orbit-two"></span><span class="visual-center">${escapeHtml(post.coverText)}</span><span class="visual-caption">SECURITY RESEARCH / LATEST</span></a>
        <div class="featured-copy"><div class="post-meta"><span>${escapeHtml(post.category)}</span><time datetime="${post.date}">${displayDate(post.date)}</time><span>${post.minutes} 分钟</span></div><h3><a href="posts/${escapeHtml(post.slug)}.html">${escapeHtml(post.title)}</a></h3><p>${escapeHtml(post.summary)}</p><a class="read-more" href="posts/${escapeHtml(post.slug)}.html"><span>阅读全文</span><i>↗</i></a></div>
      </article>
    </section>`;
}
function recentSection(posts) {
  const rows = posts.slice(0, 3).map((post, i) => `<article class="post-row"><div class="post-index">${String(i + 1).padStart(2, '0')}</div><div class="post-body"><div class="post-meta"><span>${escapeHtml(post.category)}</span><time datetime="${post.date}">${displayDate(post.date)}</time></div><h3><a href="posts/${escapeHtml(post.slug)}.html">${escapeHtml(post.title)}</a></h3><p>${escapeHtml(post.summary)}</p></div><a class="round-arrow" href="posts/${escapeHtml(post.slug)}.html" aria-label="阅读文章">↗</a></article>`).join('\n        ');
  return `<section class="notes wrap section-space"><div class="section-head"><div><span class="eyebrow">Latest notes</span><h2>最近写下</h2></div><a class="text-link" href="archive.html">查看全部 <span>↗</span></a></div><div class="post-list">${rows}</div></section>`;
}
function archiveSection(posts) {
  const categoryKeys = new Map();
  posts.forEach(post => { if (!categoryKeys.has(post.category)) categoryKeys.set(post.category, `cat-${categoryKeys.size + 1}`); });
  const buttons = [...categoryKeys].map(([name, key]) => `<button class="filter-btn" data-filter="${key}">${escapeHtml(name)}</button>`).join('');
  const years = [...new Set(posts.map(p => p.date.slice(0, 4)))];
  const groups = years.map(year => {
    const items = posts.filter(p => p.date.startsWith(year)).map(post => `<article class="archive-item" data-category="${categoryKeys.get(post.category)}"><time>${post.date.slice(5).replace('-', '.')}</time><a href="posts/${escapeHtml(post.slug)}.html">${escapeHtml(post.title)}</a><span>${escapeHtml(post.category)}</span></article>`).join('\n');
    return `<div class="archive-year"><h2>${year}</h2><div>${items}</div></div>`;
  }).join('\n');
  return `<section class="wrap section-space"><div class="archive-tools" aria-label="文章分类筛选"><button class="filter-btn active" data-filter="all">全部</button>${buttons}</div>${groups}</section>`;
}
function feedXml(posts, baseUrl = 'https://hongzh0.wiki/') {
  const items = posts.slice(0, 20).map(post => `<item><title>${escapeXml(post.title)}</title><link>${baseUrl}posts/${post.slug}.html</link><guid>${baseUrl}posts/${post.slug}.html</guid><pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate><description>${escapeXml(post.summary)}</description></item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" ?>\n<rss version="2.0"><channel><title>hongzh0's Blog</title><link>${baseUrl}</link><description>安全研究、漏洞分析与攻防实践</description><language>zh-cn</language>${items}</channel></rss>\n`;
}

function buildSite(root, options = {}) {
  const posts = loadPosts(root, options.postsDirectory);
  if (!posts.length) throw new Error('没有找到 published: true 的 Markdown 文章。');
  const outputDir = path.join(root, 'posts');
  fs.mkdirSync(outputDir, { recursive: true });
  for (const post of posts) fs.writeFileSync(path.join(outputDir, `${post.slug}.html`), articlePage(post), 'utf8');

  const indexPath = path.join(root, 'index.html');
  let index = fs.readFileSync(indexPath, 'utf8');
  index = replaceBlock(index, START.featured, END.featured, featuredSection(posts[0]));
  index = replaceBlock(index, START.recent, END.recent, recentSection(posts));
  fs.writeFileSync(indexPath, index, 'utf8');

  const archivePath = path.join(root, 'archive.html');
  let archive = fs.readFileSync(archivePath, 'utf8');
  archive = replaceBlock(archive, START.archive, END.archive, archiveSection(posts));
  fs.writeFileSync(archivePath, archive, 'utf8');
  fs.writeFileSync(path.join(root, 'feed.xml'), feedXml(posts, options.baseUrl), 'utf8');
  return { posts, generated: posts.map(p => `posts/${p.slug}.html`) };
}

module.exports = { buildSite, loadPosts, renderMarkdown, slugify };

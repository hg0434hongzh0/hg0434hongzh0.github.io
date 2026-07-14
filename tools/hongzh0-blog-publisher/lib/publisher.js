const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const matter = require('gray-matter');
const yaml = require('js-yaml');
const { marked } = require('marked');

const DEFAULT_BASE_URL = 'https://hongzh0.wiki/';
const OG_IMAGE = 'https://hongzh0.wiki/assets/portrait.jpg';
const REQUIRED_FIELDS = ['title', 'date', 'category', 'summary', 'slug', 'coverText', 'published'];
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
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function escapeXml(value = '') {
  return escapeHtml(value);
}

function stripHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function slugify(value = '') {
  const slug = String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'post';
}

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`baseUrl 必须使用 HTTP(S)：${value}`);
  }
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function absoluteUrl(baseUrl, relativePath = '') {
  return new URL(relativePath, baseUrl).href;
}

function assertInsideSiteRoot(siteRoot, targetPath, label) {
  const relative = path.relative(siteRoot, targetPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label}必须严格位于博客根目录内。`);
  }
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function displayDate(iso) {
  return iso.replaceAll('-', '.');
}

function readingMinutes(content) {
  return Math.max(1, Math.ceil(String(content).replace(/\s/g, '').length / 500));
}

function replaceBlock(source, start, end, body) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`模板标记缺失：${start} / ${end}`);
  }
  const content = String(body || '').trim();
  return source.slice(0, startIndex + start.length)
    + (content ? `\n${content}\n    ` : '\n    ')
    + source.slice(endIndex);
}

function requiredString(data, field) {
  if (!Object.prototype.hasOwnProperty.call(data, field)) {
    throw new Error(`缺少必填 front matter：${field}`);
  }
  if (typeof data[field] !== 'string' || !data[field].trim()) {
    throw new Error(`front matter ${field} 必须是非空字符串`);
  }
  return data[field].trim();
}

function parseBoolean(value, field, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`front matter ${field} 必须是 true 或 false`);
}

function parsePublished(value) {
  return parseBoolean(value, 'published');
}

function parsePublishedAt(value, date) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return new Date(`${date}T00:00:00Z`).toISOString();
  }
  const publishedAt = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(publishedAt)) {
    throw new Error('front matter publishedAt 必须是带时区的 ISO 8601 时间');
  }
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error('front matter publishedAt 必须是有效时间');
  }
  return new Date(timestamp).toISOString();
}

function parsePost(fullPath) {
  const source = fs.readFileSync(fullPath, 'utf8');
  const parsed = matter(source, {
    engines: {
      yaml: input => yaml.load(input, { schema: yaml.FAILSAFE_SCHEMA }) || {}
    }
  });
  const data = parsed.data || {};

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      throw new Error(`缺少必填 front matter：${field}`);
    }
  }

  const title = requiredString(data, 'title');
  const date = requiredString(data, 'date');
  const category = requiredString(data, 'category');
  const summary = requiredString(data, 'summary');
  const slug = requiredString(data, 'slug');
  const coverText = requiredString(data, 'coverText');
  const published = parsePublished(data.published);
  const encrypted = parseBoolean(data.encrypted, 'encrypted', false);
  let passwordEnv = '';
  if (Object.prototype.hasOwnProperty.call(data, 'passwordEnv')) {
    passwordEnv = requiredString(data, 'passwordEnv');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(passwordEnv)) {
      throw new Error('front matter passwordEnv 必须是有效的环境变量名');
    }
  }

  if (!validateDate(date)) {
    throw new Error('front matter date 必须是有效的 YYYY-MM-DD 日期');
  }
  const publishedAt = parsePublishedAt(data.publishedAt, date);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('front matter slug 只能包含小写字母、数字和连字符');
  }
  if ([...coverText].length > 2) {
    throw new Error('front matter coverText 最多包含 2 个字符');
  }

  let minutes = readingMinutes(parsed.content);
  if (Object.prototype.hasOwnProperty.call(data, 'readingTime')) {
    minutes = Number(data.readingTime);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error('front matter readingTime 必须是大于 0 的数字');
    }
    minutes = Math.ceil(minutes);
  }

  return {
    sourcePath: fullPath,
    title,
    date,
    publishedAt,
    category,
    summary,
    slug,
    coverText,
    published,
    encrypted,
    passwordEnv,
    content: parsed.content.trim(),
    minutes
  };
}

function loadPosts(root, postsDirectory = 'content/posts') {
  const siteRoot = path.resolve(root);
  const directory = path.resolve(siteRoot, postsDirectory);
  assertInsideSiteRoot(siteRoot, directory, '文章目录');
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`文章目录不存在：${postsDirectory}`);
  }

  const files = fs.readdirSync(directory)
    .filter(file => file.toLowerCase().endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));
  const posts = [];
  const errors = [];

  for (const file of files) {
    try {
      posts.push(parsePost(path.join(directory, file)));
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }

  const slugSources = new Map();
  for (const post of posts) {
    const existing = slugSources.get(post.slug);
    if (existing) {
      errors.push(`重复 slug "${post.slug}"：${existing}、${path.basename(post.sourcePath)}`);
    } else {
      slugSources.set(post.slug, path.basename(post.sourcePath));
    }
  }

  if (errors.length) {
    throw new Error(`文章校验失败：\n- ${errors.join('\n- ')}`);
  }

  return posts
    .filter(post => post.published)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || right.date.localeCompare(left.date) || left.slug.localeCompare(right.slug));
}

function renderMarkdown(markdown) {
  let html = marked.parse(markdown, { gfm: true, breaks: false });
  html = html.replace(/<img\b([^>]*)>/gi, (match, attributes) => {
    const loading = /\sloading\s*=/.test(attributes) ? '' : ' loading="lazy"';
    const decoding = /\sdecoding\s*=/.test(attributes) ? '' : ' decoding="async"';
    return `<img${loading}${decoding}${attributes}>`;
  });
  const toc = [];
  let index = 0;
  html = html.replace(/<h([2-4])>([\s\S]*?)<\/h\1>/g, (_, level, inner) => {
    index += 1;
    const text = stripHtml(inner);
    const id = `section-${slugify(text)}-${index}`;
    toc.push({ id, text, level: Number(level) });
    return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`;
  });
  return { html, toc };
}

function header(relative = '..') {
  return `<a class="skip-link" href="#article">跳到正文</a><header class="site-header"><a class="brand" href="${relative}/index.html"><span class="brand-mark">hz</span><span>hongzh0's Blog</span></a><button type="button" class="menu-toggle" aria-label="打开导航" aria-controls="site-navigation" aria-expanded="false"><span aria-hidden="true"></span><span aria-hidden="true"></span></button><nav class="site-nav" id="site-navigation" aria-label="主导航"><a href="${relative}/index.html">首页</a><a href="${relative}/archive.html">归档</a><a href="${relative}/about.html">关于</a><button type="button" class="theme-toggle" aria-label="切换深浅色主题" aria-pressed="false"><span class="sun" aria-hidden="true">☼</span><span class="moon" aria-hidden="true">◐</span></button></nav></header>`;
}

function footer(relative = '..') {
  return `<footer class="site-footer"><div class="wrap footer-grid"><div><a class="brand footer-brand" href="${relative}/index.html"><span class="brand-mark">hz</span><span>hongzh0's Blog</span></a><p>安全研究、漏洞分析与攻防实践。</p></div><div class="footer-links"><span>探索</span><a href="${relative}/archive.html">文章归档</a><a href="${relative}/about.html">关于我</a><a href="${relative}/feed.xml">RSS 订阅</a></div><div class="footer-links"><span>连接</span><a href="https://github.com/hg0434hongzh0" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a></div><div class="footer-end"><span>© ${new Date().getFullYear()} HONGZH0</span><button type="button" class="back-top" aria-label="返回顶部"><span aria-hidden="true">↑</span></button></div></div></footer>`;
}

function articleNavigation(previous, next) {
  const previousLink = previous
    ? `<a class="article-nav-prev" rel="prev" href="${escapeHtml(previous.slug)}.html" aria-label="上一篇：${escapeHtml(previous.title)}"><span>上一篇</span><strong>${escapeHtml(previous.title)}</strong></a>`
    : '';
  const nextLink = next
    ? `<a class="article-nav-next" rel="next" href="${escapeHtml(next.slug)}.html" aria-label="下一篇：${escapeHtml(next.title)}"><span>下一篇</span><strong>${escapeHtml(next.title)}</strong></a>`
    : '';
  if (!previousLink && !nextLink) return '';
  return `<nav class="article-nav" aria-label="文章导航">${previousLink}${nextLink}</nav>`;
}

function passwordMapFromEnvironment() {
  const source = process.env.BLOG_POST_PASSWORDS_JSON;
  if (!source || !source.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (_) {
    throw new Error('环境变量 BLOG_POST_PASSWORDS_JSON 必须是有效的 JSON 对象');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('环境变量 BLOG_POST_PASSWORDS_JSON 必须是 slug 到密码的 JSON 对象');
  }
  return parsed;
}

function resolvePostPassword(post, options = {}) {
  if (!post.encrypted) return '';
  let password = '';
  if (options.passwords instanceof Map) password = options.passwords.get(post.slug) || '';
  else if (options.passwords && typeof options.passwords === 'object') password = options.passwords[post.slug] || '';
  if (!password && post.passwordEnv) password = process.env[post.passwordEnv] || '';
  if (!password) password = passwordMapFromEnvironment()[post.slug] || '';
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error(`加密文章 ${post.slug} 缺少至少 8 个字符的密码；请配置 BLOG_POST_PASSWORDS_JSON 或 passwordEnv`);
  }
  return password;
}

function encryptArticlePayload(payload, password, slug) {
  const iterations = 250000;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`hongzh0-blog:${slug}:v1`, 'utf8');
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  return {
    version: 1,
    iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: encrypted.toString('base64')
  };
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function articlePage(post, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const canonical = absoluteUrl(baseUrl, `posts/${post.slug}.html`);
  const rendered = renderMarkdown(post.content);
  const sectionCount = rendered.toc.filter(item => item.level === 2).length || rendered.toc.length;
  const tocLinks = rendered.toc.length
    ? rendered.toc.map((item, index) => {
        const cls = item.level > 2 ? ` class="toc-h${item.level}"` : '';
        return `<a${cls} href="#${escapeHtml(item.id)}">${String(index + 1).padStart(2, '0')} ${escapeHtml(item.text.replace(/^\d+\s*[·.、-]?\s*/, ''))}</a>`;
      }).join('')
    : '<a href="#article">正文</a>';
  const password = resolvePostPassword(post, options);
  const encryptedPayload = post.encrypted
    ? safeJson(encryptArticlePayload({ html: rendered.html, toc: tocLinks }, password, post.slug))
    : '';
  const publicTocLinks = post.encrypted ? '' : tocLinks;
  const articleBody = post.encrypted
    ? `<section class="article-unlock" data-article-unlock aria-labelledby="article-unlock-title"><span class="article-unlock-kicker">PROTECTED RESEARCH NOTE</span><h2 id="article-unlock-title">这篇文章已加密</h2><p>输入访问密码后，正文只会在当前浏览器中解密。</p><form class="article-unlock-form"><label for="article-password">访问密码</label><div class="article-unlock-control"><input id="article-password" name="password" type="password" minlength="8" autocomplete="current-password" required><button type="submit">解锁文章</button></div><p class="article-unlock-status" role="status" aria-live="polite"></p></form></section><script id="article-encrypted-payload" type="application/json" data-slug="${escapeHtml(post.slug)}">${encryptedPayload}</script>`
    : rendered.html;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.summary,
    image: OG_IMAGE,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    inLanguage: 'zh-CN',
    mainEntityOfPage: canonical,
    url: canonical,
    author: { '@type': 'Person', name: 'hongzh0', url: absoluteUrl(baseUrl, 'about.html') },
    publisher: { '@type': 'Person', name: 'hongzh0' }
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html><html lang="zh-CN" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(post.summary)}"><meta name="theme-color" content="#f3f0e9"><title>${escapeHtml(post.title)} — hongzh0's Blog</title>
<link rel="canonical" href="${escapeHtml(canonical)}"><link rel="alternate" type="application/rss+xml" title="hongzh0's Blog RSS" href="/feed.xml"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="hongzh0's Blog"><meta property="og:title" content="${escapeHtml(post.title)}"><meta property="og:description" content="${escapeHtml(post.summary)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(OG_IMAGE)}"><meta property="og:image:alt" content="hongzh0 的个人照片"><meta property="og:image:width" content="960"><meta property="og:image:height" content="962"><meta property="article:published_time" content="${post.publishedAt}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(post.title)}"><meta name="twitter:description" content="${escapeHtml(post.summary)}"><meta name="twitter:image" content="${escapeHtml(OG_IMAGE)}"><meta name="twitter:image:alt" content="hongzh0 的个人照片">
<script type="application/ld+json">${structuredData}</script><link rel="stylesheet" href="/assets/fonts/font-face.css"><link rel="stylesheet" href="../assets/style.css"><script>try{const theme=localStorage.getItem('theme')||'light';document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(error){document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light'}</script></head><body>
<div class="reading-progress" aria-hidden="true"><span></span></div>${header('..')}
<main id="main"><section class="article-hero wrap"><header class="article-header"><a class="article-breadcrumb" href="../archive.html"><span aria-hidden="true">←</span> 文章归档 / ${escapeHtml(post.category)}</a><div class="post-meta"><span>${escapeHtml(post.category)}</span><time datetime="${post.publishedAt}">${displayDate(post.date)}</time><span>${post.minutes} 分钟阅读</span></div><h1>${escapeHtml(post.title)}</h1><p class="article-lead">${escapeHtml(post.summary)}</p><dl class="article-facts"><div><dt>PUBLISHED</dt><dd>${displayDate(post.date)}</dd></div><div><dt>READING</dt><dd>${post.minutes} MIN</dd></div><div><dt>SECTIONS</dt><dd>${String(sectionCount).padStart(2, '0')}</dd></div></dl></header>
<div class="featured-visual article-cover"><span class="visual-grid" aria-hidden="true"></span><span class="visual-orbit orbit-one" aria-hidden="true"></span><span class="visual-orbit orbit-two" aria-hidden="true"></span><span class="visual-center" aria-hidden="true">${escapeHtml(post.coverText)}</span><span class="visual-caption" aria-hidden="true">SECURITY RESEARCH · ${escapeHtml(post.date)}</span></div></section>
<details class="mobile-toc wrap"><summary><span>文章目录</span><small>${String(sectionCount).padStart(2, '0')} SECTIONS</small></summary><nav aria-label="移动端文章目录">${publicTocLinks}</nav></details><div class="article-layout" id="article"><aside class="article-toc" aria-label="文章目录"><div class="article-toc-head"><span>CONTENTS</span><small>${String(sectionCount).padStart(2, '0')} SECTIONS</small></div><nav class="article-toc-nav">${publicTocLinks}</nav></aside><article class="article-content">${articleBody}<footer class="article-end"><span>END OF RESEARCH NOTE</span><p>最后更新于 ${displayDate(post.date)} · hongzh0's Blog</p></footer>${articleNavigation(options.previous, options.next)}</article></div></main>
${footer('..')}<script src="../assets/main.js"></script>${post.encrypted ? '<script src="../assets/article-crypto.js"></script>' : ''}</body></html>\n`;
}

function featuredSection(post) {
  return `<section id="latest" class="featured wrap section-space">
      <div class="section-head"><h2>最新<em>研究</em></h2><span class="section-no">01 / FEATURED</span></div>
      <article class="featured-card">
        <a class="featured-visual" href="posts/${escapeHtml(post.slug)}.html" aria-label="${escapeHtml(post.coverText)}SECURITY RESEARCH / LATEST，阅读文章：${escapeHtml(post.title)}"><span class="visual-grid" aria-hidden="true"></span><span class="visual-orbit orbit-one" aria-hidden="true"></span><span class="visual-orbit orbit-two" aria-hidden="true"></span><span class="visual-center" aria-hidden="true">${escapeHtml(post.coverText)}</span><span class="visual-caption" aria-hidden="true">SECURITY RESEARCH / LATEST</span></a>
        <div class="featured-copy"><div class="post-meta"><span>${escapeHtml(post.category)}</span><time datetime="${post.date}">${displayDate(post.date)}</time><span>${post.minutes} 分钟</span></div><h3><a href="posts/${escapeHtml(post.slug)}.html">${escapeHtml(post.title)}</a></h3><p>${escapeHtml(post.summary)}</p><a class="read-more" href="posts/${escapeHtml(post.slug)}.html"><span>阅读全文</span><i aria-hidden="true">↗</i></a></div>
      </article>
    </section>`;
}

function recentSection(posts) {
  const recent = posts.slice(1, 4);
  if (!recent.length) return '';
  const rows = recent.map((post, index) => `<article class="post-row"><div class="post-index">${String(index + 1).padStart(2, '0')}</div><div class="post-body"><div class="post-meta"><span>${escapeHtml(post.category)}</span><time datetime="${post.date}">${displayDate(post.date)}</time></div><h3><a href="posts/${escapeHtml(post.slug)}.html">${escapeHtml(post.title)}</a></h3><p>${escapeHtml(post.summary)}</p></div><a class="round-arrow" href="posts/${escapeHtml(post.slug)}.html" aria-label="阅读文章：${escapeHtml(post.title)}"><span aria-hidden="true">↗</span></a></article>`).join('\n        ');
  return `<section class="notes wrap section-space"><div class="section-head"><h2>最近<em>写下</em></h2><a class="text-link" href="archive.html">查看全部 <span aria-hidden="true">↗</span></a></div><div class="post-list">${rows}</div></section>`;
}

function archiveSection(posts) {
  const categoryKeys = new Map();
  posts.forEach(post => {
    if (!categoryKeys.has(post.category)) categoryKeys.set(post.category, `cat-${categoryKeys.size + 1}`);
  });
  const filters = categoryKeys.size > 1
    ? `<div class="archive-tools" role="group" aria-label="文章分类筛选"><button type="button" class="filter-btn active" data-filter="all" aria-pressed="true">全部</button>${[...categoryKeys].map(([name, key]) => `<button type="button" class="filter-btn" data-filter="${key}" aria-pressed="false">${escapeHtml(name)}</button>`).join('')}</div>`
    : '';
  const years = [...new Set(posts.map(post => post.date.slice(0, 4)))];
  const groups = years.map(year => {
    const items = posts
      .filter(post => post.date.startsWith(year))
      .map(post => `<article class="archive-item" data-category="${categoryKeys.get(post.category)}"><time datetime="${post.date}">${post.date.slice(5).replace('-', '.')}</time><a href="posts/${escapeHtml(post.slug)}.html">${escapeHtml(post.title)}</a><span>${escapeHtml(post.category)}</span></article>`)
      .join('\n');
    return `<div class="archive-year"><h2>${year}</h2><div>${items}</div></div>`;
  }).join('\n');
  return `<section class="wrap section-space">${filters}${groups}</section>`;
}

function feedXml(posts, baseUrl = DEFAULT_BASE_URL) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const items = posts.slice(0, 20).map(post => {
    const url = absoluteUrl(normalizedBaseUrl, `posts/${post.slug}.html`);
    return `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(url)}</link><guid isPermaLink="true">${escapeXml(url)}</guid><pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate><category>${escapeXml(post.category)}</category><description>${escapeXml(post.summary)}</description></item>`;
  }).join('');
  const buildDate = new Date(posts[0].publishedAt).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>hongzh0's Blog</title><link>${escapeXml(normalizedBaseUrl)}</link><description>安全研究、漏洞分析与攻防实践</description><language>zh-cn</language><lastBuildDate>${buildDate}</lastBuildDate><atom:link href="${escapeXml(absoluteUrl(normalizedBaseUrl, 'feed.xml'))}" rel="self" type="application/rss+xml"/>${items}</channel></rss>\n`;
}

function sitemapXml(posts, baseUrl = DEFAULT_BASE_URL) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const latestDate = posts[0].date;
  const entries = [
    { url: normalizedBaseUrl, date: latestDate },
    { url: absoluteUrl(normalizedBaseUrl, 'archive.html'), date: latestDate },
    { url: absoluteUrl(normalizedBaseUrl, 'about.html') },
    ...posts.map(post => ({ url: absoluteUrl(normalizedBaseUrl, `posts/${post.slug}.html`), date: post.date }))
  ];
  const body = entries.map(entry => `<url><loc>${escapeXml(entry.url)}</loc>${entry.date ? `<lastmod>${entry.date}</lastmod>` : ''}</url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>\n`;
}

function robotsText(baseUrl = DEFAULT_BASE_URL) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl(normalizedBaseUrl, 'sitemap.xml')}\n`;
}

function readRequiredFile(root, relativePath, encoding = null) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`缺少公开文件：${relativePath}`);
  }
  return fs.readFileSync(fullPath, encoding || undefined);
}

function replaceDirectory(tempDirectory, outputDirectory) {
  const backupDirectory = `${outputDirectory}.backup-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  if (fs.existsSync(outputDirectory)) {
    fs.renameSync(outputDirectory, backupDirectory);
    movedExisting = true;
  }

  try {
    fs.renameSync(tempDirectory, outputDirectory);
  } catch (error) {
    if (movedExisting && !fs.existsSync(outputDirectory)) {
      fs.renameSync(backupDirectory, outputDirectory);
    }
    throw error;
  }

  if (movedExisting) {
    fs.rmSync(backupDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

function buildSite(root, options = {}) {
  const siteRoot = path.resolve(root);
  const postsDirectory = options.postsDirectory || 'content/posts';
  const outputDirectory = path.resolve(siteRoot, options.outputDirectory || 'dist');
  const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  assertInsideSiteRoot(siteRoot, outputDirectory, '输出目录');

  const posts = loadPosts(siteRoot, postsDirectory);
  if (!posts.length) {
    throw new Error('没有找到 published: true 的 Markdown 文章。');
  }

  const assetsDirectory = path.join(siteRoot, 'assets');
  if (!fs.existsSync(assetsDirectory) || !fs.statSync(assetsDirectory).isDirectory()) {
    throw new Error('缺少公开目录：assets');
  }

  let indexHtml = readRequiredFile(siteRoot, 'index.html', 'utf8');
  let archiveHtml = readRequiredFile(siteRoot, 'archive.html', 'utf8');
  const aboutHtml = readRequiredFile(siteRoot, 'about.html');
  const notFoundHtml = readRequiredFile(siteRoot, '404.html');
  const cname = readRequiredFile(siteRoot, 'CNAME');
  const noJekyll = readRequiredFile(siteRoot, '.nojekyll');

  indexHtml = replaceBlock(indexHtml, START.featured, END.featured, featuredSection(posts[0]));
  indexHtml = replaceBlock(indexHtml, START.recent, END.recent, recentSection(posts));
  archiveHtml = replaceBlock(archiveHtml, START.archive, END.archive, archiveSection(posts));
  const articles = posts.map((post, index) => ({
    path: `posts/${post.slug}.html`,
    html: articlePage(post, {
      baseUrl,
      previous: posts[index + 1] || null,
      next: posts[index - 1] || null,
      passwords: options.passwords
    })
  }));
  const feed = feedXml(posts, baseUrl);
  const sitemap = sitemapXml(posts, baseUrl);
  const robots = robotsText(baseUrl);

  fs.mkdirSync(path.dirname(outputDirectory), { recursive: true });
  const tempDirectory = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.tmp-${process.pid}-${Date.now()}`
  );

  try {
    fs.mkdirSync(tempDirectory, { recursive: false });
    fs.cpSync(assetsDirectory, path.join(tempDirectory, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(tempDirectory, 'posts'));
    fs.writeFileSync(path.join(tempDirectory, 'index.html'), indexHtml, 'utf8');
    fs.writeFileSync(path.join(tempDirectory, 'archive.html'), archiveHtml, 'utf8');
    fs.writeFileSync(path.join(tempDirectory, 'about.html'), aboutHtml);
    fs.writeFileSync(path.join(tempDirectory, '404.html'), notFoundHtml);
    fs.writeFileSync(path.join(tempDirectory, 'CNAME'), cname);
    fs.writeFileSync(path.join(tempDirectory, '.nojekyll'), noJekyll);
    for (const article of articles) {
      fs.writeFileSync(path.join(tempDirectory, article.path), article.html, 'utf8');
    }
    fs.writeFileSync(path.join(tempDirectory, 'feed.xml'), feed, 'utf8');
    fs.writeFileSync(path.join(tempDirectory, 'sitemap.xml'), sitemap, 'utf8');
    fs.writeFileSync(path.join(tempDirectory, 'robots.txt'), robots, 'utf8');
    replaceDirectory(tempDirectory, outputDirectory);
  } catch (error) {
    if (fs.existsSync(tempDirectory)) {
      fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
    throw error;
  }

  return {
    posts,
    outputDirectory,
    generated: [
      'index.html',
      'archive.html',
      'about.html',
      '404.html',
      'feed.xml',
      'sitemap.xml',
      'robots.txt',
      ...articles.map(article => article.path)
    ]
  };
}

module.exports = {
  buildSite,
  loadPosts,
  renderMarkdown,
  slugify,
  sitemapXml
};

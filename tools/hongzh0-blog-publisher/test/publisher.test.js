const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { buildSite, loadPosts, renderMarkdown } = require('../lib/publisher');

const roots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongzh0-blog-test-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'style.css'), 'body{}');
  fs.writeFileSync(path.join(root, 'assets', 'main.js'), 'void 0;');
  fs.writeFileSync(path.join(root, 'assets', 'article-crypto.js'), 'void 0;');
  fs.mkdirSync(path.join(root, 'assets', 'fonts'));
  fs.writeFileSync(path.join(root, 'assets', 'fonts', 'font-face.css'), '/* local fonts */');
  fs.writeFileSync(path.join(root, 'assets', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'index.html'), '<!DOCTYPE html><link rel="stylesheet" href="assets/style.css"><!-- BLOG_FEATURED_START -->template-featured<!-- BLOG_FEATURED_END --><!-- BLOG_RECENT_START -->template-recent<!-- BLOG_RECENT_END --><script src="assets/main.js"></script>');
  fs.writeFileSync(path.join(root, 'archive.html'), '<!-- BLOG_ARCHIVE_START -->template-archive<!-- BLOG_ARCHIVE_END -->');
  fs.writeFileSync(path.join(root, 'about.html'), '<!DOCTYPE html><title>About</title>');
  fs.writeFileSync(path.join(root, '404.html'), '<!DOCTYPE html><title>Not found</title>');
  fs.writeFileSync(path.join(root, 'CNAME'), 'hongzh0.wiki\n');
  fs.writeFileSync(path.join(root, '.nojekyll'), '');
  return root;
}

function writePost(root, file, values = {}, body = '正文。\n\n## 分析过程') {
  const data = {
    title: '测试文章',
    date: '2026-01-02',
    category: '研究笔记',
    summary: '测试摘要',
    slug: 'test-post',
    coverText: '测',
    published: 'true',
    ...values
  };
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) lines.push(`${key}: ${value}`);
  }
  lines.push('---', '', body, '');
  fs.writeFileSync(path.join(root, 'content', 'posts', file), lines.join('\n'));
}

try {
  const root = fixture();
  writePost(root, '2026-01-03-newest.md', { title: '最新文章', date: '2026-01-03', slug: 'newest-post', coverText: 'Gogs' }, '正文。\n\n## 漏洞简介\n\n### 影响范围');
  writePost(root, '2026-01-02-older.md', { title: '较早文章', slug: 'older-post' });
  writePost(root, '2026-01-01-draft.md', { title: '草稿文章', date: '2026-01-01', slug: 'draft-post', published: 'false' });
  fs.mkdirSync(path.join(root, 'dist', 'posts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'posts', 'stale-post.html'), 'stale');

  const posts = loadPosts(root, 'content/posts');
  assert.deepEqual(posts.map(post => post.slug), ['newest-post', 'older-post']);

  const sameDayRoot = fixture();
  writePost(sameDayRoot, 'first.md', { title: '当天先发布', date: '2026-01-05', publishedAt: '2026-01-05T09:00:00+08:00', slug: 'same-day-first' });
  writePost(sameDayRoot, 'last.md', { title: '当天后发布', date: '2026-01-05', publishedAt: '2026-01-05T21:00:00+08:00', slug: 'same-day-last' });
  const sameDayPosts = loadPosts(sameDayRoot, 'content/posts');
  assert.deepEqual(sameDayPosts.map(post => post.slug), ['same-day-last', 'same-day-first']);
  const sameDayResult = buildSite(sameDayRoot, { baseUrl: 'https://hongzh0.wiki/' });
  assert.equal(sameDayResult.posts[0].slug, 'same-day-last');
  const sameDayIndex = fs.readFileSync(path.join(sameDayRoot, 'dist', 'index.html'), 'utf8');
  const sameDayFeatured = sameDayIndex.slice(sameDayIndex.indexOf('BLOG_FEATURED_START'), sameDayIndex.indexOf('BLOG_FEATURED_END'));
  assert.match(sameDayFeatured, /当天后发布/);
  assert.doesNotMatch(sameDayFeatured, /当天先发布/);

  const result = buildSite(root, { baseUrl: 'https://hongzh0.wiki/' });
  assert.equal(result.posts.length, 2);
  assert.equal(path.basename(result.outputDirectory), 'dist');

  const topLevel = fs.readdirSync(path.join(root, 'dist')).sort();
  assert.deepEqual(topLevel, ['.nojekyll', '404.html', 'CNAME', 'about.html', 'archive.html', 'assets', 'feed.xml', 'index.html', 'posts', 'robots.txt', 'sitemap.xml']);
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'content')));
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'tools')));
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'posts', 'stale-post.html')));
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'posts', 'draft-post.html')));
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /template-featured/);

  const index = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  const recent = index.slice(index.indexOf('BLOG_RECENT_START'), index.indexOf('BLOG_RECENT_END'));
  assert.match(index, /最新文章/);
  assert.match(index, /assets\/style\.css\?v=[a-f0-9]{12}/);
  assert.match(index, /assets\/main\.js\?v=[a-f0-9]{12}/);
  assert.match(index, /<h2>最新<em>研究<\/em><\/h2>/);
  assert.match(index, /<h2>最近<em>写下<\/em><\/h2>/);
  assert.match(recent, /较早文章/);
  assert.doesNotMatch(recent, /最新文章/);

  const archive = fs.readFileSync(path.join(root, 'dist', 'archive.html'), 'utf8');
  assert.doesNotMatch(archive, /data-filter=/);

  const article = fs.readFileSync(path.join(root, 'dist', 'posts', 'newest-post.html'), 'utf8');
  assert.match(article, /^<!DOCTYPE html>/);
  assert.match(article, /rel="canonical" href="https:\/\/hongzh0\.wiki\/posts\/newest-post\.html"/);
  assert.match(article, /property="og:image"/);
  assert.match(article, /property="og:image:alt"/);
  assert.match(article, /property="og:image:width" content="960"/);
  assert.match(article, /property="og:image:height" content="960"/);
  assert.match(article, /name="twitter:card"/);
  assert.match(article, /name="twitter:image:alt"/);
  assert.match(article, /application\/ld\+json/);
  assert.match(article, /class="reading-progress"/);
  assert.match(article, /class="article-hero wrap"/);
  assert.match(article, /class="article-facts"/);
  assert.match(article, /class="mobile-toc wrap"/);
  assert.match(article, /class="article-toc-nav"/);
  assert.match(article, /END OF RESEARCH NOTE/);
  assert.match(article, /property="article:published_time" content="2026-01-03T00:00:00\.000Z"/);
  assert.match(article, /class="article-nav"/);
  assert.match(article, /id="section-/);
  assert.match(article, /data-cover-length="4" aria-hidden="true">Gogs<\/span>/);
  assert.match(article, /href="#section-[^"]+">漏洞简介<\/a>/);
  assert.match(article, /class="toc-h3" href="#section-[^"]+">影响范围<\/a>/);
  assert.doesNotMatch(article, />0[12] (?:漏洞简介|影响范围)<\/a>/);
  assert.equal(article.includes(['mail', 'to:'].join('')), false);
  assert.doesNotMatch(article, /@foxmail\.com/);
  assert.match(article, /github\.com\/hg0434hongzh0/);
  assert.match(article, /assets\/fonts\/font-face\.css/);
  assert.match(article, /assets\/style\.css\?v=[a-f0-9]{12}/);
  assert.match(article, /assets\/main\.js\?v=[a-f0-9]{12}/);
  assert.doesNotMatch(article, /fonts\.(?:googleapis|gstatic)\.com/);
  assert.doesNotMatch(article, /article-encrypted-payload/);
  assert.doesNotMatch(article, /article-crypto\.js/);

  const imageHtml = renderMarkdown('![验证图片](/assets/posts/test/image.png)').html;
  assert.match(imageHtml, /<img loading="lazy" decoding="async"/);
  assert.match(imageHtml, /src="\/assets\/posts\/test\/image\.png"/);
  assert.doesNotMatch(imageHtml, /data-fallback-src|referrerpolicy/);

  const giteeImageHtml = renderMarkdown(
    '<img src="/assets/posts/test/image.png" data-gitee-file="image.png" alt="验证图片">'
  ).html;
  assert.match(giteeImageHtml, /src="https:\/\/gitee\.com\/hongzh0\/picrrrrasaasaszxxzxz\/raw\/master\/image\.png"/);
  assert.match(giteeImageHtml, /data-fallback-src="\/assets\/posts\/test\/image\.png"/);
  assert.match(giteeImageHtml, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(giteeImageHtml, /data-gitee-file/);

  const untrustedImageHtml = renderMarkdown(
    '<img src="/assets/posts/test/image.png" data-gitee-file="other.png" alt="验证图片">'
  ).html;
  assert.match(untrustedImageHtml, /src="\/assets\/posts\/test\/image\.png"/);
  assert.doesNotMatch(untrustedImageHtml, /data-fallback-src|referrerpolicy/);

  const sitemap = fs.readFileSync(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /https:\/\/hongzh0\.wiki\/posts\/newest-post\.html/);
  assert.doesNotMatch(sitemap, /draft-post/);
  assert.match(fs.readFileSync(path.join(root, 'dist', 'robots.txt'), 'utf8'), /Sitemap: https:\/\/hongzh0\.wiki\/sitemap\.xml/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'dist', 'feed.xml'), 'utf8'), /draft-post/);

  assert.throws(() => buildSite(root, { outputDirectory: '.' }), /输出目录必须严格位于/);
  assert.throws(() => buildSite(root, { outputDirectory: '..' }), /输出目录必须严格位于/);
  assert.throws(() => buildSite(root, { outputDirectory: path.join(os.tmpdir(), 'escaped-dist') }), /输出目录必须严格位于/);
  assert.throws(() => buildSite(root, { postsDirectory: '..' }), /文章目录必须严格位于/);

  const previousIndex = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  writePost(root, '2026-01-04-duplicate.md', { title: '重复文章', date: '2026-01-04', slug: 'newest-post' });
  assert.throws(() => buildSite(root), /重复 slug/);
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8'), previousIndex);

  const encryptedRoot = fixture();
  const secretBody = '只应在解密后出现的正文标记。\n\n## 私密章节\n\n![私密图片](/assets/posts/protected/secret.png)';
  writePost(encryptedRoot, 'protected.md', { title: '受保护文章', slug: 'protected-post', encrypted: 'true' }, secretBody);
  assert.throws(() => buildSite(encryptedRoot), /加密文章 protected-post 缺少至少 8 个字符的密码/);
  assert.ok(!fs.existsSync(path.join(encryptedRoot, 'dist')));

  buildSite(encryptedRoot, { passwords: { 'protected-post': 'correct horse battery staple' } });
  const encryptedArticle = fs.readFileSync(path.join(encryptedRoot, 'dist', 'posts', 'protected-post.html'), 'utf8');
  assert.match(encryptedArticle, /data-article-unlock/);
  assert.match(encryptedArticle, /article-encrypted-payload/);
  assert.match(encryptedArticle, /article-crypto\.js\?v=[a-f0-9]{12}/);
  assert.doesNotMatch(encryptedArticle, /只应在解密后出现的正文标记/);
  assert.doesNotMatch(encryptedArticle, /私密章节/);
  assert.doesNotMatch(encryptedArticle, /href="#section-/);

  const payloadMatch = encryptedArticle.match(/<script id="article-encrypted-payload" type="application\/json" data-slug="protected-post">([^<]+)<\/script>/);
  assert.ok(payloadMatch, 'encrypted payload should be embedded as JSON');
  const payload = JSON.parse(payloadMatch[1]);
  const encryptedBytes = Buffer.from(payload.data, 'base64');
  const ciphertext = encryptedBytes.subarray(0, -16);
  const authTag = encryptedBytes.subarray(-16);
  const key = crypto.pbkdf2Sync('correct horse battery staple', Buffer.from(payload.salt, 'base64'), payload.iterations, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAAD(Buffer.from('hongzh0-blog:protected-post:v1', 'utf8'));
  decipher.setAuthTag(authTag);
  const decrypted = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  assert.match(decrypted.html, /只应在解密后出现的正文标记/);
  assert.match(decrypted.html, /<img loading="lazy" decoding="async"/);
  assert.match(decrypted.toc, /私密章节/);

  const invalidEncryptedRoot = fixture();
  writePost(invalidEncryptedRoot, 'invalid-encrypted.md', { encrypted: 'sometimes' });
  assert.throws(() => buildSite(invalidEncryptedRoot), /encrypted 必须是 true 或 false/);
  assert.ok(!fs.existsSync(path.join(invalidEncryptedRoot, 'dist')));

  const invalidCoverRoot = fixture();
  writePost(invalidCoverRoot, 'invalid-cover.md', { coverText: '123456789' });
  assert.throws(() => buildSite(invalidCoverRoot), /coverText 最多包含 8 个字符/);
  assert.ok(!fs.existsSync(path.join(invalidCoverRoot, 'dist')));

  const invalidDateRoot = fixture();
  writePost(invalidDateRoot, 'invalid.md', { date: '2026-02-30' });
  assert.throws(() => buildSite(invalidDateRoot), /有效的 YYYY-MM-DD/);
  assert.ok(!fs.existsSync(path.join(invalidDateRoot, 'dist')));

  const invalidPublishedAtRoot = fixture();
  writePost(invalidPublishedAtRoot, 'invalid-published-at.md', { publishedAt: '2026-01-02 12:00:00' });
  assert.throws(() => buildSite(invalidPublishedAtRoot), /publishedAt 必须是带时区的 ISO 8601 时间/);
  assert.ok(!fs.existsSync(path.join(invalidPublishedAtRoot, 'dist')));

  const missingRoot = fixture();
  writePost(missingRoot, 'missing.md', { summary: undefined });
  assert.throws(() => buildSite(missingRoot), /缺少必填 front matter：summary/);
  assert.ok(!fs.existsSync(path.join(missingRoot, 'dist')));

  console.log('publisher tests passed');
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

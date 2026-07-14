(() => {
  'use strict';

  const unlock = document.querySelector('[data-article-unlock]');
  const payloadElement = document.getElementById('article-encrypted-payload');
  if (!unlock || !payloadElement) return;

  const form = unlock.querySelector('.article-unlock-form');
  const input = form?.querySelector('input[name="password"]');
  const button = form?.querySelector('button[type="submit"]');
  const status = form?.querySelector('.article-unlock-status');
  if (!form || !input || !button || !status) return;

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function decrypt(payload, password, slug) {
    if (payload.version !== 1 || !Number.isInteger(payload.iterations) || payload.iterations < 10000 || payload.iterations > 1000000) {
      throw new Error('unsupported-payload');
    }
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: decodeBase64(payload.salt),
        iterations: payload.iterations
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeBase64(payload.iv),
        additionalData: new TextEncoder().encode(`hongzh0-blog:${slug}:v1`),
        tagLength: 128
      },
      key,
      decodeBase64(payload.data)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function restoreArticle(content) {
    if (!content || typeof content.html !== 'string' || typeof content.toc !== 'string') {
      throw new Error('invalid-content');
    }
    document.querySelectorAll('.article-toc-nav').forEach(toc => {
      toc.innerHTML = content.toc;
      delete toc.closest('.article-toc')?.dataset.scrollspyReady;
    });
    document.querySelectorAll('.mobile-toc nav').forEach(toc => {
      toc.innerHTML = content.toc;
      delete toc.closest('.mobile-toc')?.dataset.scrollspyReady;
    });
    unlock.insertAdjacentHTML('beforebegin', content.html);
    payloadElement.remove();
    unlock.remove();
    document.querySelector('.article-content')?.setAttribute('data-unlocked', 'true');
    document.dispatchEvent(new CustomEvent('article:unlocked'));
  }

  if (!window.crypto?.subtle || !window.TextEncoder || !window.TextDecoder) {
    input.disabled = true;
    button.disabled = true;
    status.textContent = '当前浏览器不支持安全解密，请升级浏览器后重试。';
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!input.value) return;
    input.removeAttribute('aria-invalid');
    button.disabled = true;
    input.disabled = true;
    status.textContent = '正在本地解密…';

    try {
      const payload = JSON.parse(payloadElement.textContent);
      const content = await decrypt(payload, input.value, payloadElement.dataset.slug || '');
      input.value = '';
      restoreArticle(content);
    } catch (_) {
      input.disabled = false;
      button.disabled = false;
      input.setAttribute('aria-invalid', 'true');
      status.textContent = '密码错误或加密内容已损坏，请重试。';
      input.select();
      input.focus();
    }
  });
})();

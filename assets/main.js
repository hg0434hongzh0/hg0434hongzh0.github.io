(() => {
  'use strict';

  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)');
  const mobileNavigation = window.matchMedia('(max-width: 800px)');
  const visitStatsEndpoint = 'https://cdn.busuanzi.cc/api.php';
  const boundEvents = new WeakMap();
  const revealItems = new Set();
  const refreshers = new Set();
  const filterAnimations = new WeakMap();
  const menuControllers = new WeakMap();
  let revealObserver;
  let activeMenu;
  let themeTransitionRunning = false;
  let visitStatsRequested = false;
  let imageLightbox;

  function bindOnce(target, key, type, listener, options) {
    if (!target) return;
    let keys = boundEvents.get(target);
    if (!keys) {
      keys = new Set();
      boundEvents.set(target, keys);
    }
    if (keys.has(key)) return;
    keys.add(key);
    target.addEventListener(type, listener, options);
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // The selected theme still applies when storage is unavailable.
    }
  }

  function updateThemeControls(theme) {
    document.querySelectorAll('.theme-toggle').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? '切换为浅色主题' : '切换为深色主题');
    });
  }

  function applyTheme(theme, persist = false) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      nextTheme === 'dark' ? '#1b1d19' : '#f5f2eb'
    );
    updateThemeControls(nextTheme);
    if (persist) storageSet('theme', nextTheme);
  }

  function toggleTheme() {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    const update = () => applyTheme(nextTheme, true);

    if (reducedMotion.matches || !document.startViewTransition || themeTransitionRunning) {
      update();
      return;
    }

    root.classList.add('theme-transition');
    themeTransitionRunning = true;
    try {
      const transition = document.startViewTransition(update);
      transition.finished
        .catch(() => {})
        .finally(() => {
          root.classList.remove('theme-transition');
          themeTransitionRunning = false;
        });
    } catch (_) {
      root.classList.remove('theme-transition');
      themeTransitionRunning = false;
      update();
    }
  }

  function initTheme() {
    applyTheme(root.dataset.theme, false);
    document.querySelectorAll('.theme-toggle').forEach(button => {
      bindOnce(button, 'theme-toggle', 'click', toggleTheme);
    });
    bindOnce(preferredDark, 'system-theme', 'change', event => {
      let savedTheme = '';
      try {
        savedTheme = localStorage.getItem('theme') || '';
      } catch (_) {
        // Follow the system preference when storage is unavailable.
      }
      if (savedTheme !== 'light' && savedTheme !== 'dark') {
        applyTheme(event.matches ? 'dark' : 'light', false);
      }
    });
  }

  function focusableElements(container) {
    return [...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden && element.getClientRects().length > 0);
  }

  function initMenu() {
    const button = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.site-nav');
    if (!button || !nav) return;

    const existingController = menuControllers.get(button);
    if (existingController) {
      existingController.syncBreakpoint();
      return;
    }

    if (!nav.id) nav.id = 'site-navigation';
    button.setAttribute('aria-controls', nav.id);

    const controller = {
      button,
      nav,
      open: false,
      previousFocus: null,
      show() {
        if (!mobileNavigation.matches || this.open) return;
        activeMenu?.hide(false);
        this.open = true;
        this.previousFocus = document.activeElement;
        activeMenu = this;
        button.classList.add('open');
        nav.classList.add('open');
        document.body.classList.add('menu-open');
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-label', '关闭导航');
        nav.removeAttribute('aria-hidden');
        requestAnimationFrame(() => focusableElements(nav)[0]?.focus());
      },
      hide(restoreFocus = true) {
        const wasOpen = this.open;
        this.open = false;
        if (activeMenu === this) activeMenu = null;
        button.classList.remove('open');
        nav.classList.remove('open');
        document.body.classList.remove('menu-open');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', '打开导航');
        if (mobileNavigation.matches) nav.setAttribute('aria-hidden', 'true');
        else nav.removeAttribute('aria-hidden');
        if (wasOpen && restoreFocus) {
          const target = this.previousFocus instanceof HTMLElement ? this.previousFocus : button;
          target.focus({ preventScroll: true });
        }
      },
      syncBreakpoint() {
        if (!mobileNavigation.matches) this.hide(false);
        else if (!this.open) nav.setAttribute('aria-hidden', 'true');
      }
    };
    menuControllers.set(button, controller);

    bindOnce(button, 'menu-toggle', 'click', () => {
      if (controller.open) controller.hide();
      else controller.show();
    });
    nav.querySelectorAll('a').forEach(link => {
      bindOnce(link, 'menu-link', 'click', () => controller.hide(false));
    });
    bindOnce(mobileNavigation, 'menu-breakpoint', 'change', () => controller.syncBreakpoint());
    controller.syncBreakpoint();

    bindOnce(document, 'menu-keyboard', 'keydown', event => {
      if (!activeMenu?.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        activeMenu.hide();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [activeMenu.button, ...focusableElements(activeMenu.nav)];
      if (!focusable.length) {
        event.preventDefault();
        activeMenu.button.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeMenu.nav.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    refreshers.add(() => controller.hide(false));
  }

  function initBackToTop() {
    document.querySelectorAll('.back-top').forEach(button => {
      bindOnce(button, 'back-to-top', 'click', () => {
        window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      });
    });
  }

  function animateFilteredItem(item) {
    if (reducedMotion.matches || !item.animate) return;
    filterAnimations.get(item)?.cancel();
    const animation = item.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
    filterAnimations.set(item, animation);
  }

  function initArchiveFilters() {
    document.querySelectorAll('.archive-tools').forEach(tools => {
      if (tools.dataset.filtersReady === 'true') return;
      const buttons = [...tools.querySelectorAll('[data-filter]')];
      if (!buttons.length) return;
      tools.dataset.filtersReady = 'true';
      const scope = tools.closest('section') || document;
      const items = [...scope.querySelectorAll('.archive-item')];

      tools.setAttribute('role', 'group');
      let status = tools.querySelector('.filter-status');
      if (!status) {
        status = document.createElement('span');
        status.className = 'filter-status sr-only';
        status.setAttribute('aria-live', 'polite');
        tools.append(status);
      }

      const activate = button => {
        const filter = button.dataset.filter || 'all';
        buttons.forEach(item => {
          const selected = item === button;
          item.classList.toggle('active', selected);
          item.setAttribute('aria-pressed', String(selected));
        });

        let count = 0;
        items.forEach(item => {
          const visible = filter === 'all' || item.dataset.category === filter;
          const wasHidden = item.hidden || item.classList.contains('hidden');
          item.hidden = !visible;
          item.classList.toggle('hidden', !visible);
          if (visible) {
            count += 1;
            if (wasHidden) animateFilteredItem(item);
          }
        });
        status.textContent = `显示 ${count} 篇文章`;
      };

      buttons.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(button.classList.contains('active')));
        bindOnce(button, 'archive-filter', 'click', () => activate(button));
        bindOnce(button, 'archive-filter-keys', 'keydown', event => {
          let nextIndex;
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
          if (event.key === 'Home') nextIndex = 0;
          if (event.key === 'End') nextIndex = buttons.length - 1;
          if (nextIndex === undefined) return;
          event.preventDefault();
          buttons[nextIndex].focus();
          activate(buttons[nextIndex]);
        });
      });
    });
  }

  function initHomeCatalogPagination() {
    document.querySelectorAll('[data-home-catalog]').forEach(catalog => {
      if (catalog.dataset.paginationReady === 'true') return;
      const items = [...catalog.querySelectorAll('[data-catalog-item]')];
      const pagination = catalog.querySelector('[data-catalog-pagination]');
      const pageSize = Math.max(1, Number.parseInt(catalog.dataset.pageSize || '', 10) || 3);
      const pageCount = Math.ceil(items.length / pageSize);
      if (!items.length || !pagination || pageCount <= 1) return;

      catalog.dataset.paginationReady = 'true';
      const pageButtons = [...pagination.querySelectorAll('[data-catalog-page]')];
      const previousButton = pagination.querySelector('[data-catalog-action="prev"]');
      const nextButton = pagination.querySelector('[data-catalog-action="next"]');
      const status = pagination.querySelector('[data-catalog-status]');

      const requestedPage = () => {
        const value = Number.parseInt(new URL(window.location.href).searchParams.get('page') || '1', 10);
        return Number.isFinite(value) ? Math.min(pageCount, Math.max(1, value)) : 1;
      };

      let currentPage = requestedPage();
      const render = (page, { updateUrl = false, scroll = false } = {}) => {
        currentPage = Math.min(pageCount, Math.max(1, page));
        items.forEach((item, index) => {
          const visible = Math.floor(index / pageSize) + 1 === currentPage;
          const wasHidden = item.hidden;
          item.hidden = !visible;
          if (visible && wasHidden) {
            item.classList.add('is-revealed');
            animateFilteredItem(item);
          }
        });

        pageButtons.forEach(button => {
          const active = Number(button.dataset.catalogPage) === currentPage;
          button.classList.toggle('active', active);
          if (active) button.setAttribute('aria-current', 'page');
          else button.removeAttribute('aria-current');
        });
        previousButton.disabled = currentPage === 1;
        nextButton.disabled = currentPage === pageCount;
        status.textContent = `第 ${currentPage} / ${pageCount} 页`;
        pagination.hidden = false;

        if (updateUrl) {
          const url = new URL(window.location.href);
          if (currentPage === 1) url.searchParams.delete('page');
          else url.searchParams.set('page', String(currentPage));
          history.pushState({ catalogPage: currentPage }, '', `${url.pathname}${url.search}${url.hash}`);
        }
        if (scroll) catalog.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      };

      bindOnce(pagination, 'home-catalog-pages', 'click', event => {
        const button = event.target.closest('button');
        if (!button || button.disabled) return;
        let targetPage = currentPage;
        if (button.dataset.catalogPage) targetPage = Number(button.dataset.catalogPage);
        if (button.dataset.catalogAction === 'prev') targetPage -= 1;
        if (button.dataset.catalogAction === 'next') targetPage += 1;
        if (targetPage === currentPage) return;
        render(targetPage, { updateUrl: true, scroll: true });
      });
      bindOnce(window, 'home-catalog-popstate', 'popstate', () => render(requestedPage()));
      render(currentPage);
    });
  }

  function revealVisibleItems() {
    revealItems.forEach(item => {
      const rect = item.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.94) {
        item.classList.add('is-revealed');
        revealObserver?.unobserve(item);
      }
    });
  }

  function initReveals() {
    const selectors = [
      '.page-hero > *',
      '.section-head',
      '.featured-card',
      '.friend-card',
      '.post-row',
      '.rss-cta > *',
      '.archive-year',
      '.about-grid > *',
      '.article-header > *',
      '.article-cover',
      '.article-content > *',
      '.article-nav'
    ];
    const items = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];

    items.forEach((item, index) => {
      if (revealItems.has(item)) return;
      revealItems.add(item);
      item.classList.add('reveal-item');
      item.style.setProperty('--reveal-order', String(index % 4));
    });

    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
      items.forEach(item => item.classList.add('is-revealed'));
      root.classList.remove('reveal-ready');
      return;
    }

    root.classList.add('reveal-ready');
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    }

    items.forEach(item => {
      if (!item.classList.contains('is-revealed')) revealObserver.observe(item);
    });
    revealVisibleItems();
  }

  async function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('copy failed');
  }

  function initCodeBlocks() {
    const languageNames = {
      bash: 'Shell',
      shell: 'Shell',
      sh: 'Shell',
      powershell: 'PowerShell',
      ps1: 'PowerShell',
      javascript: 'JavaScript',
      js: 'JavaScript',
      typescript: 'TypeScript',
      ts: 'TypeScript',
      java: 'Java',
      python: 'Python',
      py: 'Python',
      xml: 'XML',
      html: 'HTML',
      json: 'JSON',
      yaml: 'YAML',
      yml: 'YAML',
      sql: 'SQL',
      http: 'HTTP'
    };

    document.querySelectorAll('.article-content pre').forEach(pre => {
      if (pre.closest('.code-shell')) return;
      const code = pre.querySelector('code');
      if (!code) return;
      const languageClass = [...code.classList].find(name => name.startsWith('language-'));
      const languageKey = languageClass?.slice('language-'.length).toLowerCase() || 'text';
      const shell = document.createElement('div');
      const toolbar = document.createElement('div');
      const label = document.createElement('span');
      const copy = document.createElement('button');

      shell.className = 'code-shell';
      toolbar.className = 'code-toolbar';
      label.textContent = languageNames[languageKey] || languageKey.toUpperCase();
      copy.className = 'code-copy';
      copy.type = 'button';
      copy.textContent = '复制';
      copy.setAttribute('aria-label', `复制 ${label.textContent} 代码`);

      pre.replaceWith(shell);
      toolbar.append(label, copy);
      shell.append(toolbar, pre);
      bindOnce(copy, 'copy-code', 'click', async () => {
        try {
          await writeClipboard(code.textContent || '');
          copy.textContent = '已复制';
          copy.dataset.copied = 'true';
          window.setTimeout(() => {
            copy.textContent = '复制';
            delete copy.dataset.copied;
          }, 1600);
        } catch (_) {
          copy.textContent = '复制失败';
          window.setTimeout(() => { copy.textContent = '复制'; }, 1600);
        }
      });
    });
  }

  function initReadingProgress() {
    const article = document.querySelector('.article-content');
    if (!article) return;

    let progress = document.querySelector('.reading-progress');
    if (!progress) {
      progress = document.createElement('div');
      progress.className = 'reading-progress';
      progress.setAttribute('aria-hidden', 'true');
      progress.append(document.createElement('span'));
      document.body.prepend(progress);
    }
    const indicator = progress.querySelector('span');
    if (!indicator || progress.dataset.progressReady === 'true') return;
    progress.dataset.progressReady = 'true';

    let frame = 0;
    let measurePending = true;
    let start = 0;
    let end = 0;
    let lastRatio = -1;

    const measure = () => {
      const rect = article.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      start = top - window.innerHeight * 0.25;
      end = top + rect.height - window.innerHeight * 0.75;
      measurePending = false;
    };
    const update = () => {
      frame = 0;
      if (measurePending) measure();
      const ratio = end <= start ? 1 : Math.min(1, Math.max(0, (window.scrollY - start) / (end - start)));
      if (Math.abs(ratio - lastRatio) < 0.0005) return;
      lastRatio = ratio;
      indicator.style.transform = `scaleX(${ratio})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const scheduleMeasure = () => {
      measurePending = true;
      schedule();
    };

    bindOnce(window, 'reading-progress-scroll', 'scroll', schedule, { passive: true });
    bindOnce(window, 'reading-progress-resize', 'resize', scheduleMeasure, { passive: true });
    bindOnce(window, 'reading-progress-load', 'load', scheduleMeasure, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(scheduleMeasure).observe(article);
    refreshers.add(scheduleMeasure);
    scheduleMeasure();
  }

  function initTocScrollSpy() {
    const toc = document.querySelector('.article-toc, .mobile-toc');
    if (toc?.dataset.scrollspyReady === 'true') return;
    const links = [...document.querySelectorAll('.article-toc a[href^="#"], .mobile-toc a[href^="#"]')];
    if (!links.length) return;

    const sections = [];
    const linksById = new Map();
    links.forEach(link => {
      let id;
      try {
        id = decodeURIComponent(link.hash.slice(1));
      } catch (_) {
        id = link.hash.slice(1);
      }
      const section = document.getElementById(id);
      if (!section) return;
      if (!linksById.has(id)) {
        linksById.set(id, []);
        sections.push(section);
      }
      linksById.get(id).push(link);
      bindOnce(link, 'mobile-toc-close', 'click', () => {
        const details = link.closest('.mobile-toc[open]');
        if (details) details.open = false;
      });
    });
    if (!sections.length) return;
    if (toc) toc.dataset.scrollspyReady = 'true';

    let frame = 0;
    let currentId = '';
    let positions = [];
    let documentHeight = 0;
    let measurePending = true;

    const measure = () => {
      positions = sections
        .map(section => ({ section, top: section.getBoundingClientRect().top + window.scrollY }))
        .sort((a, b) => a.top - b.top);
      documentHeight = document.documentElement.scrollHeight;
      measurePending = false;
    };
    const setCurrent = id => {
      if (id === currentId) return;
      if (currentId) {
        linksById.get(currentId)?.forEach(link => {
          link.classList.remove('is-active');
          link.removeAttribute('aria-current');
        });
      }
      currentId = id;
      linksById.get(currentId)?.forEach(link => {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'location');
      });
    };
    const update = () => {
      frame = 0;
      if (measurePending) measure();
      if (!positions.length) return;

      const marker = window.scrollY + window.innerHeight * 0.3;
      let low = 0;
      let high = positions.length - 1;
      let activeIndex = 0;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (positions[middle].top <= marker) {
          activeIndex = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (window.innerHeight + window.scrollY >= documentHeight - 4) activeIndex = positions.length - 1;
      setCurrent(positions[activeIndex].section.id);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const scheduleMeasure = () => {
      measurePending = true;
      schedule();
    };

    links.forEach(link => {
      link.classList.remove('is-active');
      link.removeAttribute('aria-current');
    });
    bindOnce(window, 'toc-scrollspy-scroll', 'scroll', schedule, { passive: true });
    bindOnce(window, 'toc-scrollspy-resize', 'resize', scheduleMeasure, { passive: true });
    bindOnce(window, 'toc-scrollspy-load', 'load', scheduleMeasure, { passive: true });
    const article = document.querySelector('.article-content');
    if (article && 'ResizeObserver' in window) new ResizeObserver(scheduleMeasure).observe(article);
    refreshers.add(scheduleMeasure);
    scheduleMeasure();
  }

  function initVisitStats() {
    if (visitStatsRequested || !document.querySelector('[id^="busuanzi_"]')) return;
    visitStatsRequested = true;
    fetch(visitStatsEndpoint, {
      method: 'POST',
      body: JSON.stringify({ url: window.location.href, referrer: document.referrer })
    })
      .then(response => {
        if (!response.ok) throw new Error(`visit stats request failed: ${response.status}`);
        return response.json();
      })
      .then(counters => {
        Object.entries(counters).forEach(([id, value]) => {
          const element = document.getElementById(id);
          if (element) element.textContent = String(value);
        });
      })
      .catch(() => {
        // Keep the placeholder when the optional statistics service is unavailable.
      });
  }

  function useLocalImageFallback(image) {
    const fallback = image.dataset.fallbackSrc;
    if (!fallback || image.dataset.fallbackAttempted === 'true' || image.getAttribute('src') === fallback) return;
    image.dataset.fallbackAttempted = 'true';
    image.src = fallback;
  }

  function initImageFallbacks() {
    document.querySelectorAll('img[data-fallback-src]').forEach(image => {
      bindOnce(image, 'local-image-fallback', 'error', () => useLocalImageFallback(image), { once: true });
      if (image.complete && image.naturalWidth === 0) useLocalImageFallback(image);
    });
  }

  function imageCaption(image) {
    const figureCaption = image.closest('figure')?.querySelector('figcaption');
    const adjacentCaption = image.parentElement?.querySelector(':scope > em');
    return figureCaption?.textContent?.trim()
      || adjacentCaption?.textContent?.trim()
      || image.getAttribute('alt')?.trim()
      || '文章图片';
  }

  function createImageLightbox() {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图片预览');
    overlay.innerHTML = `
      <div class="image-lightbox-backdrop" data-lightbox-dismiss aria-hidden="true"></div>
      <div class="image-lightbox-shell">
        <div class="image-lightbox-topbar">
          <div class="image-lightbox-meta"><span>IMAGE VIEWER</span><strong data-lightbox-count></strong></div>
          <button class="image-lightbox-close" type="button" aria-label="关闭图片预览"><span aria-hidden="true">×</span></button>
        </div>
        <div class="image-lightbox-stage">
          <button class="image-lightbox-nav image-lightbox-prev" type="button" aria-label="查看上一张图片"><span aria-hidden="true">←</span></button>
          <figure class="image-lightbox-figure">
            <div class="image-lightbox-media is-loading"><img alt=""></div>
            <figcaption data-lightbox-caption></figcaption>
          </figure>
          <button class="image-lightbox-nav image-lightbox-next" type="button" aria-label="查看下一张图片"><span aria-hidden="true">→</span></button>
        </div>
      </div>`;
    document.body.append(overlay);

    const preview = overlay.querySelector('.image-lightbox-media img');
    const media = overlay.querySelector('.image-lightbox-media');
    const caption = overlay.querySelector('[data-lightbox-caption]');
    const counter = overlay.querySelector('[data-lightbox-count]');
    const closeButton = overlay.querySelector('.image-lightbox-close');
    const previousButton = overlay.querySelector('.image-lightbox-prev');
    const nextButton = overlay.querySelector('.image-lightbox-next');
    const controller = {
      overlay,
      preview,
      media,
      caption,
      counter,
      closeButton,
      previousButton,
      nextButton,
      images: [],
      index: 0,
      trigger: null,
      closeTimer: 0
    };

    const showAt = index => {
      if (!controller.images.length) return;
      controller.index = (index + controller.images.length) % controller.images.length;
      const sourceImage = controller.images[controller.index];
      const source = sourceImage.currentSrc || sourceImage.src;
      const fallback = sourceImage.dataset.fallbackSrc || '';
      controller.media.classList.add('is-loading');
      controller.preview.dataset.fallbackSrc = fallback;
      delete controller.preview.dataset.fallbackAttempted;
      controller.preview.alt = sourceImage.alt || '';
      controller.preview.referrerPolicy = sourceImage.referrerPolicy || (source.startsWith('https://gitee.com/') ? 'no-referrer' : '');
      controller.preview.src = source;
      controller.caption.textContent = imageCaption(sourceImage);
      controller.counter.textContent = `${String(controller.index + 1).padStart(2, '0')} / ${String(controller.images.length).padStart(2, '0')}`;
      const multiple = controller.images.length > 1;
      controller.previousButton.hidden = !multiple;
      controller.nextButton.hidden = !multiple;
    };

    const close = () => {
      if (overlay.hidden) return;
      overlay.classList.remove('is-open');
      document.body.classList.remove('lightbox-open');
      window.clearTimeout(controller.closeTimer);
      controller.closeTimer = window.setTimeout(() => {
        overlay.hidden = true;
        preview.removeAttribute('src');
        controller.trigger?.focus({ preventScroll: true });
      }, reducedMotion.matches ? 0 : 260);
    };

    const move = direction => showAt(controller.index + direction);
    bindOnce(closeButton, 'lightbox-close', 'click', close);
    bindOnce(previousButton, 'lightbox-previous', 'click', () => move(-1));
    bindOnce(nextButton, 'lightbox-next', 'click', () => move(1));
    bindOnce(overlay.querySelector('[data-lightbox-dismiss]'), 'lightbox-backdrop', 'click', close);
    bindOnce(preview, 'lightbox-load', 'load', () => media.classList.remove('is-loading'));
    bindOnce(preview, 'lightbox-error', 'error', () => {
      const fallback = preview.dataset.fallbackSrc;
      if (fallback && preview.dataset.fallbackAttempted !== 'true' && preview.getAttribute('src') !== fallback) {
        preview.dataset.fallbackAttempted = 'true';
        preview.referrerPolicy = '';
        preview.src = fallback;
        return;
      }
      media.classList.remove('is-loading');
    });
    bindOnce(document, 'image-lightbox-keydown', 'keydown', event => {
      if (overlay.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowLeft' && controller.images.length > 1) {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'ArrowRight' && controller.images.length > 1) {
        event.preventDefault();
        move(1);
      } else if (event.key === 'Tab') {
        const controls = [previousButton, nextButton, closeButton].filter(button => !button.hidden);
        if (!controls.length) return;
        const current = controls.indexOf(document.activeElement);
        let next = event.shiftKey ? current - 1 : current + 1;
        if (current < 0) next = event.shiftKey ? controls.length - 1 : 0;
        if (next < 0) next = controls.length - 1;
        if (next >= controls.length) next = 0;
        event.preventDefault();
        controls[next].focus();
      }
    });

    controller.open = (trigger, images) => {
      window.clearTimeout(controller.closeTimer);
      controller.trigger = trigger;
      controller.images = images;
      const selectedIndex = images.indexOf(trigger);
      showAt(selectedIndex < 0 ? 0 : selectedIndex);
      overlay.hidden = false;
      document.body.classList.add('lightbox-open');
      requestAnimationFrame(() => {
        overlay.classList.add('is-open');
        closeButton.focus({ preventScroll: true });
      });
    };
    return controller;
  }

  function initImageLightbox() {
    const images = [...document.querySelectorAll('.article-content img')]
      .filter(image => !image.closest('[data-lightbox-ignore]'));
    if (!images.length) return;
    if (!imageLightbox) imageLightbox = createImageLightbox();

    images.forEach(image => {
      image.classList.add('is-lightbox-ready');
      if (!image.closest('a, button, [role="button"]')) {
        image.tabIndex = 0;
        image.setAttribute('role', 'button');
      }
      image.setAttribute('aria-haspopup', 'dialog');
      image.setAttribute('aria-label', `放大图片：${imageCaption(image)}`);
      bindOnce(image, 'open-image-lightbox', 'click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const currentImages = [...document.querySelectorAll('.article-content img.is-lightbox-ready')];
        imageLightbox.open(image, currentImages);
      });
      bindOnce(image, 'open-image-lightbox-keyboard', 'keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        const currentImages = [...document.querySelectorAll('.article-content img.is-lightbox-ready')];
        imageLightbox.open(image, currentImages);
      });
    });
  }

  function init() {
    initTheme();
    initMenu();
    initBackToTop();
    initArchiveFilters();
    initHomeCatalogPagination();
    initCodeBlocks();
    initImageFallbacks();
    initImageLightbox();
    initVisitStats();
    initReveals();
    initReadingProgress();
    initTocScrollSpy();
  }

  bindOnce(document, 'article-unlocked', 'article:unlocked', () => {
    initCodeBlocks();
    initImageFallbacks();
    initImageLightbox();
    initReveals();
    initTocScrollSpy();
    refreshers.forEach(refresh => refresh());
    revealVisibleItems();
  });

  bindOnce(reducedMotion, 'reduced-motion-change', 'change', () => {
    if (reducedMotion.matches) {
      revealObserver?.disconnect();
      revealItems.forEach(item => item.classList.add('is-revealed'));
      root.classList.remove('reveal-ready');
    }
  });
  bindOnce(window, 'page-show', 'pageshow', () => {
    init();
    refreshers.forEach(refresh => refresh());
    revealVisibleItems();
  });
  bindOnce(window, 'page-hide', 'pagehide', () => activeMenu?.hide(false));

  if (document.readyState === 'loading') bindOnce(document, 'dom-ready', 'DOMContentLoaded', init);
  else init();
})();

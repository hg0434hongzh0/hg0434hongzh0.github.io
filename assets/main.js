(() => {
  'use strict';

  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileNavigation = window.matchMedia('(max-width: 800px)');
  const boundEvents = new WeakMap();
  const revealItems = new Set();
  const refreshers = new Set();
  const filterAnimations = new WeakMap();
  const menuControllers = new WeakMap();
  let revealObserver;
  let activeMenu;
  let themeTransitionRunning = false;

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
      nextTheme === 'dark' ? '#1d1f1b' : '#f3f0e9'
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
      { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' }
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
      '.hero > *',
      '.page-hero > *',
      '.section-head',
      '.featured-card',
      '.post-row',
      '.quote-inner > *',
      '.newsletter > *',
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
    const update = () => {
      frame = 0;
      const rect = article.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const bottom = top + rect.height;
      const start = top - window.innerHeight * 0.25;
      const end = bottom - window.innerHeight * 0.75;
      const ratio = end <= start ? 1 : Math.min(1, Math.max(0, (window.scrollY - start) / (end - start)));
      indicator.style.transform = `scaleX(${ratio})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    bindOnce(window, 'reading-progress-scroll', 'scroll', schedule, { passive: true });
    bindOnce(window, 'reading-progress-resize', 'resize', schedule, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(article);
    refreshers.add(schedule);
    schedule();
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
    const update = () => {
      frame = 0;
      const marker = window.scrollY + window.innerHeight * 0.3;
      let activeSection = sections[0];
      sections.forEach(section => {
        const top = section.getBoundingClientRect().top + window.scrollY;
        if (top <= marker) activeSection = section;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        activeSection = sections[sections.length - 1];
      }
      if (activeSection.id === currentId) return;
      currentId = activeSection.id;
      links.forEach(link => {
        let linkId;
        try {
          linkId = decodeURIComponent(link.hash.slice(1));
        } catch (_) {
          linkId = link.hash.slice(1);
        }
        const active = linkId === currentId;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    bindOnce(window, 'toc-scrollspy-scroll', 'scroll', schedule, { passive: true });
    bindOnce(window, 'toc-scrollspy-resize', 'resize', schedule, { passive: true });
    refreshers.add(schedule);
    schedule();
  }

  function init() {
    initTheme();
    initMenu();
    initBackToTop();
    initArchiveFilters();
    initReveals();
    initReadingProgress();
    initTocScrollSpy();
  }

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

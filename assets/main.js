const root = document.documentElement;
const themeButton = document.querySelector('.theme-toggle');
const themeColor = document.querySelector('meta[name="theme-color"]');

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  themeColor?.setAttribute('content', theme === 'dark' ? '#1d1f1b' : '#f3f0e9');
}
themeButton?.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.site-nav');
menuButton?.addEventListener('click', () => {
  const open = menuButton.classList.toggle('open');
  nav?.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  document.body.style.overflow = open ? 'hidden' : '';
});

nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menuButton?.classList.remove('open');
  nav.classList.remove('open');
  document.body.style.overflow = '';
}));

document.querySelector('.back-top')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

document.querySelector('[data-demo-form]')?.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.parentElement.querySelector('.form-message');
  message.textContent = '订阅功能已就绪，接入 Buttondown / Mailchimp 后即可正式使用。';
  form.reset();
});

document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const filter = button.dataset.filter;
    document.querySelectorAll('.archive-item').forEach(item => {
      item.classList.toggle('hidden', filter !== 'all' && item.dataset.category !== filter);
    });
  });
});

'use strict';

(() => {
  const routes = new Set(['home', 'library', 'favorites', 'experiences', 'headphone-test', 'drop-zone']);
  const routeFromHash = () => {
    if (location.hash.startsWith('#track/')) return 'library';
    const route = location.hash.slice(1);
    return routes.has(route) ? route : 'home';
  };
  let current = '';
  function navigate() {
    const route = routeFromHash();
    document.body.dataset.view = route;
    document.querySelectorAll('body > .section .section-inner.reveal').forEach(section => {
      const id = section.closest('section')?.id;
      if (id === route || (route === 'home' && id === 'recent-releases') || (route === 'favorites' && id === 'library')) section.classList.add('is-visible');
    });
    document.querySelectorAll('.header-nav .nav-link, .mobile-nav a').forEach(link => {
      const active = link.getAttribute('href') === `#${route}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (route !== current) { current = route; window.scrollTo({ top: 0, behavior: 'instant' }); }
    window.dispatchEvent(new Event('dtrx-view-change'));
  }
  window.addEventListener('hashchange', navigate);
  navigate();
})();

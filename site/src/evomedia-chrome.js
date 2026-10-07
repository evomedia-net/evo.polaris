// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// evomedia.net site chrome — NOT part of the app.
//
// polaris.evomedia.net is one page of a portfolio, and every other page there
// carries the same header: the mark, the wordmark linking home, and the way
// through to the rest of the work. This adds that.
//
// IT IS DELIBERATELY NOT IN index.html. evo.polaris is meant to be taken and
// self-hosted, and someone who does that should get the app — not a header
// advertising a business they have nothing to do with, with links to another
// person's portfolio. So the chrome lives in this one file, mounts itself only
// on evomedia.net, and no-ops everywhere else. Deleting this file and its one
// import strips every trace of the branding.
//
// The mark is inlined rather than fetched from www.evomedia.net. It is 589
// bytes, and a cross-origin request would make the header the only part of an
// offline-first app that needs the network to draw.

const HOME = 'https://www.evomedia.net';

/** Only on the real site. Any other host — localhost, a fork — gets nothing. */
function isEvomedia(hostname) {
  return hostname === 'evomedia.net' || hostname.endsWith('.evomedia.net');
}

// The reversed mark, for dark surfaces. From www/public/brand.
const MARK = `<svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true" focusable="false">
  <rect width="64" height="64" rx="15" fill="#ffffff"/>
  <g fill="none" stroke="#003366" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M25 18H18v28h7"/><path d="M39 18h7v28h-7"/>
  </g>
  <circle cx="32" cy="32" r="5.5" fill="#336699"/>
</svg>`;

const LINKS = [
  ['Home', `${HOME}/index.html`],
  ['Work', `${HOME}/work.html`],
  ['Projects', `${HOME}/projects.html`],
  ['Resume', `${HOME}/resume.html`],
  ['Contact', `${HOME}/contact.html`],
];

export function mountEvomediaChrome(hostname = window.location.hostname) {
  if (!isEvomedia(hostname)) return false;
  if (document.getElementById('evomediaChrome')) return true;

  const bar = document.createElement('div');
  bar.id = 'evomediaChrome';
  bar.className = 'evo-chrome';

  const brand = document.createElement('a');
  brand.className = 'evo-chrome-brand';
  brand.href = `${HOME}/index.html`;
  // The wordmark going home is the one link people expect to find, and the
  // app's own header below keeps its own identity separate from this one.
  brand.innerHTML = `${MARK}<span>Evomedia<span class="evo-chrome-tld">.net</span></span>`;
  bar.append(brand);

  const nav = document.createElement('nav');
  nav.className = 'evo-chrome-nav';
  nav.setAttribute('aria-label', 'evomedia.net');
  for (const [label, href] of LINKS) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    nav.append(a);
  }
  bar.append(nav);

  document.body.prepend(bar);
  return true;
}

// Small self-hosted icon set in the style of the Tabler icons referenced in
// the mockups (ti-sun-high, ti-cloud, ti-moon-stars, ti-edit, ti-trash).
// Inlined as SVG so the app never fetches a webfont/CDN and stays usable
// fully offline.
function svg(inner, viewBox = '0 0 24 24') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const ICONS = {
  sun: svg(
    '<circle cx="12" cy="12" r="4"></circle>' +
    '<path d="M12 3v1.5M12 19.5V21M4.9 4.9l1.1 1.1M18 18l1.1 1.1M3 12h1.5M19.5 12H21M4.9 19.1l1.1-1.1M18 6l1.1-1.1"></path>'
  ),
  cloud: svg(
    '<path d="M7 18a4 4 0 0 1-.6-7.96A5 5 0 0 1 16 8.05 4.5 4.5 0 0 1 16.5 18H7z"></path>'
  ),
  moon: svg(
    '<path d="M20 13.2A8 8 0 1 1 10.8 4a6.5 6.5 0 0 0 9.2 9.2z"></path>' +
    '<path d="M17 3v3M15.5 4.5h3"></path>'
  ),
  edit: svg(
    '<path d="M13.5 5.5l3 3M4 20l.9-3.6a2 2 0 0 1 .53-.95l9.5-9.5a1.5 1.5 0 0 1 2.12 0l1.03 1.03a1.5 1.5 0 0 1 0 2.12l-9.5 9.5a2 2 0 0 1-.95.53L4 20z"></path>'
  ),
  trash: svg(
    '<path d="M4 7h16"></path>' +
    '<path d="M10 11v6M14 11v6"></path>' +
    '<path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"></path>' +
    '<path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"></path>'
  ),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"></path>'),
  plus: svg('<path d="M12 5v14M5 12h14"></path>'),
  dots: svg(
    '<circle cx="5" cy="12" r="1.4"></circle>' +
    '<circle cx="12" cy="12" r="1.4"></circle>' +
    '<circle cx="19" cy="12" r="1.4"></circle>'
  ),
  close: svg('<path d="M6 6l12 12M18 6L6 18"></path>'),
  download: svg(
    '<path d="M12 4v11"></path>' +
    '<path d="M7.5 11.5L12 16l4.5-4.5"></path>' +
    '<path d="M5 19h14"></path>'
  ),
  upload: svg(
    '<path d="M12 16V5"></path>' +
    '<path d="M7.5 9.5L12 5l4.5 4.5"></path>' +
    '<path d="M5 19h14"></path>'
  ),
};

export function iconMarkup(name) {
  return ICONS[name] || '';
}

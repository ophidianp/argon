// Line icons for the dock, tiles, settings and top bar. 24px grid, drawn with currentColor.
const P = {
  select: '<path d="M5 3.5 18.5 10l-5.8 1.9-2.1 6.1z"/>',
  pen: '<path d="M4 20l1-4.2L15.8 5a2.1 2.1 0 0 1 3 3L8.2 18.9z"/><path d="M13.8 7l3.2 3.2"/>',
  erase: '<path d="M8.5 20H20"/><path d="M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12 19H8.4z"/><path d="M9 10.2l4.8 4.8"/>',
  console: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17"/>',
  stage: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>',
  play: '<path d="M7.5 5v14l11-7z" fill="currentColor"/>',
  note: '<path d="M5 4h14v10.5L13.5 20H5z"/><path d="M13.5 20v-5.5H19"/>',
  checklist: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 12.2l2.8 2.8 5.2-6"/>',
  kanban: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 7.5v8M12 7.5v5M16 7.5v9.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  text: '<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>',
  files: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  git: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="7.5" r="2"/><path d="M6.5 7.5v9M17.5 9.5c0 4.5-6 3.5-10 7.3"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="M20.5 16l-5-5-9 8.5"/>',
  group: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" stroke-dasharray="3.4 3"/>',
  presets: '<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
  prompter: '<path d="M20.5 3.5 3.5 10.6l7 2.9 2.9 7z"/><path d="M10.5 13.5l10-10"/>',
  manager: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  secretary: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  usage: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><path d="M4 20.5h16"/>',
  memory: '<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  board: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  pipeline: '<circle cx="5" cy="12" r="2.3"/><circle cx="19" cy="6" r="2.3"/><circle cx="19" cy="18" r="2.3"/><path d="M7.3 12h2.2c3.2 0 3.2-6 7.2-6M9.5 12c3.2 0 3.2 6 7.2 6"/>',
  look: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-2-.5-1.3.4-2.5 1.8-2.5H18a2.5 2.5 0 0 0 2.5-2.5c0-5.5-3.8-10-8.5-10z"/><circle cx="7.6" cy="11" r="1.1" fill="currentColor"/><circle cx="10.6" cy="7.4" r="1.1" fill="currentColor"/><circle cx="15" cy="8" r="1.1" fill="currentColor"/>',
  glass: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/><path d="M9.2 14.5a2.8 2.8 0 0 0 2.3 2.6"/>',
  background: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="M20.5 16l-5-5-9 8.5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17"/>',
  layout: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M9 3.5v17M9 10h11.5"/>',
  motion: '<path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h7"/>',
  consoles: '<rect x="2.5" y="6" width="14" height="12" rx="2.5"/><path d="M6 10.5l2 1.5-2 1.5"/><path d="M7 3.5h12a2.5 2.5 0 0 1 2.5 2.5v9"/>',
  agents: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 5v3"/><circle cx="12" cy="4" r="1"/><path d="M9.5 13v.5M14.5 13v.5" stroke-width="2.4"/>',
  data: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
};
export const hasIcon = (k) => k in P;
export function icon(k, size = 18) {
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ''}</svg>`;
}
export function iconEl(k, size) { const t = document.createElement('template'); t.innerHTML = icon(k, size); return t.content.firstChild; }
// Fills every element with data-ico="name" in the page.
export function paintIcons(root = document) { root.querySelectorAll('[data-ico]').forEach((el) => { if (!el.querySelector('svg.ico')) el.innerHTML = icon(el.dataset.ico, +el.dataset.size || 18); }); }

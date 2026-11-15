// Router: #tv, #speler (standaard) en #beheer.
import { h, mount, parseHash } from './common.js';
import { startTv } from './tv.js';
import { startSpeler } from './speler.js';
import { startBeheer } from './beheer.js';

function start() {
  const { view, params } = parseHash();
  if (view === 'tv') return startTv(params);
  if (view === 'beheer') return startBeheer(params);
  return startSpeler(params);
}

// Andere weergave of kamercode gekozen: schoon opnieuw beginnen.
window.addEventListener('hashchange', () => location.reload());

if (!window.supabase || !window.KERSTQUIZ_CONFIG) {
  mount(h('div', { class: 'phone-page center' },
    h('p', { class: 'lead' }, 'De app kon niet laden. Controleer de internetverbinding en herlaad de pagina.')));
} else {
  Promise.resolve().then(start).catch((e) => {
    console.error(e);
    mount(h('div', { class: 'phone-page center stack' },
      h('p', { class: 'lead' }, 'Er ging iets mis bij het laden.'),
      h('button', { class: 'btn btn-gold', onclick: () => location.reload() }, 'Opnieuw proberen')));
  });
}

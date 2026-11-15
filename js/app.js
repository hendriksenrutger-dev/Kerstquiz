// Router: #tv, #speler (standaard) en #beheer.
import { h, mount, parseHash } from './common.js';
import { startTv } from './tv.js';
import { startSpeler } from './speler.js';

function start() {
  const { view, params } = parseHash();
  if (view === 'tv') return startTv();
  if (view === 'beheer') {
    document.body.className = 'beheer';
    return mount(h('div', { class: 'beheer-page center stack' },
      h('h1', { class: 'serif' }, 'Beheer'),
      h('p', {}, 'Het beheerscherm komt in de volgende versie. Vragen staan nu nog in supabase/test_vragen.sql.'),
      h('a', { class: 'btn btn-green', href: '#tv' }, 'Naar het tv-scherm'),
    ));
  }
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

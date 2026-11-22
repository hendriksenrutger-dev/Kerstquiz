// Router: #tv, #speler (standaard) en #beheer.
import { h, mount, parseHash, checkVersion } from './common.js?v=74';
import { startTv } from './tv.js?v=74';
import { startSpeler } from './speler.js?v=74';
import { startBeheer } from './beheer.js?v=74';
import { startRemote } from './afstand.js?v=74';

function start() {
  const { view, params } = parseHash();
  if (view === 'tv') return startTv(params);
  if (view === 'beheer') return startBeheer(params);
  if (view === 'afstand') return startRemote(params);
  return startSpeler(params);
}

// Andere weergave of kamercode gekozen: schoon opnieuw beginnen.
window.addEventListener('hashchange', () => location.reload());

checkVersion();

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

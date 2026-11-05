/* Affichage Kumite V2 – studio de diplômes (A4 paysage, impression / PDF) */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const KEY = fmtKey(decodeURIComponent(location.hash.slice(1)));
const SID = `${KEY}/orga`;
const sess = Sess.get(SID);
if (!KEY || !sess){ location.href = 'index.html' + (KEY ? '#' + KEY : ''); return; }
Api.token = sess.token;
$('back').href = 'orga.html#' + KEY;

const DEF = {
  frame: 'tatami', accent: '#1E2B4A', gold: '#C99A55', logo: null, logoH: 24, org: '', medal: true,
  intro: 'est décerné à', footer: '{lieu}, le {date}',
  types: {
    first:  { title: 'Diplôme', rank: '1re place', text: 'pour sa victoire dans la catégorie {pool} lors du tournoi {tournoi}.' },
    second: { title: 'Diplôme', rank: '2e place',  text: 'pour sa deuxième place dans la catégorie {pool} lors du tournoi {tournoi}.' },
    third:  { title: 'Diplôme', rank: '3e place',  text: 'pour sa troisième place dans la catégorie {pool} lors du tournoi {tournoi}.' },
    part:   { title: 'Diplôme de participation', rank: '', text: 'pour sa participation, son courage et son esprit sportif dans la catégorie {pool} lors du tournoi {tournoi}.' },
  },
  signs: [{ name: '', role: 'Le président' }, { name: '', role: "L'arbitre principal" }],
};
let cfg = clone(DEF), tour = null, pools = [], curType = 'first', list = [], saveTimer = null;

const mergeCfg = v => {
  const c = Object.assign(clone(DEF), v || {});
  c.types = Object.assign(clone(DEF.types), (v && v.types) || {});
  for (const k in DEF.types) c.types[k] = Object.assign({}, DEF.types[k], c.types[k]);
  c.signs = [0, 1].map(i => Object.assign({}, DEF.signs[i], ((v && v.signs) || [])[i] || {}));
  return c;
};

/* ---------- chargement ---------- */
async function start(){
  try {
    const [r, d] = await Promise.all([Api.call('sync', { since: 0 }), Api.call('doc_get', { keys: ['diploma'] })]);
    tour = r.tournament;
    pools = r.pools.filter(p => !p.deleted).map(p => p.data)
      .sort((a, b) => (a.tatami || 99) - (b.tatami || 99) || (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(b.name));
    cfg = mergeCfg(d.docs.diploma && d.docs.diploma.value);
    $('brand').textContent = 'Diplômes – ' + tour.name;
    document.title = 'Diplômes – ' + tour.name;
    renderPools(); fillForm(); rebuild();
  } catch(err){
    if (err.code === 'auth'){ Sess.set(SID, null); location.href = 'index.html#' + KEY; return; }
    alert(err.message);
  }
}

/* ---------- qui reçoit quel diplôme ---------- */
const KIND_OF_RANK = r => r === 1 ? 'first' : r === 2 ? 'second' : r === 3 ? 'third' : 'part';
function recipients(){
  const kinds = new Set([...document.querySelectorAll('[data-kind]:checked')].map(i => i.dataset.kind));
  const partAll = $('dPartFor').value === 'all';
  const sel = new Set([...document.querySelectorAll('[data-pool]:checked')].map(i => i.dataset.pool));
  const out = [];
  for (const p of pools){
    if (!sel.has(p.id) || p.participants.length < 1) continue;
    const done = poolDone(p) && realMatches(p).length > 0;
    const medals = done || $('dUnfinished').checked;
    const T = hasResults(p) ? poolTable(p) : p.participants.map(x => ({ name: x.name, dojo: x.dojo, rank: null }));
    for (const r of T){
      const k = medals && r.rank != null ? KIND_OF_RANK(r.rank) : null;
      if (k && k !== 'part' && kinds.has(k)) out.push({ kind: k, rank: r.rank, name: r.name, dojo: r.dojo, pool: p.name });
      if (kinds.has('part') && (partAll || (done && (!k || k === 'part')))) out.push({ kind: 'part', rank: r.rank, name: r.name, dojo: r.dojo, pool: p.name });
    }
  }
  return out;
}
function renderPools(){
  $('dPools').innerHTML = pools.length ? pools.map(p => {
    const done = poolDone(p) && realMatches(p).length > 0;
    return `<label><input type="checkbox" data-pool="${p.id}" ${done ? 'checked' : ''}> ${esc(p.name)} <small>${done ? 'terminé' : hasResults(p) ? 'en cours' : 'pas commencé'} · ${p.participants.length}</small></label>`;
  }).join('') : '<span class="hint">Aucun pool dans ce tournoi.</span>';
}

/* ---------- rendu d'un diplôme ---------- */
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
function fill(tpl, x){
  const data = { nom: x.name, club: x.dojo, pool: x.pool, rang: cfg.types[x.kind].rank, tournoi: tour.name, date: fmtDate(tour.date), lieu: tour.place || '' };
  return esc(String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => data[k] ?? '')).replace(/^,\s*le\s*/, '').replace(/\s+,/g, ',');
}
function diplomaHTML(x){
  const t = cfg.types[x.kind];
  const nl = x.name.length;
  const signs = cfg.signs.filter(s => s.name || s.role);
  const medal = cfg.medal && x.kind !== 'part' && x.rank ? `<span class="dip-medal m${x.rank}">${x.rank}</span>` : '';
  return `<div class="dip f-${cfg.frame}" style="--acc:${cfg.accent};--gold:${cfg.gold}">
    <div class="dip-frame"></div>
    <div class="dip-in">
      <div class="dip-top">${cfg.logo ? `<img src="${cfg.logo}" style="height:${cfg.logoH}mm" alt="">` : ''}${cfg.org ? `<div class="dip-org">${esc(cfg.org)}</div>` : ''}</div>
      <div class="dip-title">${esc(t.title)}</div>
      ${t.rank || medal ? `<div class="dip-rank">${medal}${esc(t.rank)}</div>` : ''}
      <div class="dip-intro">${fill(cfg.intro, x)}</div>
      <div class="dip-name ${nl > 30 ? 'l3' : nl > 22 ? 'l2' : ''}">${esc(x.name)}</div>
      ${x.dojo ? `<div class="dip-club">${esc(x.dojo)}</div>` : ''}
      <div class="dip-rule"></div>
      <div class="dip-text">${fill(t.text, x)}</div>
      <div class="dip-foot">
        <div class="dip-place">${fill(cfg.footer, x)}<br><b>${esc(tour.name)}</b></div>
        <div class="dip-signs">${signs.map(s => `<div class="dip-sign"><div class="ln"><b>${esc(s.name)}</b>${esc(s.role)}</div></div>`).join('')}</div>
      </div>
    </div></div>`;
}
const SAMPLE = () => ({ kind: curType, rank: { first: 1, second: 2, third: 3, part: null }[curType], name: 'Prénom Nom', dojo: 'Nom du club', pool: 'Catégorie' });

function rebuild(){
  list = recipients();
  const counts = { first: 0, second: 0, third: 0, part: 0 };
  list.forEach(x => counts[x.kind]++);
  $('dCount').textContent = list.length
    ? `${list.length} diplôme${list.length > 1 ? 's' : ''} : ${counts.first} × 1re, ${counts.second} × 2e, ${counts.third} × 3e, ${counts.part} × participation.`
    : 'Aucun diplôme : cochez au moins un pool terminé (ou « Inclure les pools pas encore terminés »).';
  $('dPrint').disabled = !list.length;
  const cur = $('dWho').value;
  $('dWho').innerHTML = `<option value="sample">Exemple (${{ first: '1re place', second: '2e place', third: '3e place', part: 'participation' }[curType]})</option>` +
    list.map((x, i) => `<option value="${i}">${esc(x.name)} – ${esc(x.pool)} – ${x.kind === 'part' ? 'participation' : esc(cfg.types[x.kind].rank)}</option>`).join('');
  if ([...$('dWho').options].some(o => o.value === cur)) $('dWho').value = cur;
  preview();
}
function preview(){
  const v = $('dWho').value;
  const x = v === 'sample' || !list[+v] ? SAMPLE() : list[+v];
  $('dSheet').innerHTML = diplomaHTML(x);
  fit();
}
function fit(){
  const d = $('dSheet').querySelector('.dip'); if (!d) return;
  d.style.transform = `scale(${$('dSheet').clientWidth / d.offsetWidth})`;
}
window.addEventListener('resize', fit);

/* ---------- formulaire ---------- */
function fillForm(){
  document.querySelectorAll('[data-c]').forEach(i => { const v = cfg[i.dataset.c]; if (i.type === 'checkbox') i.checked = !!v; else i.value = v ?? ''; });
  document.querySelectorAll('[data-sign]').forEach(i => { const [n, k] = i.dataset.sign.split('.'); i.value = cfg.signs[+n][k] || ''; });
  fillType();
}
function fillType(){
  document.querySelectorAll('#dTypeTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === curType));
  document.querySelectorAll('[data-tt]').forEach(i => i.value = cfg.types[curType][i.dataset.tt] || '');
}
function changed(){
  preview();
  $('saveState').textContent = 'Modifications…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await Api.call('doc_save', { key: 'diploma', value: cfg }); $('saveState').textContent = 'Modèle enregistré'; }
    catch(err){ $('saveState').textContent = ''; toast('Modèle non enregistré : ' + err.message, 5000); }
  }, 700);
}
document.querySelector('.dpanel').addEventListener('input', e => {
  const i = e.target;
  if (i.dataset.c){ cfg[i.dataset.c] = i.type === 'checkbox' ? i.checked : i.type === 'range' ? +i.value : i.value; changed(); }
  else if (i.dataset.tt){ cfg.types[curType][i.dataset.tt] = i.value; changed(); }
  else if (i.dataset.sign){ const [n, k] = i.dataset.sign.split('.'); cfg.signs[+n][k] = i.value; changed(); }
});
document.querySelector('.dpanel').addEventListener('change', e => {
  const i = e.target;
  if (i.dataset.c && (i.type === 'checkbox' || i.tagName === 'SELECT')){ cfg[i.dataset.c] = i.type === 'checkbox' ? i.checked : i.value; changed(); }
  if (i.dataset.pool || i.dataset.kind || i.id === 'dUnfinished' || i.id === 'dPartFor') rebuild();
});
$('dTypeTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  curType = b.dataset.t; fillType();
  if ($('dWho').value === 'sample') rebuild(); else preview();
});
$('dWho').addEventListener('change', preview);
$('dLogo').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
  const img = new Image();
  await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; }).catch(() => null);
  if (!img.width){ alert('Image illisible.'); return; }
  // réduction : 900 px de large au maximum (qualité d'impression suffisante pour un logo de 8 cm)
  const sc = Math.min(1, 900 / img.width), c = document.createElement('canvas');
  c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const isPng = /png|svg|gif|webp/i.test(f.type);
  cfg.logo = c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.9);
  changed();
});
$('dLogoDel').addEventListener('click', () => { cfg.logo = null; changed(); });

/* ---------- impression ---------- */
$('dPrint').addEventListener('click', async () => {
  if (!list.length) return;
  $('printArea').innerHTML = list.map(diplomaHTML).join('');
  await document.fonts.ready;
  const imgs = [...$('printArea').querySelectorAll('img')];
  await Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  window.print();
});
window.addEventListener('afterprint', () => { $('printArea').innerHTML = ''; });

start();
})();

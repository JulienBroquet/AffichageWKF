/* Affichage Kumite V2 – page organisation (inscriptions, pools, répartition sur les tatamis, résultats) */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const KEY = fmtKey(decodeURIComponent(location.hash.slice(1)));
const SID = `${KEY}/orga`;
const sess = Sess.get(SID);
if (!KEY || !sess){ location.href = 'index.html' + (KEY ? '#' + KEY : ''); return; }
Api.token = sess.token;

let tournament = null, competitors = [], rev = 0, offset = 0, online = null;
const pools = {};            // id -> { version, data }
const live = {};             // tatami -> { data, updated_ms }
let editing = null, editingId = null, viewId = null;
const selected = new Set();
let rules = clone(DEFAULT_SETTINGS);

const poolArr = () => Object.values(pools).map(x => x.data)
  .sort((a, b) => (a.tatami || 99) - (b.tatami || 99) || (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(b.name));
const poolMembers = p => competitors.filter(c => inPool(c, p));
const writable = () => tournament && tournament.status === 'active';

/* ------------------------------------------------------------ réseau */
function setNet(v){
  online = v;
  const n = $('net');
  n.className = 'net' + (v ? '' : ' off');
  n.textContent = v ? 'En ligne' : 'Hors ligne';
}
function handleErr(err, prefix){
  if (err.code === 'auth'){ alert('Session expirée. Reconnectez-vous.'); Sess.set(SID, null); location.href = 'index.html#' + KEY; return; }
  if (err.code === 'network') setNet(false);
  toast((prefix ? prefix + ' : ' : '') + err.message, 5000);
}
async function sync(){
  let r;
  try { r = await Api.call('sync', { since: rev }); }
  catch(err){ if (err.code === 'auth') return handleErr(err); setNet(false); return; }
  setNet(true);
  offset = r.now - Date.now();
  const tChanged = !tournament || JSON.stringify(tournament) !== JSON.stringify(r.tournament);
  tournament = r.tournament;
  if (r.full){ competitors = []; for (const k in pools) delete pools[k]; }
  let compChanged = r.full, poolChanged = r.full;
  for (const c of r.competitors || []){
    const i = competitors.findIndex(x => x.id === c.id);
    if (c.deleted){ if (i >= 0) competitors.splice(i, 1); }
    else if (i >= 0) competitors[i] = c; else competitors.push(c);
    compChanged = true;
  }
  if (compChanged) competitors.sort((a, b) => a.name.localeCompare(b.name));
  for (const p of r.pools){
    if (p.deleted) delete pools[p.id];
    else if (!pools[p.id] || p.version >= pools[p.id].version) pools[p.id] = { version: p.version, data: p.data };
    poolChanged = true;
  }
  for (const l of r.live) live[l.tatami] = l;
  rev = r.rev;
  if (tChanged) renderTournament();
  if (compChanged) renderComp();
  if (poolChanged || compChanged) renderPools();
  renderOverview();
  if (!$('poolView').hidden) renderPoolView();
}

/* sauvegarde d'un pool avec reprise automatique en cas de conflit (le mutateur est ré-appliqué sur la version du serveur) */
async function savePool(id, mutate, opts = {}){
  for (let attempt = 0; attempt < 4; attempt++){
    const entry = pools[id];
    const data = entry ? clone(entry.data) : null;
    const next = mutate(data);
    if (!next) return false;
    try {
      const r = await Api.call('pool_save', { pool: next, baseVersion: entry ? entry.version : null });
      pools[next.id] = { version: r.version, data: next };
      return true;
    } catch(err){
      if (err.code === 'conflict' && err.body && err.body.pool){ pools[id] = { version: err.body.pool.version, data: err.body.pool.data }; continue; }
      handleErr(err, opts.what || 'Pool non enregistré'); return false;
    }
  }
  toast('Le pool est modifié en continu par une table : réessayez dans un instant.', 5000);
  return false;
}
/* après un changement de compétiteurs : met à jour les pools pas encore commencés */
async function recomputePools(){
  for (const p of poolArr()){
    if (hasResults(p) || p.current >= 0) continue;
    const test = clone(p);
    if (rebuildPool(test, competitors)) await savePool(p.id, d => { if (!d || hasResults(d) || d.current >= 0) return null; rebuildPool(d, competitors); return d; });
  }
  renderPools(); renderOverview();
}

/* ------------------------------------------------------------ en-tête & onglets */
function renderTournament(){
  if (!tournament) return;
  document.title = `${tournament.name} – Organisation`;
  $('brand').textContent = '🗂️ ' + tournament.name;
  $('keyTag').textContent = tournament.key;
  $('pubLink').href = 'public.html#' + tournament.key;
  $('archived').hidden = tournament.status === 'active';
  if (document.activeElement !== $('tName')) $('tName').value = tournament.name;
  if (document.activeElement !== $('tPlace')) $('tPlace').value = tournament.place || '';
  if (document.activeElement !== $('tTatamis')) $('tTatamis').value = tournament.tatamis;
  rules = clone(DEFAULT_SETTINGS);
  if (tournament.settings) for (const k of ['wkf','k4x15','promo']) Object.assign(rules[k], tournament.settings[k] || {});
  document.querySelectorAll('[data-set]').forEach(inp => {
    if (document.activeElement === inp) return;
    const [a,b] = inp.dataset.set.split('.'); const v = rules[a][b];
    if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v;
  });
  $('eTatami').innerHTML = '<option value="">– non attribué –</option>' + Array.from({ length: tournament.tatamis }, (_, i) => `<option value="${i+1}">Tatami ${i+1}</option>`).join('');
  buildMinis();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
  if (b.dataset.tab === 'results'){ renderRankings(); loadHistory(); }
}));
$('logout').addEventListener('click', async () => { try { await Api.call('logout'); } catch(e){} Sess.set(SID, null); location.href = 'index.html#' + KEY; });
$('copyLink').addEventListener('click', async () => {
  const url = new URL('index.html#' + KEY, location.href).href;
  try { await navigator.clipboard.writeText(url); toast('Lien copié : ' + url); } catch(e){ prompt('Lien à envoyer aux tables de marque :', url); }
});

/* ------------------------------------------------------------ vue d'ensemble */
let minis = [];
function liveState(t){
  const l = live[t];
  if (!l || !l.data) return null;
  const d = l.data, s = normalizeState({});
  Object.assign(s, { mode: d.mode || 'wkf', aka: Object.assign(fighter(), d.aka || {}), ao: Object.assign(fighter(), d.ao || {}), winner: d.winner || null,
    phase: d.phase || 0, screen: 'score', category: d.category || '', tatami: 'Tatami ' + t, pool: null });
  s.settings = clone(rules);
  const tm = d.timer || { running:false, remaining:0 };
  const elapsed = Math.max(0, (Date.now() + offset) - l.updated_ms);
  s.timer = tm.running ? { running: true, remaining: tm.remaining, endAt: Date.now() + tm.remaining - elapsed } : { running: false, remaining: tm.remaining, endAt: 0 };
  return s;
}
function buildMinis(){
  if (!tournament) return;
  if (minis.length === tournament.tatamis) return;
  $('minis').innerHTML = Array.from({ length: tournament.tatamis }, (_, i) => `<div class="mini" data-t="${i+1}">
    <div class="mh"><span>Tatami ${i+1}</span><small data-f="age"></small></div>
    <div class="scr"><div class="d-wrap"></div></div><div class="mf" data-f="foot"></div></div>`).join('');
  minis = Array.from({ length: tournament.tatamis }, (_, i) => {
    const el = $('minis').querySelector(`[data-t="${i+1}"]`);
    const cache = { s: null };
    const board = createBoard(el.querySelector('.d-wrap'), () => cache.s);
    return { t: i + 1, el, board, cache };
  });
}
function renderOverview(){
  if (!tournament) return;
  buildMinis();
  for (const m of minis){
    m.cache.s = liveState(m.t);
    const l = live[m.t];
    const foot = m.el.querySelector('[data-f="foot"]'), age = m.el.querySelector('[data-f="age"]');
    const assigned = poolArr().filter(p => +p.tatami === m.t);
    const remaining = assigned.filter(p => poolStatusOf(p) !== 'done').length;
    if (!l){ foot.textContent = `Table pas encore connectée · ${assigned.length} pool(s) attribué(s)`; age.textContent = ''; m.el.querySelector('.scr').style.opacity = .35; continue; }
    const ago = Math.round(((Date.now() + offset) - l.updated_ms) / 1000);
    age.innerHTML = ago > 25 ? `<span class="pill" style="background:#fee2e2;color:#991b1b">⚠ silencieux depuis ${ago > 90 ? Math.round(ago/60) + ' min' : ago + ' s'}</span>` : '<span class="pill green">en ligne</span>';
    m.el.querySelector('.scr').style.opacity = ago > 25 ? .5 : 1;
    const d = l.data || {};
    foot.innerHTML = (d.poolName ? `<b>${esc(d.poolName)}</b>${d.matchLabel ? ' · ' + esc(d.matchLabel) : ''}` : '<span class="muted">Aucun pool chargé</span>') + ` · ${remaining} pool(s) restant(s)`;
    m.board.render();
  }
  renderTatcol();
}
(function loop(){ for (const m of minis) if (m.cache.s) m.board.renderClock(); requestAnimationFrame(loop); })();

function statusPill(p){
  const s = poolStatusOf(p), RM = realMatches(p), done = RM.filter(m => m.res).length;
  return s === 'done' ? '<span class="pill green">Terminé</span>' : s === 'live' ? `<span class="pill blue">En cours ${done}/${RM.length}</span>` : '<span class="pill grey">Prêt</span>';
}
function renderTatcol(){
  if (!tournament) return;
  const all = poolArr();
  const cols = [...Array.from({ length: tournament.tatamis }, (_, i) => i + 1), 0];
  $('tatcol').innerHTML = cols.map(t => {
    const list = all.filter(p => (+p.tatami || 0) === t);
    return `<div class="tatbox"><h4><span>${t ? 'Tatami ' + t : 'Non attribués'}</span><small class="muted">${list.length} pool(s)</small></h4>
      <div class="porder">${list.map((p, i) => `<div class="prow" data-pid="${p.id}">
        <span class="nm" title="${esc(p.name)}">${esc(p.name)} <small class="muted">· ${p.participants.length}</small></span>${statusPill(p)}
        ${t ? `<button class="btn sm" data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Monter">↑</button><button class="btn sm" data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>` : ''}
        <select data-tat>${['<option value="">–</option>', ...Array.from({ length: tournament.tatamis }, (_, k) => `<option value="${k+1}" ${+p.tatami === k+1 ? 'selected' : ''}>T${k+1}</option>`)].join('')}</select>
      </div>`).join('') || '<span class="muted" style="font-size:13px">—</span>'}</div></div>`;
  }).join('');
}
$('tatcol').addEventListener('change', async e => {
  const sel = e.target.closest('[data-tat]'); if (!sel) return;
  const id = sel.closest('[data-pid]').dataset.pid, t = sel.value ? +sel.value : null;
  const p = pools[id] && pools[id].data;
  if (p && poolStatusOf(p) === 'live' && !confirm(`Le pool « ${p.name} » est en cours. Le déplacer quand même ? (la table actuelle le perdra)`)) { renderTatcol(); return; }
  const maxSort = Math.max(0, ...poolArr().filter(x => +x.tatami === t).map(x => x.sort || 0));
  await savePool(id, d => { d.tatami = t; d.sort = maxSort + 10; return d; });
  renderPools(); renderOverview();
});
$('tatcol').addEventListener('click', async e => {
  const b = e.target.closest('[data-mv]'); if (!b) return;
  const id = b.closest('[data-pid]').dataset.pid, p = pools[id].data;
  const list = poolArr().filter(x => +x.tatami === +p.tatami);
  const i = list.indexOf(p), j = i + +b.dataset.mv;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++){
    const want = (k + 1) * 10;
    if ((list[k].sort || 0) !== want) await savePool(list[k].id, d => { d.sort = want; return d; });
  }
  renderPools(); renderOverview();
});

/* ------------------------------------------------------------ compétiteurs */
$('fGrade').innerHTML = gradeOptions('Grade');
function renderComp(){
  $('compCount').textContent = competitors.length;
  const q = $('search').value.trim().toLowerCase();
  const list = competitors.filter(c => !q || compText(c).includes(q));
  const v = x => x == null ? '' : x;
  $('compBody').innerHTML = list.length ? list.map(c => `
    <tr><td><b>${esc(c.name)}</b></td><td>${esc(c.dojo)}</td><td>${esc(c.sex || '')}</td><td>${esc(v(c.age))}</td>
    <td>${c.weight != null && c.weight !== '' ? esc(c.weight) + ' kg' : ''}</td><td>${esc(gradeLabel(c.grade))}</td><td>${esc(c.category || '')}</td>
    <td class="acts"><button class="btn sm" data-edit="${c.id}" title="Modifier">✎</button>
    <button class="btn sm danger" data-del="${c.id}" title="Supprimer">✕</button></td></tr>`).join('')
    : `<tr><td colspan="8" class="empty">${competitors.length ? 'Aucun résultat.' : 'Aucun compétiteur. Importez un CSV ou ajoutez-les ci-dessus.'}</td></tr>`;
  renderEditor();
}
const form = $('addForm');
function resetForm(){ form.reset(); delete form.dataset.edit; $('addBtn').textContent = 'Ajouter'; $('cancelEdit').hidden = true; }
$('compBody').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.edit){
    const c = competitors.find(x => x.id === b.dataset.edit); if (!c) return;
    const el = form.elements;
    el.name.value = c.name; el.dojo.value = c.dojo || ''; el.sex.value = c.sex || ''; el.age.value = c.age ?? '';
    el.weight.value = c.weight ?? ''; el.grade.value = c.grade ?? ''; el.category.value = c.category || '';
    form.dataset.edit = c.id; $('addBtn').textContent = 'Enregistrer'; $('cancelEdit').hidden = false; el.name.focus();
  } else if (b.dataset.del){
    const c = competitors.find(x => x.id === b.dataset.del);
    if (!c || !confirm(`Supprimer ${c.name} ?`)) return;
    try { await Api.call('comp_delete', { ids: [c.id] }); competitors = competitors.filter(x => x.id !== c.id); renderComp(); await recomputePools(); }
    catch(err){ handleErr(err); }
  }
});
$('cancelEdit').addEventListener('click', resetForm);
$('search').addEventListener('input', renderComp);
form.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(form);
  const name = (fd.get('name') || '').trim(); if (!name) return;
  const data = { id: form.dataset.edit || uid(), name, dojo: (fd.get('dojo') || '').trim(), sex: fd.get('sex') || '', age: numOrNull(fd.get('age')),
    weight: numOrNull(fd.get('weight')), grade: numOrNull(fd.get('grade')), category: (fd.get('category') || '').trim() };
  try {
    await Api.call('comp_save', { items: [data] });
    const i = competitors.findIndex(x => x.id === data.id);
    if (i >= 0) competitors[i] = data; else competitors.push(data);
    competitors.sort((a, b) => a.name.localeCompare(b.name));
    resetForm(); form.elements.name.focus(); renderComp(); await recomputePools();
  } catch(err){ handleErr(err, 'Compétiteur non enregistré'); }
});
$('clearList').addEventListener('click', async () => {
  if (!competitors.length || !confirm(`Supprimer les ${competitors.length} compétiteurs ?`)) return;
  try { await Api.call('comp_delete', { ids: competitors.map(c => c.id) }); competitors = []; renderComp(); await recomputePools(); }
  catch(err){ handleErr(err); }
});
$('dlTemplate').addEventListener('click', () => {
  download('competiteurs_modele.csv', '﻿Nom;Prénom;Dojo;Sexe;Année de naissance;Poids;Grade;Catégorie\nMuller;Léa;Karaté Club Lausanne;F;2014;41.5;5e kyu;\nRossi;Marco;Dojo Genève;M;2013;38;jaune;\n', 'text/csv;charset=utf-8');
});
$('csvFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const added = parseCompetitors(await readTextFile(file));
  if (!added.length){ alert('Aucun compétiteur trouvé dans ce fichier.'); return; }
  const replace = competitors.length && confirm(`${added.length} compétiteurs trouvés.\n\nOK = remplacer la liste actuelle\nAnnuler = les ajouter à la liste`);
  try {
    if (replace) await Api.call('comp_delete', { ids: competitors.map(c => c.id) });
    for (let i = 0; i < added.length; i += 400) await Api.call('comp_save', { items: added.slice(i, i + 400) });
    if (replace) competitors = [];
    competitors.push(...added); competitors.sort((a, b) => a.name.localeCompare(b.name));
    renderComp(); await recomputePools();
    $('compMsg').textContent = `${added.length} compétiteurs importés.`; setTimeout(() => $('compMsg').textContent = '', 4000);
  } catch(err){ handleErr(err, 'Import interrompu'); }
});

/* ------------------------------------------------------------ pools */
function renderPools(){
  const list = poolArr();
  $('poolCount').textContent = list.length;
  const st = { ready:['', 'Prêt'], live:['now', 'En cours'], done:['done', 'Terminé'] };
  $('poolCards').innerHTML = list.length ? list.map(p => {
    const N = p.participants.length, M = realMatches(p).length, done = realMatches(p).filter(m => m.res).length;
    const s = poolStatusOf(p), [cls, lbl] = st[s];
    return `<div class="pcard ${editingId === p.id ? 'editing' : ''}">
      <div class="pc-top"><b>${esc(p.name)}</b><span class="badge ${p.type}">${p.type === 'auto' ? 'Auto' : 'Manuel'}</span></div>
      <div class="pc-meta">${p.tatami ? `<b>Tatami ${p.tatami}</b>` : '<span style="color:#b45309">non attribué</span>'} · ${MODES[p.mode]} · ${N} compétiteur${N>1?'s':''} · ${p.format === 'ko' ? (p.repechage ? 'Tableau + repêchage' : 'Tableau') : `Poule, ${M} combat${M>1?'s':''}`}</div>
      <div class="pc-crit">${esc(critSummary(p))}</div>
      <div><span class="st ${cls}">${lbl}${s !== 'ready' ? ` ${done}/${M}` : ''}</span>${N < 2 ? ' <span class="st" style="background:#fee2e2;color:#991b1b">moins de 2 compétiteurs</span>' : ''}</div>
      <div class="pc-acts">
        <button class="btn sm dark" data-pact="view" data-pid="${p.id}">Voir</button>
        <button class="btn sm" data-pact="edit" data-pid="${p.id}">Modifier</button>
        <button class="btn sm" data-pact="dup" data-pid="${p.id}">Dupliquer</button>
        ${p.format === 'ko' && !hasResults(p) && N >= 2 ? `<button class="btn sm" data-pact="draw" data-pid="${p.id}" title="Nouveau tirage au sort du tableau">Tirage</button>` : ''}
        <button class="btn sm danger" data-pact="del" data-pid="${p.id}" title="Supprimer">✕</button>
      </div></div>`;
  }).join('') : '<div class="empty" style="grid-column:1/-1">Aucun pool. Créez vos pools avec « + Nouveau pool ».</div>';
  let warn = '';
  if (list.length && competitors.length){
    const cnt = new Map();
    list.forEach(p => poolMembers(p).forEach(c => cnt.set(c.id, (cnt.get(c.id) || 0) + 1)));
    const none = competitors.filter(c => !cnt.get(c.id)), multi = competitors.filter(c => cnt.get(c.id) > 1);
    const names = l => l.slice(0, 12).map(c => esc(c.name)).join(', ') + (l.length > 12 ? ` … (+${l.length-12})` : '');
    if (none.length) warn += `<div class="pwarn"><b>${none.length} compétiteur${none.length>1?'s':''} sans pool :</b> ${names(none)}</div>`;
    if (multi.length) warn += `<div class="pwarn"><b>${multi.length} compétiteur${multi.length>1?'s':''} dans plusieurs pools :</b> ${names(multi)}</div>`;
  }
  const unassigned = list.filter(p => !p.tatami).length;
  if (unassigned) warn += `<div class="pwarn"><b>${unassigned} pool${unassigned>1?'s':''} sans tatami</b> : attribuez-les (Modifier, ou dans la vue d'ensemble) pour qu'une table puisse les lancer.</div>`;
  $('poolWarn').innerHTML = warn;
}
$('poolCards').addEventListener('click', async e => {
  const b = e.target.closest('[data-pact]'); if (!b) return;
  const entry = pools[b.dataset.pid]; if (!entry) return;
  const p = entry.data, act = b.dataset.pact;
  if (act === 'view'){ viewId = p.id; renderPoolView(); $('poolView').scrollIntoView({ behavior:'smooth', block:'nearest' }); }
  else if (act === 'edit') openEditor(p);
  else if (act === 'draw'){
    await savePool(p.id, d => { if (hasResults(d)) return null; d.draw = makeDraw(poolMembers(d)); d.sig = null; d.current = -1; rebuildPool(d, competitors); return d; });
    renderPools(); renderPoolView();
  } else if (act === 'dup'){
    const c = Object.assign(clone(p), { id: uid(), name: p.name + ' (copie)', participants: [], matches: [], current: -1, sig: null, draw: null, sort: (p.sort || 0) + 5 });
    rebuildPool(c, competitors);
    if (await savePool(c.id, () => c)){ renderPools(); openEditor(c); }
  } else if (act === 'del'){
    if (!confirm(`Supprimer le pool « ${p.name} »${hasResults(p) ? ' et ses résultats' : ''} ?`)) return;
    try { await Api.call('pool_delete', { id: p.id }); delete pools[p.id]; if (editingId === p.id) closeEditor(); if (viewId === p.id){ viewId = null; $('poolView').hidden = true; } renderPools(); renderOverview(); }
    catch(err){ handleErr(err); }
  }
});
function renderPoolView(){
  const entry = viewId && pools[viewId];
  $('poolView').hidden = !entry;
  if (!entry) return;
  const pool = entry.data;
  $('pvName').textContent = `${pool.name} – ${pool.participants.length} compétiteurs` + (pool.tatami ? ` · tatami ${pool.tatami}` : '');
  const pn = i => i == null ? '<i style="color:var(--muted)">à déterminer</i>' : esc(pool.participants[i].name);
  const order = pool.matches.map((m, i) => i).filter(i => !isBye(pool.matches[i]));
  if (pool.format === 'ko') order.sort((x, y) => koOrderKey(pool, pool.matches[x]) - koOrderKey(pool, pool.matches[y]));
  $('pvMatches').innerHTML = order.map(i => {
    const m = pool.matches[i], r = m.res;
    const stt = i === pool.current ? '<span class="st now">En cours</span>' : r ? '<span class="st done">Terminé</span>' : playable(m) ? '<span class="st">À venir</span>' : '<span class="st">En attente</span>';
    return `<tr><td style="white-space:nowrap">${pool.format === 'ko' ? matchLabel(pool, m) : i + 1}</td><td class="${r && r.winner==='aka'?'wa':''}">${pn(m.a)}</td>
      <td class="res">${r ? `${r.sa} – ${r.sb}` : '–'}</td><td class="${r && r.winner==='ao'?'wb':''}">${pn(m.b)}</td><td>${stt}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">Pas encore de combats (moins de 2 compétiteurs).</td></tr>';
  $('pvRanking').innerHTML = poolTable(pool).map(p => `<tr><td>${p.rank ?? '–'}</td><td><b>${esc(p.name)}</b><br><small style="color:var(--muted)">${esc(p.dojo)}${pool.format === 'ko' ? ' · ' + esc(p.label) : ''}</small></td><td>${p.w}</td><td>${p.l}</td><td>${p.pf}</td><td>${p.pa}</td></tr>`).join('');
}
$('pvClose').addEventListener('click', () => { viewId = null; $('poolView').hidden = true; });

/* éditeur de pool */
$('eGMin').innerHTML = gradeOptions('—'); $('eGMax').innerHTML = gradeOptions('—');
function openEditor(p){
  editingId = p ? p.id : null;
  editing = p ? clone(p) : { name:'', type:'auto', mode:'wkf', ranking:'standard', format:'rr', repechage:true, tatami:null,
    criteria:{ sex:'', ageMin:null, ageMax:null, wMin:null, wMax:null, gMin:null, gMax:null }, memberIds:[] };
  editing.criteria = Object.assign({ sex:'', ageMin:null, ageMax:null, wMin:null, wMax:null, gMin:null, gMax:null }, editing.criteria || {});
  selected.clear(); (editing.memberIds || []).forEach(id => selected.add(id));
  $('eTitle').textContent = p ? `Modifier « ${p.name} »` : 'Nouveau pool';
  $('eName').value = editing.name; $('eType').value = editing.type; $('eMode').value = editing.mode; $('eRank').value = editing.ranking;
  $('eFormat').value = editing.format || 'rr'; $('eRep').checked = editing.repechage !== false;
  $('eTatami').value = editing.tatami || '';
  const k = editing.criteria, v = x => x == null ? '' : x;
  $('eSex').value = k.sex || ''; $('eAgeMin').value = v(k.ageMin); $('eAgeMax').value = v(k.ageMax);
  $('eWMin').value = v(k.wMin); $('eWMax').value = v(k.wMax); $('eGMin').value = v(k.gMin); $('eGMax').value = v(k.gMax);
  const locked = !!(p && hasResults(p));
  $('eLocked').hidden = !locked;
  ['eType','eFormat','eRep','eSex','eAgeMin','eAgeMax','eWMin','eWMax','eGMin','eGMax'].forEach(id => $(id).disabled = locked);
  $('poolEditor').hidden = false;
  renderEditor(); renderPools();
  $('poolEditor').scrollIntoView({ behavior:'smooth', block:'nearest' });
  $('eName').focus();
}
function closeEditor(){ editing = null; editingId = null; $('poolEditor').hidden = true; renderPools(); }
function readEditor(){
  if (!editing) return;
  editing.name = $('eName').value.trim(); editing.type = $('eType').value; editing.mode = $('eMode').value; editing.ranking = $('eRank').value;
  editing.format = $('eFormat').value; editing.repechage = $('eRep').checked; editing.tatami = $('eTatami').value ? +$('eTatami').value : null;
  editing.criteria = { sex:$('eSex').value, ageMin:numOrNull($('eAgeMin').value), ageMax:numOrNull($('eAgeMax').value),
    wMin:numOrNull($('eWMin').value), wMax:numOrNull($('eWMax').value), gMin:numOrNull($('eGMin').value), gMax:numOrNull($('eGMax').value) };
  editing.memberIds = competitors.filter(c => selected.has(c.id)).map(c => c.id);
}
function renderEditor(){
  if (!editing) return;
  $('eAuto').hidden = editing.type !== 'auto'; $('eManual').hidden = editing.type !== 'manual';
  $('eRepWrap').hidden = editing.format !== 'ko'; $('eRankWrap').hidden = editing.format === 'ko';
  if (editing.type === 'manual'){
    const cats = [...new Set(competitors.map(c => c.category).filter(Boolean))].sort();
    const cur = $('eCat').value;
    $('eCat').innerHTML = '<option value="">Toutes</option>' + cats.map(c => `<option ${c===cur?'selected':''}>${esc(c)}</option>`).join('');
    const q = $('eSearch').value.trim().toLowerCase();
    const list = competitors.filter(c => (!$('eCat').value || c.category === $('eCat').value) && (!q || compText(c).includes(q)));
    $('eChecks').innerHTML = list.length ? list.map(c => `<label><input type="checkbox" data-cid="${c.id}" ${selected.has(c.id)?'checked':''}>
      <span>${esc(c.name)}<small>${esc(compInfo(c))}</small></span></label>`).join('')
      : '<div class="empty">Aucun compétiteur. Ajoutez-les dans l\'onglet « Compétiteurs ».</div>';
  }
  const target = editingId && pools[editingId] ? pools[editingId].data : null;
  const mem = target && hasResults(target) ? target.participants : poolMembers(editing);
  const n = mem.length;
  const noCrit = editing.type === 'auto' && !Object.values(editing.criteria).some(x => x !== '' && x != null);
  const nCombats = editing.format === 'ko' ? `tableau de ${n < 2 ? 0 : koSize(n)}${n >= 2 && koSize(n) > n ? ` (${koSize(n)-n} exempt${koSize(n)-n>1?'s':''})` : ''}` : `${n*(n-1)/2} combats`;
  $('eCount').textContent = `${n} compétiteur${n>1?'s':''} · ${nCombats}` + (noCrit ? ' – aucun critère : tous les compétiteurs sont inclus' : '');
  $('ePreview').innerHTML = mem.map(c => {
    const full = competitors.find(x => x.id === c.id) || c;
    return `<span class="chip">${esc(c.name)} <small>${esc(compInfo(full, true))}</small></span>`;
  }).join('');
}
$('poolEditor').addEventListener('input', e => { if (e.target.dataset.cid || e.target.id === 'eSearch') return; readEditor(); renderEditor(); });
$('poolEditor').addEventListener('change', e => {
  if (e.target.dataset.cid){ e.target.checked ? selected.add(e.target.dataset.cid) : selected.delete(e.target.dataset.cid); }
  readEditor(); renderEditor();
});
$('eSearch').addEventListener('input', renderEditor);
$('eAll').addEventListener('click', () => { $('eChecks').querySelectorAll('[data-cid]').forEach(i => selected.add(i.dataset.cid)); readEditor(); renderEditor(); });
$('eNone').addEventListener('click', () => { selected.clear(); readEditor(); renderEditor(); });
$('pNew').addEventListener('click', () => openEditor(null));
$('eCancel').addEventListener('click', closeEditor);
$('eSave').addEventListener('click', async () => {
  readEditor();
  const ed = clone(editing);
  const name = ed.name || critSummary(ed) || ($('eCat').value || 'Pool ' + (poolArr().length + 1));
  let ok;
  if (editingId){
    ok = await savePool(editingId, d => {
      if (!d) return null;
      const tatChanged = +d.tatami !== +ed.tatami;
      Object.assign(d, { name, mode: ed.mode, ranking: ed.ranking, tatami: ed.tatami });
      if (tatChanged) d.sort = Math.max(0, ...poolArr().filter(x => +x.tatami === +ed.tatami).map(x => x.sort || 0)) + 10;
      if (!hasResults(d)){ Object.assign(d, { type: ed.type, criteria: ed.criteria, memberIds: ed.memberIds, format: ed.format, repechage: ed.repechage }); rebuildPool(d, competitors); }
      return d;
    });
  } else {
    const p = { id: uid(), name, type: ed.type, mode: ed.mode, ranking: ed.ranking, criteria: ed.criteria, format: ed.format, repechage: ed.repechage,
      memberIds: ed.memberIds, tatami: ed.tatami, sort: Math.max(0, ...poolArr().filter(x => +x.tatami === +ed.tatami).map(x => x.sort || 0)) + 10,
      participants: [], matches: [], current: -1 };
    rebuildPool(p, competitors);
    ok = await savePool(p.id, () => p);
  }
  if (ok){ editing = null; editingId = null; $('poolEditor').hidden = true; renderPools(); renderOverview(); renderPoolView(); }
});

/* ------------------------------------------------------------ résultats */
function renderRankings(){
  const list = poolArr().filter(p => hasResults(p));
  $('rankings').innerHTML = list.length ? list.map(p => {
    const done = poolDone(p);
    const T = poolTable(p);
    return `<details ${done ? '' : 'open'}><summary><span>${esc(p.name)}</span>${statusPill(p)}</summary>
      <table class="tablelist"><thead><tr><th>Rg</th><th>Nom</th><th>Dojo</th>${p.format === 'ko' ? '<th>Résultat</th>' : ''}<th>V</th><th>D</th><th>Pts +</th><th>Pts −</th></tr></thead>
      <tbody>${T.map(r => `<tr><td><b>${r.rank ?? '–'}</b></td><td>${esc(r.name)}</td><td>${esc(r.dojo)}</td>${p.format === 'ko' ? `<td>${esc(r.label)}</td>` : ''}<td>${r.w}</td><td>${r.l}</td><td>${r.pf}</td><td>${r.pa}</td></tr>`).join('')}</tbody></table></details>`;
  }).join('') : '<div class="empty">Aucun résultat pour l\'instant.</div>';
}
async function loadHistory(){
  try {
    const r = await Api.call('history');
    $('hist').innerHTML = r.results.length ? r.results.map(h => `<tr><td>${new Date(h.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('fr-CH', { hour:'2-digit', minute:'2-digit' })}</td>
      <td>${h.tatami || ''}</td><td>${esc(h.pool_name)}</td><td>${esc(h.label)}</td>
      <td class="${h.winner === 'aka' ? 'wa' : ''}">${esc(h.aka)}</td><td class="res">${h.score_aka} – ${h.score_ao}</td><td class="${h.winner === 'ao' ? 'wb' : ''}">${esc(h.ao)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">Aucun combat terminé.</td></tr>';
  } catch(err){ handleErr(err); }
}
$('histRefresh').addEventListener('click', loadHistory);

/* ------------------------------------------------------------ paramètres */
$('tSave').addEventListener('click', async () => {
  try { await Api.call('tournament_update', { name: $('tName').value, place: $('tPlace').value, tatamis: +$('tTatamis').value }); minis = []; await sync(); toast('Tournoi mis à jour.'); }
  catch(err){ handleErr(err); }
});
document.querySelectorAll('[data-set]').forEach(inp => inp.addEventListener('change', () => {
  const [a,b] = inp.dataset.set.split('.');
  let v = inp.type === 'checkbox' ? inp.checked : Math.max(0, +inp.value || 0);
  if (b === 'duration') v = Math.max(5, v);
  rules[a][b] = v;
}));
$('setSave').addEventListener('click', async () => {
  try {
    const s = { wkf: rules.wkf, k4x15: rules.k4x15, promo: rules.promo };
    await Api.call('tournament_update', { settings: s }); await sync();
    $('setMsg').textContent = 'Règles envoyées aux tables.'; setTimeout(() => $('setMsg').textContent = '', 4000);
  } catch(err){ handleErr(err); }
});

/* ------------------------------------------------------------ sauvegarde & exports */
$('bkSave').addEventListener('click', async () => {
  try { const r = await Api.call('export'); download(`kumite_${KEY}_${stamp()}.json`, JSON.stringify(r.backup, null, 1), 'application/json'); }
  catch(err){ handleErr(err); }
});
$('bkLoad').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch(_) { alert('Ce fichier n\'est pas une sauvegarde valide.'); return; }
  if (!data || data.app !== 'affichage-kumite' || !Array.isArray(data.competitors) || !Array.isArray(data.pools)){ alert('Ce fichier n\'est pas une sauvegarde de l\'affichage kumite.'); return; }
  const isV1 = data.version === 1;
  const plist = data.pools.map(p => Object.assign({}, p, { current: -1, tatami: isV1 ? null : p.tatami }));
  if (isV1 && data.state && data.state.pool){ const i = plist.findIndex(p => p.id === data.state.pool.id); if (i >= 0) plist[i] = Object.assign({}, data.state.pool, { current: -1, tatami: null }); }
  if (!confirm(`Importer ${data.competitors.length} compétiteurs et ${plist.length} pools (sauvegarde ${isV1 ? 'version 1' : 'version 2'}) ?\n\nLes compétiteurs et pools actuels de ce tournoi seront remplacés.`)) return;
  try { await Api.call('import', { competitors: data.competitors, pools: plist }); rev = 0; await sync(); toast('Sauvegarde importée.'); }
  catch(err){ handleErr(err, 'Import impossible'); }
});
const fmtLabel = p => p.format === 'ko' ? (p.repechage ? 'Élimination directe + repêchage' : 'Élimination directe') : 'Poule';
function exportRanks(){
  const list = poolArr().filter(p => hasResults(p)); if (!list.length){ alert('Aucun pool n\'a encore de résultat.'); return; }
  const rows = [['Pool', 'Tatami', 'Format', 'Mode', 'Statut', 'Rang', 'Nom', 'Dojo', 'Résultat', 'Combats', 'Victoires', 'Défaites', 'Points marqués', 'Points encaissés']];
  for (const p of list) for (const r of poolTable(p)) rows.push([p.name, p.tatami || '', fmtLabel(p), MODES[p.mode], poolDone(p) ? 'Terminé' : 'Provisoire', r.rank ?? '', r.name, r.dojo, r.label || '', r.j, r.w, r.l, r.pf, r.pa]);
  download(`kumite_classements_${stamp()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
}
$('exRank').addEventListener('click', exportRanks);
$('exRank2').addEventListener('click', exportRanks);
$('exMatches').addEventListener('click', () => {
  const list = poolArr().filter(p => hasResults(p)); if (!list.length){ alert('Aucun pool n\'a encore de résultat.'); return; }
  const rows = [['Pool', 'Tatami', 'Tour / n°', 'AKA', 'Dojo AKA', 'Score AKA', 'Score AO', 'AO', 'Dojo AO', 'Vainqueur', 'Yuko AKA', 'Waza-ari AKA', 'Ippon AKA', 'Yuko AO', 'Waza-ari AO', 'Ippon AO', 'Senshu', 'Mode']];
  for (const p of list){
    const idx = p.matches.map((m, i) => i).filter(i => p.matches[i].res && !p.matches[i].res.bye);
    if (p.format === 'ko') idx.sort((x, y) => koOrderKey(p, p.matches[x]) - koOrderKey(p, p.matches[y]));
    for (const i of idx){
      const m = p.matches[i], r = m.res, A = p.participants[m.a], B = p.participants[m.b], fa = r.aka || {}, fb = r.ao || {};
      rows.push([p.name, p.tatami || '', p.format === 'ko' ? matchLabel(p, m) : `Combat ${i+1}`, A.name, A.dojo, r.sa, r.sb, B.name, B.dojo, r.winner === 'aka' ? A.name : B.name,
        fa.yuko ?? '', fa.waza ?? '', fa.ippon ?? '', fb.yuko ?? '', fb.waza ?? '', fb.ippon ?? '', fa.senshu ? 'AKA' : fb.senshu ? 'AO' : '', MODES[r.mode] || '']);
    }
  }
  download(`kumite_combats_${stamp()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
});
$('exComp').addEventListener('click', () => {
  if (!competitors.length){ alert('La liste des compétiteurs est vide.'); return; }
  const poolOf = c => poolArr().filter(p => poolMembers(p).some(x => x.id === c.id)).map(p => p.name).join(' / ');
  const rows = [['Nom', 'Dojo', 'Sexe', 'Âge', 'Poids', 'Grade', 'Catégorie', 'Pool(s)']];
  for (const c of competitors) rows.push([c.name, c.dojo, c.sex, c.age ?? '', c.weight != null ? String(c.weight).replace('.', ',') : '', gradeLabel(c.grade), c.category, poolOf(c)]);
  download(`kumite_competiteurs_${stamp()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
});

/* ------------------------------------------------------------ démarrage */
sync();
setInterval(sync, 2500);
setInterval(() => { for (const m of minis){ m.cache.s = liveState(m.t); } }, 1000);
})();

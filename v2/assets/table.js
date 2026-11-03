/* Affichage Kumite V2 – table de marque (un tatami), synchronisée avec le serveur, fonctionne hors ligne */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const [KEY, TATS] = decodeURIComponent(location.hash.slice(1)).split('/');
const TAT = +TATS;
const SID = `${KEY}/t${TAT}`;
const sess = Sess.get(SID);
if (!KEY || !TAT || !sess){ location.href = 'index.html' + (KEY ? '#' + KEY : ''); return; }
Api.token = sess.token;

const STORE_STATE = `kumite2.state.${KEY}.t${TAT}`;
const STORE_CACHE = `kumite2.cache.${KEY}.t${TAT}`;
const DISPLAY_URL = `display.html#${KEY}/${TAT}`;

/* ---------- état local ---------- */
state = normalizeState(load(STORE_STATE, null));
state.tatami = `Tatami ${TAT}`;
const cache = Object.assign({ rev: 0, tournament: null, pools: {}, outbox: [], settingsSig: '' }, load(STORE_CACHE, {}));
// cache.pools : { id: { version, data } } – uniquement les pools de ce tatami
if (state.pool && cache.pools[state.pool.id]) cache.pools[state.pool.id].data = state.pool;   // un seul objet
else if (state.pool) cache.pools[state.pool.id] = { version: 0, data: state.pool };
let tournament = cache.tournament;
let online = null, lastOk = 0;
let history = [];
let alertMsg = '';
let liveDirty = true;
openChannel(`kumite-${KEY}-t${TAT}`);
const preview = createBoard($('previewRoot'));

const poolList = () => Object.values(cache.pools).map(x => x.data).sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(b.name));
function saveLocal(){ save(STORE_STATE, state); save(STORE_CACHE, cache); }
function commit(){
  saveLocal();
  broadcast({ type:'state', state });
  liveDirty = true;
  render();
}
function snapshot(){
  history.push(JSON.stringify({ aka:state.aka, ao:state.ao, winner:state.winner }));
  if (history.length > 100) history.shift();
}
function undo(){
  const h = history.pop(); if (!h) return;
  Object.assign(state, JSON.parse(h)); commit();
}
function playSound(kind){
  const out = state.settings.sound.out;
  if (out === 'control' || out === 'both') playLocal(kind);
  if (out === 'display' || out === 'both') broadcast({ type:'sound', kind });
}

/* ---------- cartes AKA / AO ---------- */
const cardHTML = side => `
  <div class="fhead"><span class="tag">${side.toUpperCase()}</span><span class="ftotal" data-k="total">0</span></div>
  <div class="ffields">
    <label>Nom<input data-in="name" autocomplete="off"></label>
    <label>Dojo<input data-in="dojo" autocomplete="off"></label>
  </div>
  ${[['yuko','Yuko',1],['waza','Waza-ari',2],['ippon','Ippon',3]].map(([k,l,p]) => `
    <div class="srow"><span class="lbl">${l}</span><span class="val" data-k="${k}">0</span>
      <button class="minus" data-score="${k}" data-d="-1" title="Retirer">−</button>
      <button class="plus" data-score="${k}" data-d="1">+ ${l}<small>(${p} pt${p>1?'s':''})</small></button></div>`).join('')}
  <div class="pensec" data-k="pens"></div>
  <div class="factions">
    <button class="btn" data-act="senshu">Senshu</button>
    <button class="btn" data-act="kachi">Déclarer vainqueur</button>
  </div>`;
for (const side of ['aka','ao']){
  const el = $('f-'+side);
  el.innerHTML = cardHTML(side);
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.score) addScore(side, b.dataset.score, +b.dataset.d);
    else if (b.dataset.pen) setPen(side, b.dataset.pen, +b.dataset.lv);
    else if (b.dataset.act === 'senshu') { snapshot(); const v = !state[side].senshu; state.aka.senshu = state.ao.senshu = false; state[side].senshu = v; commit(); }
    else if (b.dataset.act === 'kachi') { snapshot(); state.winner = state.winner === side ? null : side; if (state.winner && state.timer.running) stopTimer(); commit(); }
  });
  el.querySelectorAll('[data-in]').forEach(inp => inp.addEventListener('input', () => { state[side][inp.dataset.in] = inp.value; commit(); }));
}
function addScore(side, kind, d){
  const f = state[side], o = state[side==='aka'?'ao':'aka'];
  if (d < 0 && f[kind] === 0) return;
  snapshot();
  const wasZero = total(f) === 0 && total(o) === 0;
  f[kind] = Math.max(0, f[kind] + d);
  if (state.mode === 'wkf'){
    if (d > 0 && wasZero && state.settings.wkf.autoSenshu && !f.senshu && !o.senshu) f.senshu = true;
    if (d < 0 && total(f) === 0 && f.senshu && state.settings.wkf.autoSenshu) f.senshu = false;
    const gap = state.settings.wkf.gap;
    if (gap > 0 && d > 0 && total(f) - total(o) >= gap){
      if (state.timer.running) stopTimer();
      alertMsg = `Écart de ${gap} points atteint – ${side.toUpperCase()} gagne le combat.`;
    }
  }
  commit();
}
function setPen(side, cat, lv){
  snapshot();
  const k = 'p'+cat;
  state[side][k] = state[side][k] === lv ? lv - 1 : lv;
  if (state[side][k] === 5) alertMsg = `Hansoku pour ${side.toUpperCase()} – victoire de ${side==='aka'?'AO':'AKA'} à déclarer.`;
  commit();
}

/* ---------- chronomètre ---------- */
let lastRem = null;
function startTimer(){
  if (!timerOn() || state.timer.remaining <= 0) return;
  audio();
  if (state.screen !== 'score') state.screen = 'score';
  state.timer.endAt = Date.now() + state.timer.remaining;
  state.timer.running = true; lastRem = state.timer.remaining;
  commit();
}
function stopTimer(){ state.timer.remaining = remainingNow(); state.timer.running = false; commit(); }
function toggleTimer(){ state.timer.running ? stopTimer() : startTimer(); }
function resetTimer(){ state.timer = { running:false, remaining:totalMs(), endAt:0 }; lastRem = null; commit(); }
function adjust(ms){
  const max = Math.max(totalMs(), 60*60*1000);
  if (state.timer.running) state.timer.endAt = Date.now() + Math.min(max, Math.max(0, remainingNow() + ms));
  else state.timer.remaining = Math.min(max, Math.max(0, state.timer.remaining + ms));
  commit();
}
function tick(){
  const rem = remainingNow();
  if (state.timer.running){
    const A = atoshiMs();
    if (A > 0 && lastRem !== null && lastRem > A && rem <= A && rem > 0) playSound('atoshi');
    if (rem <= 0){
      state.timer.running = false; state.timer.remaining = 0;
      if (state.mode === 'k4x15' && state.phase < 3) alertMsg = `Fin de l'assaut ${state.phase+1} – Hantei, puis « Phase suivante ».`;
      else if (state.mode === 'k4x15') alertMsg = 'Fin des 4 assauts – Hantei final.';
      commit(); playSound('end');
    }
  }
  lastRem = rem;
  renderClock();
  preview.renderClock();
}
setInterval(tick, 50);
function setPhase(p){
  const ph = PHASES[state.mode]; if (!ph) return;
  state.phase = Math.min(ph.length-1, Math.max(0, p));
  alertMsg = '';
  state.timer = { running:false, remaining:totalMs(), endAt:0 }; lastRem = null;
  commit();
}

/* ---------- rendu ---------- */
function renderClock(){
  const c = $('cClock');
  if (!timerOn()){ c.textContent = 'Pas de chronomètre'; c.className = 'bigclock off'; return; }
  const rem = remainingNow(), A = atoshiMs();
  c.textContent = fmt(rem);
  c.className = 'bigclock' + (rem <= 0 ? ' ended' : (A > 0 && rem <= A) ? ' warn' : (!state.timer.running ? ' paused' : ''));
  const ss = $('startStop');
  ss.textContent = state.timer.running ? '❚❚ Arrêter (Yame)' : '▶ ' + (rem < totalMs() && rem > 0 ? 'Reprendre' : 'Démarrer');
  ss.classList.toggle('running', state.timer.running);
}
function renderNet(){
  const n = $('net'), pending = cache.outbox.length;
  if (online === null){ n.className = 'net wait'; n.textContent = 'Connexion…'; }
  else if (!online){ n.className = 'net off'; n.textContent = 'Hors ligne' + (pending ? ` · ${pending} en attente` : ''); }
  else if (pending){ n.className = 'net wait'; n.textContent = `Envoi… (${pending})`; }
  else { n.className = 'net'; n.textContent = 'En ligne'; }
  const w = $('offlineWarn');
  w.hidden = online !== false;
  w.textContent = 'Pas de connexion au serveur : vous pouvez continuer les combats, les résultats seront envoyés automatiquement dès le retour du réseau. Ne fermez pas cette page.';
}
function render(){
  const s = state;
  $('brand').textContent = `Tatami ${TAT}` + (tournament ? ` · ${tournament.name}` : '');
  $('mode').value = s.mode;
  if (document.activeElement !== $('category')) $('category').value = s.category;
  for (const side of ['aka','ao']){
    const el = $('f-'+side), f = s[side];
    const q = k => el.querySelector(`[data-k="${k}"]`);
    q('total').textContent = total(f);
    ['yuko','waza','ippon'].forEach(k => q(k).textContent = f[k]);
    el.querySelectorAll('[data-in]').forEach(inp => { if (document.activeElement !== inp) inp.value = f[inp.dataset.in] || ''; });
    const cats = s.mode === 'wkf' ? [[1,'Pénalités']] : [[1,'Cat. 1'],[2,'Cat. 2']];
    q('pens').innerHTML = cats.map(([c,l]) => `<div class="penrow"><span class="pl">${l}</span>` +
      PEN.map((p,i) => `<button class="penbtn ${f['p'+c] > i ? 'on' : ''} ${i===3?'hc':''} ${i===4?'h':''}" data-pen="${c}" data-lv="${i+1}">${p}</button>`).join('') + '</div>').join('');
    const sb = el.querySelector('[data-act="senshu"]');
    sb.hidden = s.mode !== 'wkf'; sb.classList.toggle('toggled', f.senshu);
    const kb = el.querySelector('[data-act="kachi"]');
    kb.classList.toggle('win', s.winner === side);
    kb.textContent = s.winner === side ? '✓ Vainqueur' : 'Déclarer vainqueur';
  }
  const ph = PHASES[s.mode];
  $('phaseCtl').hidden = !ph;
  if (ph){
    const [who, what, counter] = ph[s.phase];
    $('cPhase').textContent = (s.mode==='k4x15'?'Assaut ':'Échange ') + (s.phase+1) + '/' + ph.length + ' · ' + who + ' ' + what + (counter ? ' – ' + counter : '');
    $('prevPhase').disabled = s.phase === 0;
    $('nextPhase').disabled = s.phase >= ph.length-1;
  } else $('cPhase').textContent = 'Kumite WKF · ' + fmt(totalMs());
  preview.render();
  renderPool();
  renderNet();
  document.querySelectorAll('.tctl').forEach(el => el.hidden = !timerOn());
  $('cAlert').hidden = !alertMsg; $('cAlert').textContent = alertMsg;
  $('undo').disabled = !history.length;
  document.querySelectorAll('[data-set]').forEach(inp => {
    if (document.activeElement === inp) return;
    const [a,b] = inp.dataset.set.split('.'); const v = s.settings[a][b];
    if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v;
  });
  renderClock();
}

/* ---------- barre du haut, boutons du chrono ---------- */
$('mode').addEventListener('change', e => {
  state.mode = e.target.value; state.phase = 0; alertMsg = '';
  state.timer = { running:false, remaining:totalMs(), endAt:0 };
  commit();
});
$('category').addEventListener('input', e => { state.category = e.target.value; commit(); });
$('openDisplay').addEventListener('click', () => {
  const w = window.open(DISPLAY_URL, 'kumiteDisplay' + TAT, 'popup,width=1280,height=720');
  if (!w) alert("La fenêtre a été bloquée. Autorisez les fenêtres pop-up pour ce site, ou ouvrez " + DISPLAY_URL + " dans un nouvel onglet.");
  setTimeout(() => broadcast({ type:'state', state }), 800);
});
$('logout').addEventListener('click', async () => {
  if (cache.outbox.length && !confirm(`${cache.outbox.length} résultat(s) n'ont pas encore été envoyés au serveur. Se déconnecter quand même ? (ils restent enregistrés sur ce PC)`)) return;
  try { await Api.call('logout'); } catch(e){}
  Sess.set(SID, null); location.href = 'index.html#' + KEY;
});
$('startStop').addEventListener('click', toggleTimer);
document.querySelectorAll('[data-adj]').forEach(b => b.addEventListener('click', () => adjust(+b.dataset.adj)));
$('resetTimer').addEventListener('click', () => { alertMsg = ''; resetTimer(); });
$('applyTime').addEventListener('click', () => {
  const v = $('setTime').value.trim(); if (!v) return;
  const m = v.match(/^(\d+)(?::(\d{1,2}))?$/); if (!m) { alert('Format attendu : m:ss (ex. 1:30) ou secondes (ex. 90)'); return; }
  const ms = (m[2] !== undefined ? (+m[1]*60 + +m[2]) : +m[1]) * 1000;
  state.timer = { running:false, remaining:ms, endAt:0 }; lastRem = null; $('setTime').value = ''; commit();
});
$('prevPhase').addEventListener('click', () => setPhase(state.phase-1));
$('nextPhase').addEventListener('click', () => setPhase(state.phase+1));
$('undo').addEventListener('click', undo);
$('swapSides').addEventListener('click', () => { state.swap = !state.swap; commit(); });
$('newMatch').addEventListener('click', () => {
  if (!confirm('Démarrer un nouveau combat ? Scores, pénalités, noms et chrono seront remis à zéro.')) return;
  if (state.pool) state.pool.current = -1;
  state.aka = fighter(); state.ao = fighter(); state.winner = null; state.phase = 0; alertMsg = ''; history = [];
  state.timer = { running:false, remaining:totalMs(), endAt:0 };
  commit();
});
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), d = e.shiftKey ? -1 : 1;
  const map = { a:['aka','yuko'], s:['aka','waza'], d:['aka','ippon'], j:['ao','yuko'], k:['ao','waza'], l:['ao','ippon'] };
  if (e.code === 'Space'){ e.preventDefault(); toggleTimer(); }
  else if (map[k]) { e.preventDefault(); addScore(map[k][0], map[k][1], d); }
  else if (k === 'n') setPhase(state.phase+1);
});
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
  if (b.dataset.tab === 'preview') preview.render();
}));
document.querySelectorAll('[data-set]').forEach(inp => inp.addEventListener('change', () => {
  const [a,b] = inp.dataset.set.split('.');
  let v = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' || inp.type === 'range') ? Math.max(0, +inp.value || 0) : inp.value;
  if (b === 'duration') v = Math.max(5, v);
  state.settings[a][b] = v;
  if ((b === 'duration' || b === 'useTimer') && a === state.mode && !state.timer.running) state.timer = { running:false, remaining:totalMs(), endAt:0 };
  commit();
}));
$('testAtoshi').addEventListener('click', () => playSound('atoshi'));
$('testEnd').addEventListener('click', () => playSound('end'));

/* ---------- pools du tatami ---------- */
function nextPool(){
  const list = poolList(), i = list.indexOf(state.pool);
  const order = i >= 0 ? list.slice(i+1).concat(list.slice(0, i)) : list;
  return order.find(p => poolStatusOf(p) !== 'done' && p.participants.length >= 2);
}
function activatePool(p){
  if (state.pool && state.pool !== p && state.pool.current >= 0 && (total(state.aka) || total(state.ao) || state.timer.running)
      && !confirm('Un combat est en cours sur le pool actuel. Le quitter sans enregistrer ?')) return;
  if (state.pool && state.pool !== p) state.pool.current = -1;
  if ((p.participants || []).length < 2){ alert('Ce pool contient moins de 2 compétiteurs.'); return; }
  state.pool = p; state.mode = p.mode || state.mode; state.category = p.name; state.phase = 0;
  state.screen = p.format === 'ko' ? 'bracket' : 'list';
  state.aka = fighter(); state.ao = fighter(); state.winner = null; history = []; alertMsg = '';
  state.timer = { running:false, remaining:totalMs(), endAt:0 }; lastRem = null;
  commit();
}
function loadMatch(i){
  const pool = state.pool, m = pool.matches[i]; if (!m || m.a == null || m.b == null || m.a < 0 || m.b < 0) return;
  pool.current = i;
  const A = pool.participants[m.a], B = pool.participants[m.b];
  state.aka = Object.assign(fighter(), { name:A.name, dojo:A.dojo });
  state.ao  = Object.assign(fighter(), { name:B.name, dojo:B.dojo });
  state.winner = null; state.phase = 0; history = []; alertMsg = '';
  state.timer = { running:false, remaining:totalMs(), endAt:0 }; lastRem = null;
  state.screen = 'callup';
  commit();
}
function finishMatch(){
  const pool = state.pool; if (!pool || pool.current < 0) return;
  if (!state.winner){ alertMsg = 'Déclarez le vainqueur (bouton « Déclarer vainqueur ») avant de terminer le combat.'; render(); return; }
  if (state.timer.running){ state.timer.remaining = remainingNow(); state.timer.running = false; }
  const cur = pool.matches[pool.current];
  const A = pool.participants[cur.a], B = pool.participants[cur.b];
  cur.res = { winner:state.winner, sa:total(state.aka), sb:total(state.ao), aka:clone(state.aka), ao:clone(state.ao), mode:state.mode };
  const record = { rid: uid() + Date.now().toString(36), pool_id: pool.id, pool_name: pool.name, label: matchLabel(pool, cur),
    aka: A.name, aka_dojo: A.dojo, ao: B.name, ao_dojo: B.dojo, sa: cur.res.sa, sb: cur.res.sb, winner: state.winner,
    detail: { aka: cur.res.aka, ao: cur.res.ao, mode: state.mode } };
  if (pool.format === 'ko') koRebuild(pool);
  pool.current = pool.matches.indexOf(cur);
  enqueue(pool.id, record);
  const nx = nextUnplayed(pool, pool.current);
  if (nx >= 0) loadMatch(nx);
  else {
    pool.current = -1; state.screen = 'ranking';
    state.aka = fighter(); state.ao = fighter(); state.winner = null; history = []; alertMsg = '';
    state.timer = { running:false, remaining:totalMs(), endAt:0 };
    commit();
  }
}
$('flStart').addEventListener('click', () => { const pool = state.pool; if (!pool) return; const i = nextUnplayed(pool, -1); if (i >= 0) loadMatch(i); });
$('flHajime').addEventListener('click', () => { state.screen = 'score'; commit(); });
$('flFinish').addEventListener('click', finishMatch);
$('flNextPool').addEventListener('click', () => { const p = nextPool(); if (p) activatePool(p); });
document.querySelectorAll('[data-screen]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.screen === 'callup' && (!state.pool || state.pool.current < 0)) return;
  state.screen = b.dataset.screen; commit();
}));
$('pUnload').addEventListener('click', () => {
  const pool = state.pool; if (!pool) return;
  if (pool.current >= 0 && (total(state.aka) || total(state.ao) || state.timer.running) && !confirm('Un combat est en cours. Le quitter sans enregistrer ?')) return;
  pool.current = -1; state.pool = null; state.screen = 'score';
  state.aka = fighter(); state.ao = fighter(); state.winner = null; history = [];
  commit();
});
$('pvMatches').addEventListener('click', e => {
  const b = e.target.closest('[data-load]'); if (!b) return;
  const i = +b.dataset.load, pool = state.pool;
  if (!canReplay(pool, i)){ alert('Ce combat ne peut plus être rejoué : un des compétiteurs a déjà disputé un combat suivant.'); return; }
  if (pool.current >= 0 && pool.current !== i && (total(state.aka) || total(state.ao) || state.timer.running)
      && !confirm('Le combat en cours n\'est pas terminé. Le quitter sans enregistrer ?')) return;
  loadMatch(i);
});
$('poolCards').addEventListener('click', e => {
  const b = e.target.closest('[data-pact]'); if (!b) return;
  const p = cache.pools[b.dataset.pid]; if (p) activatePool(p.data);
});
function renderPool(){
  const st = { ready:['', 'Prêt'], live:['now', 'En cours'], done:['done', 'Terminé'] };
  const list = poolList();
  $('poolCards').innerHTML = list.length ? list.map(p => {
    const N = p.participants.length, M = realMatches(p).length, done = realMatches(p).filter(m => m.res).length;
    const status = state.pool === p && p.current >= 0 ? 'live' : poolStatusOf(p);
    const [cls, lbl] = st[status];
    const active = state.pool === p;
    return `<div class="pcard ${active ? 'active' : ''}">
      <div class="pc-top"><b>${esc(p.name)}</b><span class="badge">${MODES[p.mode]}</span></div>
      <div class="pc-meta">${N} compétiteur${N>1?'s':''} · ${p.format === 'ko' ? (p.repechage ? 'Tableau + repêchage' : 'Tableau') : `Poule, ${M} combat${M>1?'s':''}`}</div>
      <div class="pc-crit">${esc(critSummary(p))}</div>
      <div><span class="st ${cls}">${lbl}${status !== 'ready' ? ` ${done}/${M}` : ''}</span></div>
      <div class="pc-acts">${active ? '<span class="st now">Sur le tatami</span>' : `<button class="btn sm dark" data-pact="activate" data-pid="${p.id}" ${N < 2 ? 'disabled' : ''}>▶ Sur le tatami</button>`}</div>
    </div>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1">Aucun pool attribué au tatami ${TAT} pour l'instant. L'organisation les attribue depuis sa page ; ils apparaîtront ici automatiquement.<br>Vous pouvez aussi faire un combat libre en saisissant les noms ci-dessus.</div>`;

  const pool = state.pool;
  $('flow').hidden = !pool;
  $('poolView').hidden = !pool;
  if (!pool) return;
  const RM = realMatches(pool), N = RM.length, done = RM.filter(m => m.res).length, allDone = poolDone(pool);
  $('flTitle').textContent = `Pool : ${pool.name} · ${done}/${N} combats terminés`;
  if (pool.current >= 0){
    const m = pool.matches[pool.current];
    $('flMatch').innerHTML = `${matchLabel(pool, m)} : <span class="wa">${esc(pool.participants[m.a].name)}</span> contre <span class="wb">${esc(pool.participants[m.b].name)}</span>`;
  } else $('flMatch').textContent = allDone ? 'Pool terminé – classement final disponible.' : (done ? 'Pool en pause.' : 'Pool prêt, pas encore lancé.');
  const scr = state.screen || 'score';
  document.querySelectorAll('[data-screen]').forEach(b => {
    b.classList.toggle('on', b.dataset.screen === scr);
    if (b.dataset.screen === 'callup') b.disabled = pool.current < 0;
    if (b.dataset.screen === 'bracket') b.hidden = pool.format !== 'ko';
  });
  $('flStart').hidden = pool.current >= 0 || allDone;
  $('flStart').textContent = done ? '▶ Reprendre le pool' : '▶ Lancer le pool';
  $('flHajime').hidden = pool.current < 0 || scr === 'score';
  $('flFinish').hidden = pool.current < 0;
  $('flFinish').textContent = nextUnplayed(pool, pool.current) >= 0 ? 'Terminer le combat ▶ suivant' : 'Terminer le combat ▶ classement';
  const np = allDone ? nextPool() : null;
  $('flNextPool').hidden = !np;
  if (np) $('flNextPool').textContent = `Pool suivant : ${np.name} ▶`;
  $('pvName').textContent = `Sur le tatami : ${pool.name} – ${pool.participants.length} compétiteurs`;
  const pn = i => i == null ? '<i style="color:var(--muted)">à déterminer</i>' : esc(pool.participants[i].name);
  const order = pool.matches.map((m,i) => i).filter(i => !isBye(pool.matches[i]));
  if (pool.format === 'ko') order.sort((x,y) => koOrderKey(pool, pool.matches[x]) - koOrderKey(pool, pool.matches[y]));
  $('pvMatches').innerHTML = order.map(i => {
    const m = pool.matches[i], r = m.res;
    const stt = i === pool.current ? '<span class="st now">En cours</span>' : r ? '<span class="st done">Terminé</span>' : playable(m) ? '<span class="st">À venir</span>' : '<span class="st">En attente</span>';
    const lbl = pool.format === 'ko' ? matchLabel(pool, m) : i+1;
    const btn = i === pool.current || !(playable(m) || r) ? '' : (r && !canReplay(pool, i)) ? '' : `<button class="btn sm" data-load="${i}">${r ? 'Rejouer' : 'Charger'}</button>`;
    return `<tr class="${i===pool.current?'cur':''}"><td style="white-space:nowrap">${lbl}</td>
      <td class="${r && r.winner==='aka'?'wa':''}">${pn(m.a)}</td><td class="res">${r ? `${r.sa} – ${r.sb}` : '–'}</td>
      <td class="${r && r.winner==='ao'?'wb':''}">${pn(m.b)}</td><td>${stt}</td><td class="acts">${btn}</td></tr>`;
  }).join('');
  $('pvRanking').innerHTML = poolTable(pool).map(p => `<tr><td>${p.rank ?? '–'}</td><td><b>${esc(p.name)}</b><br><small style="color:var(--muted)">${esc(p.dojo)}${pool.format === 'ko' ? ' · ' + esc(p.label) : ''}</small></td><td>${p.w}</td><td>${p.l}</td><td>${p.pf}</td><td>${p.pa}</td></tr>`).join('');
  $('pvHint').textContent = pool.format === 'ko'
    ? (pool.repechage ? 'Élimination directe avec repêchage WKF.' : 'Élimination directe sans repêchage.')
    : (pool.ranking === 'points' ? 'Classement aux points marqués.' : 'Classement standard : victoires, confrontation directe, points marqués, points encaissés.');
}

/* ---------- synchronisation avec le serveur ---------- */
function enqueue(poolId, record){
  let item = cache.outbox.find(x => x.poolId === poolId);
  if (!item){ item = { poolId, results: [] }; cache.outbox.push(item); }
  if (record) item.results.push(record);
  saveLocal();
  flush();
}
/* fusion des résultats locaux dans la version du serveur (après un conflit) */
function mergePool(server, local){
  const out = clone(server);
  const sameParts = JSON.stringify((out.participants || []).map(p => p.id)) === JSON.stringify((local.participants || []).map(p => p.id));
  if (!sameParts) return out;  // le pool a été refait par l'organisation : on garde la version du serveur
  const locals = local.matches.map(m => ({ m, key: matchKey(local, m) })).filter(x => x.m.res && !x.m.res.bye);
  if (out.format === 'ko') locals.sort((a, b) => koOrderKey(local, a.m) - koOrderKey(local, b.m));
  for (const { m, key } of locals){
    const t = out.matches.find(x => matchKey(out, x) === key);
    if (t && !t.res && t.a === m.a && t.b === m.b){ t.res = clone(m.res); if (out.format === 'ko') koRebuild(out); }
  }
  const curKey = local.current >= 0 && local.matches[local.current] ? matchKey(local, local.matches[local.current]) : null;
  out.current = curKey ? out.matches.findIndex(x => matchKey(out, x) === curKey && !x.res) : -1;
  return out;
}
function replacePoolData(entry, data){
  // garde le même objet (state.pool y fait référence)
  const obj = entry.data;
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, data);
}
let flushing = false;
async function flush(){
  if (flushing) return; flushing = true;
  try {
    while (cache.outbox.length){
      const item = cache.outbox[0];
      const entry = cache.pools[item.poolId];
      if (!entry){ cache.outbox.shift(); continue; }
      try {
        const r = await Api.call('pool_save', { pool: entry.data, baseVersion: entry.version || null, results: item.results });
        entry.version = r.version;
        cache.outbox.shift();
        setOnline(true);
      } catch(err){
        if (err.code === 'network'){ setOnline(false); break; }
        if (err.code === 'auth'){ handleAuth(); break; }
        if (err.code === 'conflict' && err.body && err.body.pool){
          const sp = err.body.pool;
          replacePoolData(entry, mergePool(sp.data, entry.data));
          entry.version = sp.version;
          if (state.pool === entry.data) state.category = entry.data.name;
          continue;   // on renvoie la version fusionnée
        }
        toast('Résultat non enregistré : ' + err.message, 6000);
        cache.outbox.shift();
      }
    }
  } finally { flushing = false; saveLocal(); render(); }
}
function setOnline(v){ if (v) lastOk = Date.now(); if (online !== v){ online = v; renderNet(); } }
function handleAuth(){
  online = false; renderNet();
  alert('Votre session a expiré ou les codes ont changé. Reconnectez-vous (les résultats non envoyés restent sur ce PC).');
  Sess.set(SID, null); location.href = 'index.html#' + KEY;
}
function applySettings(ts){
  if (!ts) return;
  const sig = JSON.stringify(ts);
  if (sig === cache.settingsSig) return;
  cache.settingsSig = sig;
  for (const k of ['wkf', 'k4x15', 'promo']) if (ts[k]) state.settings[k] = Object.assign({}, state.settings[k], ts[k]);
  if (!state.timer.running && (!state.pool || state.pool.current < 0)) state.timer = { running:false, remaining:totalMs(), endAt:0 };
}
async function sync(){
  let r;
  try { r = await Api.call('sync', { since: cache.rev }); }
  catch(err){ if (err.code === 'auth') return handleAuth(); setOnline(false); return; }
  setOnline(true);
  tournament = cache.tournament = r.tournament;
  applySettings(r.tournament.settings);
  const pendingIds = new Set(cache.outbox.map(x => x.poolId));
  const seen = new Set();
  let changed = false;
  for (const p of r.pools){
    seen.add(p.id);
    const mine = !p.deleted && +p.data.tatami === TAT;
    const entry = cache.pools[p.id];
    if (!mine){
      if (entry && !pendingIds.has(p.id)){
        if (state.pool === entry.data){ state.pool = null; state.screen = 'score'; toast(`Le pool « ${entry.data.name} » a été retiré de ce tatami par l'organisation.`, 6000); }
        delete cache.pools[p.id]; changed = true;
      }
      continue;
    }
    if (!entry){ cache.pools[p.id] = { version: p.version, data: p.data }; changed = true; continue; }
    if (pendingIds.has(p.id) || p.version <= entry.version) continue;
    // nouvelle version venant de l'organisation : on la prend en gardant le combat chargé
    replacePoolData(entry, mergePool(p.data, entry.data));
    entry.version = p.version; changed = true;
    if (state.pool === entry.data){
      state.mode = entry.data.mode || state.mode; state.category = entry.data.name;
      if (entry.data.current < 0 && state.screen === 'callup') state.screen = entry.data.format === 'ko' ? 'bracket' : 'list';
    }
  }
  if (r.full){
    // pools disparus de la réponse complète (supprimés pendant notre absence)
    for (const id of Object.keys(cache.pools)) if (!seen.has(id) && !pendingIds.has(id)){
      if (state.pool === cache.pools[id].data){ state.pool = null; state.screen = 'score'; }
      delete cache.pools[id]; changed = true;
    }
  }
  cache.rev = r.rev;
  if (changed || r.full) commit(); else { saveLocal(); renderNet(); }
  if (cache.outbox.length) flush();
}
async function pushLive(force){
  if (!liveDirty && !force) return;
  liveDirty = false;
  const pool = state.pool, m = pool && pool.current >= 0 ? pool.matches[pool.current] : null;
  const live = { mode: state.mode, aka: state.aka, ao: state.ao, winner: state.winner, phase: state.phase, screen: state.screen, category: state.category,
    timer: { running: state.timer.running, remaining: Math.round(remainingNow()) },
    poolId: pool ? pool.id : null, poolName: pool ? pool.name : '', matchLabel: m ? matchLabel(pool, m) : '' };
  try { await Api.call('live_push', { state: live }, { timeout: 5000 }); setOnline(true); }
  catch(err){ liveDirty = true; if (err.code === 'auth') return handleAuth(); if (err.code === 'network') setOnline(false); }
}
setInterval(() => pushLive(false), 1000);
setInterval(() => pushLive(true), 10000);
setInterval(sync, 2500);
setInterval(() => { if (cache.outbox.length) flush(); }, 5000);
window.addEventListener('online', () => { sync(); flush(); });
window.addEventListener('beforeunload', e => { if (cache.outbox.length){ e.preventDefault(); e.returnValue = ''; } });
if (chan) chan.onmessage = e => { if (e.data && e.data.type === 'hello') broadcast({ type:'state', state }); };
if (state.timer.running && remainingNow() <= 0){ state.timer.running = false; state.timer.remaining = 0; }
commit();
sync();
})();

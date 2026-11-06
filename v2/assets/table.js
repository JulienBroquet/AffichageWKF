/* Hantei – table de marque (un tatami), synchronisée avec le serveur, fonctionne hors ligne */
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
const STORE_SOUNDS = `kumite2.sounds.${KEY}`;
const soundFiles = load(STORE_SOUNDS, {});          // kind -> { v, data, name }
setSoundFileSource(kind => soundFiles[kind]);

/* ---------- état local ---------- */
state = normalizeState(load(STORE_STATE, null));
state.tatami = `Tatami ${TAT}`;
if (state.mode === 'kata' && !state.kata) state.kata = newKata();
const cache = Object.assign({ rev: 0, tournament: null, pools: {}, others: {}, outbox: [], settingsSig: '' }, load(STORE_CACHE, {}));
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
  history.push(JSON.stringify({ aka:state.aka, ao:state.ao, winner:state.winner, kata:state.kata || null, team:state.team || null }));
  if (history.length > 100) history.shift();
}
function undo(){
  const h = history.pop(); if (!h) return;
  const o = JSON.parse(h);
  Object.assign(state, o);
  if (!o.kata) delete state.kata;
  if (!o.team) delete state.team;
  commit();
}
function callText(){
  const pool = state.pool, m = pool && pool.current >= 0 ? pool.matches[pool.current] : null;
  return announceText(soundCfg('voice').template, {
    tatami: TAT, aka: state.aka.name || 'Aka', aka_club: state.aka.dojo || '', ao: state.ao.name || 'Ao', ao_club: state.ao.dojo || '',
    pool: pool ? pool.name : (state.category || ''), tour: m ? (pool.format === 'ko' ? matchLabel(pool, m).replace(' · ', ', ') : 'Combat ' + (pool.current + 1)) : '' });
}
function doCall(){
  const text = callText(), out = state.settings.sound.out;
  if (out === 'display') broadcast({ type:'call', text });
  else playCall(text);
}
async function ensureSoundFiles(){
  const need = ['atoshi', 'end', 'call'].filter(k => { const c = soundCfg(k); return c && c.src === 'file' && (!soundFiles[k] || soundFiles[k].v !== c.v); });
  if (!need.length) return;
  try {
    const r = await Api.call('doc_get', { keys: need.map(k => 'sound_' + k) });
    for (const k of need){ const d = r.docs['sound_' + k]; if (d && d.value) soundFiles[k] = { v: d.version, data: d.value.data, name: d.value.name }; }
    try { localStorage.setItem(STORE_SOUNDS, JSON.stringify(soundFiles)); } catch(e){ toast('Sons personnalisés trop volumineux pour être gardés hors ligne sur ce PC.', 5000); }
  } catch(e){}
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
  } else if (s.mode === 'kata') $('cPhase').textContent = `Kata · ${KATA_SHORT[(s.kata || {}).system || 'votes']} · ${(s.kata || {}).judges || 5} juges` + (timerOn() ? ' · ' + fmt(totalMs()) : '');
  else $('cPhase').textContent = (s.team ? 'Kumite par équipe · ' : 'Kumite WKF · ') + fmt(totalMs());
  $('control').classList.toggle('is-kata', s.mode === 'kata');
  renderKata();
  renderTeam();
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
  if (state.mode === 'kata' && !state.kata) state.kata = newKata();
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
  if (state.kata) state.kata = newKata(state.kata);
  delete state.team;
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
  else if (map[k] && state.mode !== 'kata') { e.preventDefault(); addScore(map[k][0], map[k][1], d); }
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
$('testCall').addEventListener('click', () => doCall());
$('flCall').addEventListener('click', () => doCall());

/* ---------- kata : saisie des juges ---------- */
const KATA_LIST = ['Heian Shodan','Heian Nidan','Heian Sandan','Heian Yondan','Heian Godan','Pinan Shodan','Pinan Nidan','Pinan Sandan','Pinan Yondan','Pinan Godan',
  'Tekki Shodan','Tekki Nidan','Bassai Dai','Bassai Sho','Kanku Dai','Kanku Sho','Jion','Jitte','Enpi','Hangetsu','Gankaku','Chinte','Sochin','Nijushiho','Unsu','Gojushiho Dai','Gojushiho Sho',
  'Seienchin','Saifa','Seipai','Sanseiru','Shisochin','Kururunfa','Suparinpei','Seisan','Sanchin','Tensho','Chatanyara Kushanku','Kosokun Dai','Matsumura Bassai','Anan','Paiku','Heiku','Pachu','Ohan',
  'Kushanku','Wanshu','Rohai','Naihanchi','Chinto','Niseishi','Seishan','Passai','Koryu Bassai','Aoyagi','Annan','Papuren','Unshu','Kanku','Tomari Bassai'];
$('kataNames').innerHTML = KATA_LIST.map(k => `<option value="${k}">`).join('');
let kGridSig = '';
function renderKata(){
  const on = state.mode === 'kata';
  $('kataPanel').hidden = !on;
  if (!on) return;
  const K = fixKata(state.kata || (state.kata = newKata()));
  $('kSys').value = K.system; $('kJudges').value = K.judges; $('kTimer').checked = !!K.timer;
  if (document.activeElement !== $('kKataA')) $('kKataA').value = K.kataA || '';
  if (document.activeElement !== $('kKataB')) $('kKataB').value = K.kataB || '';
  const J = [...Array(K.judges).keys()];
  const sig = K.system + K.judges;
  if (sig !== kGridSig){
    kGridSig = sig;
    const head = `<tr><th></th>${J.map(j => `<th>Juge ${j+1}</th>`).join('')}</tr>`;
    if (K.system === 'flags')
      $('kGrid').innerHTML = `<table>${head}<tr><td class="kside">Drapeau</td>${J.map(j => `<td><div style="display:flex;gap:6px"><button class="kflag a" data-flag="${j}" data-v="aka">AKA</button><button class="kflag b" data-flag="${j}" data-v="ao">AO</button></div></td>`).join('')}</tr></table>`;
    else
      $('kGrid').innerHTML = `<table>${head}
        <tr><td class="kside a">AKA</td>${J.map(j => `<td><input type="number" inputmode="decimal" min="5" max="10" step="0.1" data-ks="sa" data-j="${j}"></td>`).join('')}</tr>
        <tr><td class="kside b">AO</td>${J.map(j => `<td><input type="number" inputmode="decimal" min="5" max="10" step="0.1" data-ks="sb" data-j="${j}"></td>`).join('')}</tr>
        ${K.system === 'votes' ? `<tr><td class="kside">Vote</td>${J.map(j => `<td><span class="kvote" data-kv="${j}">–</span></td>`).join('')}</tr>` : ''}</table>`;
  }
  const d = kataDecision(K);
  $('kGrid').querySelectorAll('[data-flag]').forEach(b => b.classList.toggle('on', K.flags[+b.dataset.flag] === b.dataset.v));
  $('kGrid').querySelectorAll('[data-ks]').forEach(inp => {
    const v = K[inp.dataset.ks][+inp.dataset.j];
    if (document.activeElement !== inp) inp.value = v == null ? '' : v;
    inp.classList.toggle('bad', v != null && !validScore(v));
  });
  $('kGrid').querySelectorAll('[data-kv]').forEach(el => { const v = d.votes[+el.dataset.kv]; el.className = 'kvote' + (v === 'aka' ? ' a' : v === 'ao' ? ' b' : ''); el.textContent = v ? v.toUpperCase() : (validScore(K.sa[+el.dataset.kv]) && validScore(K.sb[+el.dataset.kv]) ? 'égalité !' : '–'); });
  const missing = K.system === 'flags' ? K.flags.filter(f => !f).length : J.filter(j => !(validScore(K.sa[j]) && validScore(K.sb[j]))).length;
  const sc = K.system === 'scores' ? (d.complete ? `AKA <b>${fmtPts(d.ta)}</b> – <b>${fmtPts(d.tb)}</b> AO` : '') : `AKA <b>${d.va}</b> – <b>${d.vb}</b> AO`;
  let txt;
  if (!d.complete) txt = `${sc ? sc + ' · ' : ''}<span class="muted">${missing ? `${missing} juge${missing > 1 ? 's' : ''} à saisir` : 'chaque juge doit départager les deux performances'}</span>`;
  else if (d.winner) txt = `${sc} · Vainqueur : <span class="${d.winner === 'aka' ? 'wa' : 'wb'}">${d.winner.toUpperCase()}</span>`;
  else txt = `${sc} · <b>Égalité</b> – désignez le vainqueur avec « Déclarer vainqueur »`;
  if (state.winner && d.winner && state.winner !== d.winner) txt += ' · <b style="color:#b45309">vainqueur déclaré différent</b>';
  $('kDec').innerHTML = txt;
  $('kReveal').textContent = K.reveal ? 'Masquer la décision' : 'Annoncer la décision';
  $('kReveal').classList.toggle('dark', K.reveal);
}
$('kGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-flag]'); if (!b) return;
  snapshot(); const K = state.kata, j = +b.dataset.flag;
  K.flags[j] = K.flags[j] === b.dataset.v ? null : b.dataset.v; commit();
});
$('kGrid').addEventListener('change', e => {
  const inp = e.target.closest('[data-ks]'); if (!inp) return;
  snapshot();
  const raw = inp.value.replace(',', '.').trim();
  state.kata[inp.dataset.ks][+inp.dataset.j] = raw === '' ? null : num1(raw);
  commit();
});
$('kGrid').addEventListener('keydown', e => {   // Entrée = case suivante
  const inp = e.target.closest('[data-ks]'); if (!inp || e.key !== 'Enter') return;
  e.preventDefault(); inp.dispatchEvent(new Event('change', { bubbles: true }));
  const all = [...$('kGrid').querySelectorAll('[data-ks]')], i = all.indexOf(inp);
  const order = all.slice().sort((x, y) => (+x.dataset.j - +y.dataset.j) || (x.dataset.ks < y.dataset.ks ? -1 : 1));
  const nx = order[order.indexOf(inp) + 1]; if (nx) nx.focus(); else inp.blur();
  void i;
});
$('kSys').addEventListener('change', e => { snapshot(); state.kata.system = e.target.value; state.kata.reveal = false; commit(); });
$('kJudges').addEventListener('change', e => { snapshot(); state.kata.judges = +e.target.value; fixKata(state.kata); state.kata.reveal = false; commit(); });
$('kTimer').addEventListener('change', e => { state.kata.timer = e.target.checked; if (!state.timer.running) state.timer = { running:false, remaining:totalMs(), endAt:0 }; commit(); });
$('kKataA').addEventListener('input', e => { state.kata.kataA = e.target.value; commit(); });
$('kKataB').addEventListener('input', e => { state.kata.kataB = e.target.value; commit(); });
$('kClear').addEventListener('click', () => {
  if (!confirm('Effacer toutes les décisions des juges pour ce tour ?')) return;
  snapshot(); const K = state.kata; Object.assign(K, newKata(K), { kataA: K.kataA, kataB: K.kataB }); state.winner = null; commit();
});
$('kReveal').addEventListener('click', () => {
  const K = state.kata, d = kataDecision(K);
  if (!K.reveal && !d.complete && !confirm('Toutes les décisions ne sont pas saisies. Annoncer quand même ?')) return;
  snapshot();
  K.reveal = !K.reveal;
  if (K.reveal && d.winner) state.winner = d.winner;
  if (K.reveal && state.screen !== 'score') state.screen = 'score';
  commit();
});

/* ---------- kumite par équipe : combats individuels ---------- */
function renderTeam(){
  const T = state.team;
  $('teamPanel').hidden = !T;
  if (!T) return;
  const t = teamTally(T, T.rr), extra = t.needExtra;
  const n = T.bouts.filter(b => !b.extra).length;
  $('tmScore').innerHTML = `<span class="ta">${esc(T.nameA)}</span><span><span class="num">${t.wa}</span><small>${t.pa} pt${t.pa > 1 ? 's' : ''}</small></span>
    <span><span class="num">${t.wb}</span><small>${t.pb} pt${t.pb > 1 ? 's' : ''}</small></span><span class="tb">${esc(T.nameB)}</span>`;
  const used = (side) => new Set(T.bouts.filter(b => !b.extra).map(b => side === 'a' ? b.ia : b.ib));
  const opts = (list, u, cur) => {
    const free = m => extra || !u.has(m.id);
    if (!cur || (cur !== '__ff' && !list.some(m => m.id === cur && free(m)))) cur = (list.find(free) || { id: '__ff' }).id;
    return list.map(m => `<option value="${m.id}" ${cur === m.id ? 'selected' : ''} ${free(m) ? '' : 'disabled'}>${esc(m.name)}${free(m) ? '' : ' (a déjà combattu)'}</option>`).join('')
      + (extra ? '' : `<option value="__ff" ${cur === '__ff' ? 'selected' : ''}>Pas de combattant (forfait)</option>`);
  };
  if (document.activeElement !== $('tmA')) $('tmA').innerHTML = opts(T.membersA, used('a'), T.cur ? T.cur.ia : $('tmA').value);
  if (document.activeElement !== $('tmB')) $('tmB').innerHTML = opts(T.membersB, used('b'), T.cur ? T.cur.ib : $('tmB').value);
  const loaded = !!T.cur;
  $('tmBoutN').textContent = t.done ? 'Rencontre décidée' : extra ? 'Combat décisif' : `Combat ${Math.min(n + 1, T.n)} / ${T.n}`;
  $('tmA').disabled = $('tmB').disabled = loaded || t.done;
  $('tmLoad').hidden = loaded || t.done;
  $('tmRecord').hidden = !loaded; $('tmDraw').hidden = !loaded || extra;
  let msg = '';
  if (t.done) msg = t.draw ? 'Match nul (même nombre de victoires et de points). Cliquez « Terminer la rencontre ».' : `${t.winner === 'aka' ? T.nameA : T.nameB} remporte la rencontre${t.early ? ' (victoire acquise, les combats restants ne sont pas nécessaires' + (T.rr ? ' – en poule, la WKF les fait quand même disputer' : '') + ')' : ''}. Cliquez « Terminer la rencontre ».`;
  else if (extra) msg = 'Égalité de victoires et de points : chaque équipe désigne un de ses membres pour un combat décisif. En cas d\'égalité, décision par Hantei (« Déclarer vainqueur »).';
  else if (loaded) msg = 'Combat en cours : utilisez les boutons de score ci-dessous, déclarez le vainqueur puis « Enregistrer le combat ».';
  $('tmMsg').hidden = !msg; $('tmMsg').textContent = msg;
  $('tmBouts').innerHTML = T.bouts.map((b, i) => `<tr><td>${b.extra ? 'Décisif' : i + 1}</td><td class="${b.winner === 'aka' ? 'wa' : ''}">${esc(b.an)}${b.senshu === 'aka' ? ' <small>(S)</small>' : ''}</td><td class="res">${b.sa} – ${b.sb}</td>
    <td class="${b.winner === 'ao' ? 'wb' : ''}">${esc(b.bn)}${b.senshu === 'ao' ? ' <small>(S)</small>' : ''}</td><td>${b.winner === 'draw' ? 'Hikiwake' : (b.winner === 'aka' ? 'AKA' : 'AO') + (b.kiken ? ' (kiken)' : '')}</td>
    <td class="acts">${i === T.bouts.length - 1 && !loaded ? '<button class="btn sm" data-tmdel title="Annuler ce combat">✕</button>' : ''}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">Choisissez les deux combattants du premier combat puis « Charger ce combat ».</td></tr>';
}
$('tmLoad').addEventListener('click', () => {
  const T = state.team; if (!T) return;
  const ia = $('tmA').value, ib = $('tmB').value;
  if (!ia || !ib){ alert('Choisissez un combattant pour chaque équipe.'); return; }
  if (ia === '__ff' || ib === '__ff'){
    if (ia === '__ff' && ib === '__ff'){ alert('Au moins une des deux équipes doit présenter un combattant.'); return; }
    // combattant absent : KIKEN, victoire de l'adversaire 8 – 0
    const a = T.membersA.find(m => m.id === ia), b = T.membersB.find(m => m.id === ib);
    if (!confirm(`Enregistrer un forfait (Kiken) : victoire ${ia === '__ff' ? 'AO' : 'AKA'} 8 – 0 ?`)) return;
    snapshot();
    T.bouts.push({ ia, ib, an: a ? a.name : '(forfait)', bn: b ? b.name : '(forfait)', sa: ia === '__ff' ? 0 : 8, sb: ia === '__ff' ? 8 : 0,
      winner: ia === '__ff' ? 'ao' : 'aka', senshu: null, extra: false, kiken: true });
    commit(); return;
  }
  const a = T.membersA.find(m => m.id === ia), b = T.membersB.find(m => m.id === ib);
  T.cur = { ia, ib };
  state.aka = Object.assign(fighter(), { name: a.name, dojo: T.nameA });
  state.ao  = Object.assign(fighter(), { name: b.name, dojo: T.nameB });
  state.winner = null; state.phase = 0; history = []; alertMsg = '';
  state.timer = { running:false, remaining:totalMs(), endAt:0 }; lastRem = null;
  state.screen = 'score';
  commit();
});
function recordBout(draw){
  const T = state.team; if (!T || !T.cur) return;
  const extra = teamTally(T, T.rr).needExtra;
  if (draw){
    if (total(state.aka) !== total(state.ao) || state.aka.senshu || state.ao.senshu){ alert('Hikiwake seulement si les scores sont égaux et sans senshu.'); return; }
  } else if (!state.winner){ alert(extra ? 'Désignez le vainqueur du combat décisif (Hantei si égalité) avec « Déclarer vainqueur ».' : 'Déclarez le vainqueur du combat (ou « Hikiwake » en cas d\'égalité).'); return; }
  if (state.timer.running){ state.timer.remaining = remainingNow(); state.timer.running = false; }
  snapshot();
  T.bouts.push({ ia: T.cur.ia, ib: T.cur.ib, an: state.aka.name, bn: state.ao.name, sa: total(state.aka), sb: total(state.ao),
    winner: draw ? 'draw' : state.winner, senshu: state.aka.senshu ? 'aka' : state.ao.senshu ? 'ao' : null, extra,
    aka: clone(state.aka), ao: clone(state.ao) });
  T.cur = null;
  state.aka = Object.assign(fighter(), { name: T.nameA }); state.ao = Object.assign(fighter(), { name: T.nameB });
  state.winner = null; alertMsg = '';
  state.timer = { running:false, remaining:totalMs(), endAt:0 }; lastRem = null;
  commit();
}
$('tmRecord').addEventListener('click', () => recordBout(false));
$('tmDraw').addEventListener('click', () => recordBout(true));
$('tmBouts').addEventListener('click', e => {
  if (!e.target.closest('[data-tmdel]')) return;
  if (!confirm('Annuler le dernier combat enregistré ?')) return;
  snapshot(); state.team.bouts.pop(); commit();
});

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
  state.pool = p; state.mode = isKataDisc(p) ? 'kata' : (p.mode || state.mode); state.category = p.name; state.phase = 0;
  if (isKataDisc(p)) state.kata = newKata(p.kata); else delete state.kata;
  delete state.team;
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
  if (isKataDisc(pool)){ state.mode = 'kata'; state.kata = newKata(Object.assign({}, pool.kata, state.kata ? { system: state.kata.system, judges: state.kata.judges, timer: state.kata.timer } : {})); }
  if (discOf(pool) === 'kumite_team'){
    state.team = { nameA: A.name, nameB: B.name, membersA: clone(A.members || []), membersB: clone(B.members || []),
      n: pool.bouts || 3, rr: pool.format !== 'ko', bouts: [], cur: null };
  } else delete state.team;
  state.timer = { running:false, remaining:totalMs(), endAt:0 }; lastRem = null;
  state.screen = 'callup';
  commit();
  if (soundCfg('voice').auto) doCall();
}
function finishMatch(){
  const pool = state.pool; if (!pool || pool.current < 0) return;
  const cur = pool.matches[pool.current];
  const A = pool.participants[cur.a], B = pool.participants[cur.b];
  let res;
  if (state.team){
    const T = state.team, t = teamTally(T, T.rr);
    if (T.cur){ alertMsg = 'Enregistrez d\'abord le combat individuel en cours (« Enregistrer le combat »).'; render(); return; }
    if (!t.done){ alertMsg = t.needExtra ? 'Égalité parfaite : un combat décisif est nécessaire (une personne désignée par équipe).' : `La rencontre n'est pas terminée (${t.played}/${T.n} combats).`; render(); return; }
    if (t.early && T.rr && !confirm(`L'équipe ${t.winner === 'aka' ? T.nameA : T.nameB} a déjà gagné. En poule, la WKF fait disputer tous les combats. Terminer quand même la rencontre maintenant ?`)) return;
    res = { winner: t.draw ? 'draw' : t.winner, sa: t.wa, sb: t.wb, pa: t.pa, pb: t.pb, bouts: clone(T.bouts), mode: state.mode,
      aka: Object.assign(fighter(), { name: T.nameA }), ao: Object.assign(fighter(), { name: T.nameB }) };
    state.winner = res.winner === 'draw' ? null : res.winner;
  } else if (state.mode === 'kata'){
    const K = state.kata, d = kataDecision(K);
    if (!state.winner && d && d.winner) state.winner = d.winner;
    if (!state.winner){ alertMsg = d && d.tie ? 'Égalité : désignez le vainqueur (« Déclarer vainqueur ») après départage.' : 'Saisissez la décision de tous les juges (ou désignez le vainqueur) avant de terminer.'; render(); return; }
    K.reveal = true;
    const sa = K.system === 'scores' ? (d.ta ?? 0) : d.va, sb = K.system === 'scores' ? (d.tb ?? 0) : d.vb;
    res = { winner: state.winner, sa, sb, kata: clone(K), mode: 'kata', aka: { name: state.aka.name, kata: K.kataA }, ao: { name: state.ao.name, kata: K.kataB } };
  } else {
    if (!state.winner){ alertMsg = 'Déclarez le vainqueur (bouton « Déclarer vainqueur ») avant de terminer le combat.'; render(); return; }
    res = { winner:state.winner, sa:total(state.aka), sb:total(state.ao), aka:clone(state.aka), ao:clone(state.ao), mode:state.mode };
  }
  if (state.timer.running){ state.timer.remaining = remainingNow(); state.timer.running = false; }
  cur.res = res;
  const record = { rid: uid() + Date.now().toString(36), pool_id: pool.id, pool_name: pool.name, label: matchLabel(pool, cur),
    aka: A.name, aka_dojo: A.dojo, ao: B.name, ao_dojo: B.dojo, sa: res.sa, sb: res.sb, winner: res.winner,
    detail: { aka: res.aka, ao: res.ao, mode: res.mode, discipline: discOf(pool), kata: res.kata || undefined, bouts: res.bouts || undefined } };
  if (pool.format === 'ko') koRebuild(pool);
  pool.current = pool.matches.indexOf(cur);
  enqueue(pool.id, record);
  if (pool.stage === 'group' && refreshFinals()) commit();
  const nx = nextUnplayed(pool, pool.current);
  if (nx >= 0) loadMatch(nx);
  else {
    pool.current = -1; state.screen = 'ranking';
    state.aka = fighter(); state.ao = fighter(); state.winner = null; history = []; alertMsg = '';
    delete state.team; if (state.kata) state.kata = newKata(state.kata);
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
  state.aka = fighter(); state.ao = fighter(); state.winner = null; history = []; delete state.team;
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
      <div class="pc-top"><b>${esc(p.name)}</b><span class="badge disc-${discOf(p)}">${DISC_SHORT[discOf(p)]}</span><span class="badge">${isKataDisc(p) ? KATA_SHORT[(p.kata || {}).system || 'votes'] : MODES[p.mode]}</span></div>
      <div class="pc-meta">${unitText(p, N)} · ${p.format === 'ko' ? (p.repechage ? 'Tableau + repêchage' : 'Tableau') : `Poule, ${M} ${matchWord(p)}`}</div>
      <div class="pc-crit">${esc(critSummary(p))}</div>
      <div><span class="st ${cls}">${lbl}${status !== 'ready' ? ` ${done}/${M}` : ''}</span>${p.waiting ? ` <span class="st" style="background:#fff3d6;color:#8a5a00">${esc(waitText(p))}</span>` : ''}</div>
      <div class="pc-acts">${active ? '<span class="st now">Sur le tatami</span>' : `<button class="btn sm dark" data-pact="activate" data-pid="${p.id}" ${N < 2 ? 'disabled' : ''}>▶ Sur le tatami</button>`}</div>
    </div>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1">Aucun pool attribué au tatami ${TAT} pour l'instant. L'organisation les attribue depuis sa page ; ils apparaîtront ici automatiquement.<br>Vous pouvez aussi faire un combat libre en saisissant les noms ci-dessus.</div>`;

  const pool = state.pool;
  $('flow').hidden = !pool;
  $('poolView').hidden = !pool;
  if (!pool) return;
  const RM = realMatches(pool), N = RM.length, done = RM.filter(m => m.res).length, allDone = poolDone(pool);
  $('flTitle').textContent = `Pool : ${pool.name} · ${done}/${N} ${matchWord(pool)} ${isTeamDisc(pool) ? 'terminées' : 'terminés'}`;
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
  $('flCall').hidden = pool.current < 0;
  $('flFinish').hidden = pool.current < 0;
  const what = isTeamDisc(pool) ? 'la rencontre' : isKataDisc(pool) ? 'le tour' : 'le combat';
  $('flFinish').textContent = nextUnplayed(pool, pool.current) >= 0 ? `Terminer ${what} ▶ suivant` : `Terminer ${what} ▶ classement`;
  $('flHajime').textContent = isKataDisc(pool) ? 'Afficher le tatami' : 'Afficher le score';
  const np = allDone ? nextPool() : null;
  $('flNextPool').hidden = !np;
  if (np) $('flNextPool').textContent = `Pool suivant : ${np.name} ▶`;
  $('pvName').textContent = `Sur le tatami : ${pool.name} – ${DISCIPLINES[discOf(pool)]}, ${unitWord(pool, pool.participants.length)}`;
  const C = rankCols(pool);
  document.querySelector('#poolView [data-h="pf"]').textContent = C.pf; document.querySelector('#poolView [data-h="pa"]').textContent = C.pa;
  const pn = i => i == null ? '<i style="color:var(--muted)">à déterminer</i>' : esc(pool.participants[i].name);
  const order = pool.matches.map((m,i) => i).filter(i => !isBye(pool.matches[i]));
  if (pool.format === 'ko') order.sort((x,y) => koOrderKey(pool, pool.matches[x]) - koOrderKey(pool, pool.matches[y]));
  $('pvMatches').innerHTML = order.map(i => {
    const m = pool.matches[i], r = m.res;
    const stt = i === pool.current ? '<span class="st now">En cours</span>' : r ? '<span class="st done">Terminé</span>' : playable(m) ? '<span class="st">À venir</span>' : '<span class="st">En attente</span>';
    const lbl = pool.format === 'ko' ? matchLabel(pool, m) : i+1;
    const btn = i === pool.current || !(playable(m) || r) ? '' : (r && !canReplay(pool, i)) ? '' : `<button class="btn sm" data-load="${i}">${r ? 'Rejouer' : 'Charger'}</button>`;
    return `<tr class="${i===pool.current?'cur':''}"><td style="white-space:nowrap">${lbl}</td>
      <td class="${r && r.winner==='aka'?'wa':''}">${pn(m.a)}</td><td class="res">${r ? resText(r) : '–'}</td>
      <td class="${r && r.winner==='ao'?'wb':''}">${pn(m.b)}</td><td>${stt}</td><td class="acts">${btn}</td></tr>`;
  }).join('');
  $('pvRanking').innerHTML = poolTable(pool).map(p => `<tr><td>${p.rank ?? '–'}</td><td><b>${esc(p.name)}</b><br><small style="color:var(--muted)">${esc(p.dojo)}${pool.format === 'ko' ? ' · ' + esc(p.label) : ''}</small></td><td>${p.w}${p.d ? ` <small>(+${p.d} N)</small>` : ''}</td><td>${p.l}</td><td>${fmtPts(p.pf)}</td><td>${fmtPts(p.pa)}</td></tr>`).join('');
  $('pvHint').textContent = isKataDisc(pool) ? `Kata – ${KATA_SYSTEMS[(pool.kata || {}).system || 'votes']}. Classement : victoires, confrontation directe, puis ${C.pf.replace(' +', '').toLowerCase()}.`
    : discOf(pool) === 'kumite_team' ? `Kumite par équipe – ${pool.bouts || 3} combats par rencontre. ${pool.format === 'ko' ? '' : 'Classement : 3 pts par victoire, 1 par nul, puis combats gagnés.'}`
    : pool.format === 'ko'
    ? (pool.repechage ? 'Élimination directe avec repêchage WKF.' : 'Élimination directe sans repêchage.')
    : (pool.ranking === 'points' ? 'Classement aux points marqués.' : 'Classement standard : victoires, confrontation directe, points marqués, points encaissés.');
}

/* ---------- phases finales : remplies dès que toutes les sous-poules sont terminées ---------- */
function refreshFinals(){
  const all = Object.values(cache.pools).map(e => e.data).concat(Object.values(cache.others || {}));
  let any = false;
  for (const [id, e] of Object.entries(cache.pools)){
    const p = e.data;
    if (p.type !== 'final' || hasResults(p) || p.current >= 0) continue;
    const test = clone(p);
    if (rebuildPool(test, null, null, all)){ replacePoolData(e, test); enqueue(id); any = true; }
  }
  return any;
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
  for (const k of ['wkf', 'k4x15', 'promo', 'kata']) if (ts[k]) state.settings[k] = Object.assign({}, state.settings[k], ts[k]);
  const ds = clone(DEFAULT_SETTINGS.sounds), ss = ts.sounds || {};
  state.settings.sounds = { atoshi: ss.atoshi || ds.atoshi, end: ss.end || ds.end, call: ss.call || ds.call, voice: Object.assign(ds.voice, ss.voice || {}) };
  ensureSoundFiles();
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
    // sous-poules des autres tatamis : gardées pour calculer nos phases finales
    if (!mine && !p.deleted && p.data.stage === 'group') cache.others[p.id] = p.data; else delete cache.others[p.id];
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
      state.mode = isKataDisc(entry.data) ? 'kata' : (entry.data.mode || state.mode); state.category = entry.data.name;
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
  if (refreshFinals()) changed = true;
  if (changed || r.full) commit(); else { saveLocal(); renderNet(); }
  if (cache.outbox.length) flush();
}
async function pushLive(force){
  if (!liveDirty && !force) return;
  liveDirty = false;
  const pool = state.pool, m = pool && pool.current >= 0 ? pool.matches[pool.current] : null;
  const live = { mode: state.mode, aka: state.aka, ao: state.ao, winner: state.winner, phase: state.phase, screen: state.screen, category: state.category,
    timer: { running: state.timer.running, remaining: Math.round(remainingNow()) },
    poolId: pool ? pool.id : null, poolName: pool ? pool.name : '', matchLabel: m ? matchLabel(pool, m) : '',
    discipline: pool ? discOf(pool) : (state.mode === 'kata' ? 'kata' : 'kumite') };
  if (state.mode === 'kata' && state.kata){
    const K = state.kata;
    live.kata = K.reveal ? K : { system: K.system, judges: K.judges, timer: K.timer, kataA: K.kataA, kataB: K.kataB, reveal: false, flags: [], sa: [], sb: [] };
  }
  if (state.team) live.team = { nameA: state.team.nameA, nameB: state.team.nameB, n: state.team.n, rr: state.team.rr, bouts: state.team.bouts };
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
ensureSoundFiles();
sync();
})();

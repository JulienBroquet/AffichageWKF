/* Affichage Kumite V2 – cœur commun (affichage, pools, élimination directe, classements) */
'use strict';
const MODES = { wkf:'WKF', k4x15:'4 × 15', promo:'Promo' };
const PEN = ['C1','C2','C3','HC','H'];
const PHASES = {
  k4x15: [
    ['AKA', 'attaque', null],
    ['AO', 'attaque', null],
    ['AKA', 'attaque', 'AO contre'],
    ['AO', 'attaque', 'AKA contre'],
  ],
  promo: [
    ['AKA', '1re attaque', null],
    ['AKA', '2e attaque', 'AO contre'],
    ['AO', '1re attaque', null],
    ['AO', '2e attaque', 'AKA contre'],
  ]
};
const DEFAULT_SETTINGS = {
  wkf:   { duration:180, atoshi:15, gap:8, autoSenshu:true },
  k4x15: { duration:15,  atoshi:0 },
  promo: { useTimer:false, duration:60, atoshi:0 },
  sound: { out:'control', volume:0.8 }
};
const clone = o => JSON.parse(JSON.stringify(o));
const fighter = () => ({ name:'', dojo:'', yuko:0, waza:0, ippon:0, p1:0, p2:0, senshu:false });
const total = f => f.yuko + 2*f.waza + 3*f.ippon;

function newState(){
  const s = { mode:'wkf', settings:clone(DEFAULT_SETTINGS), tatami:'Tatami 1', category:'', swap:false,
    aka:fighter(), ao:fighter(), phase:0, winner:null,
    timer:{ running:false, remaining:180000, endAt:0 } };
  return s;
}
function load(key, fallback){
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; }
}
function save(key, v){ try { localStorage.setItem(key, JSON.stringify(v)); } catch(e){} }

let state = newState();
function normalizeState(s){
  s = s || newState();
  s.settings = s.settings || {};
  for (const k in DEFAULT_SETTINGS) s.settings[k] = Object.assign({}, DEFAULT_SETTINGS[k], s.settings[k] || {});
  if (!('screen' in s)) s.screen = 'score';
  if (!('pool' in s)) s.pool = null;
  if (!s.timer) s.timer = { running:false, remaining:180000, endAt:0 };
  if (!s.aka) s.aka = fighter(); if (!s.ao) s.ao = fighter();
  return s;
}
const cfg = (s=state) => s.settings[s.mode];
const totalMs = (s=state) => cfg(s).duration * 1000;
const atoshiMs = (s=state) => (cfg(s).atoshi||0) * 1000;
const timerOn = (s=state) => s.mode !== 'promo' || s.settings.promo.useTimer;
const remainingNow = (s=state) => s.timer.running ? Math.max(0, s.timer.endAt - Date.now()) : s.timer.remaining;
function fmt(ms){
  const t = Math.ceil(ms/1000);
  return String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0');
}
const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- sync ---------- */
let chan = null;
function openChannel(name){ try { chan = new BroadcastChannel(name); } catch(e){ chan = null; } return chan; }
function broadcast(msg){ if (chan) try { chan.postMessage(msg); } catch(e){} }

/* ---------- audio ---------- */
let actx = null;
function audio(){
  if (!actx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; actx = new A(); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, start, dur, type, vol){
  const a = audio(); if (!a) return;
  const t0 = a.currentTime + start;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.01);
  g.gain.setValueAtTime(Math.max(0.0002, vol), t0 + dur - 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function playLocal(kind){
  const v = state.settings.sound.volume;
  if (v <= 0) return;
  if (kind === 'atoshi'){
    tone(1046, 0, 0.22, 'square', 0.35*v);
    tone(1046, 0.32, 0.22, 'square', 0.35*v);
  } else {
    tone(392, 0, 1.6, 'sawtooth', 0.45*v);
    tone(494, 0, 1.6, 'square', 0.25*v);
  }
}

/* =====================================================================
   DISPLAY
   ===================================================================== */
/* ---------- pool helpers ---------- */
function roundRobin(n){
  const ids = [...Array(n).keys()]; if (n % 2) ids.push(null);
  const m = ids.length, out = []; let arr = ids.slice();
  for (let r = 0; r < m - 1; r++){
    for (let i = 0; i < m/2; i++){
      const a = arr[i], b = arr[m-1-i];
      if (a !== null && b !== null) out.push(r % 2 ? [b, a] : [a, b]);
    }
    arr = [arr[0], arr[m-1], ...arr.slice(1, m-1)];
  }
  return out;
}
function poolTable(pool){
  if (pool.format === 'ko') return koRanking(pool);
  const P = pool.participants.map((p,i) => ({ i, name:p.name, dojo:p.dojo, j:0, w:0, l:0, pf:0, pa:0 }));
  const h2h = {};
  for (const m of pool.matches){
    if (!m.res || m.res.bye) continue;
    const A = P[m.a], B = P[m.b];
    A.j++; B.j++; A.pf += m.res.sa; A.pa += m.res.sb; B.pf += m.res.sb; B.pa += m.res.sa;
    const wi = m.res.winner === 'aka' ? m.a : m.b, li = m.res.winner === 'aka' ? m.b : m.a;
    P[wi].w++; P[li].l++; h2h[wi+'>'+li] = 1;
  }
  if (pool.ranking === 'points'){
    const cmp = (x,y) => y.pf - x.pf || y.w - x.w || x.pa - y.pa;
    P.sort(cmp);
    P.forEach((p,k) => p.rank = (k > 0 && cmp(P[k-1], p) === 0) ? P[k-1].rank : k + 1);
  } else {
    // victoires ; à égalité entre 2 : confrontation directe ; à 3+ : points marqués puis encaissés
    const base = (x,y) => y.w - x.w || y.pf - x.pf || x.pa - y.pa;
    P.sort(base);
    const out = [];
    for (let k = 0; k < P.length;){
      let e = k; while (e + 1 < P.length && P[e+1].w === P[k].w) e++;
      const g = P.slice(k, e + 1);
      if (g.length === 2){
        const [x,y] = g;
        if (h2h[y.i+'>'+x.i]) g.reverse();
        g[0].rank = out.length + 1;
        g[1].rank = (h2h[x.i+'>'+y.i] || h2h[y.i+'>'+x.i]) ? out.length + 2 : (base(g[0],g[1]) === 0 ? g[0].rank : out.length + 2);
      } else g.forEach((p,j) => p.rank = (j > 0 && base(g[j-1], p) === 0) ? g[j-1].rank : out.length + j + 1);
      out.push(...g); k = e + 1;
    }
    P.splice(0, P.length, ...out);
  }
  return P;
}
const uid = () => Math.random().toString(36).slice(2, 10);
const GRADES = [];
for (let k = 9; k >= 1; k--) GRADES.push([10-k, k + (k===1 ? 'er' : 'e') + ' kyu']);
for (let d = 1; d <= 6; d++) GRADES.push([9+d, d + (d===1 ? 'er' : 'e') + ' dan']);
const gradeLabel = v => (GRADES.find(g => g[0] === +v) || [0, ''])[1];
const gradeOptions = (empty) => `<option value="">${empty}</option>` + GRADES.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
const BELTS = { blanche:1, blanc:1, jaune:2, orange:3, verte:4, vert:4, bleue:5, bleu:5, violette:6, violet:6, marron:7, brune:7, brun:7, noire:10, noir:10 };
function parseGrade(str){
  const t = String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = t.match(/(\d+)\s*(?:er|re|eme|e|st|nd|rd|th|\.)?\s*(kyu|dan)/);
  if (m){ const n = +m[1]; return m[2] === 'kyu' ? Math.min(9, Math.max(1, 10-n)) : 9 + Math.min(6, Math.max(1, n)); }
  for (const k in BELTS) if (t.includes(k)) return BELTS[k];
  return null;
}
function matchesCrit(c, k){
  if (k.sex && c.sex !== k.sex) return false;
  const chk = (v, min, max, minExcl) => {
    if (min == null && max == null) return true;
    if (v == null || v === '' || isNaN(v)) return false;
    if (min != null && (minExcl ? !(v > min) : !(v >= min))) return false;
    if (max != null && !(v <= max)) return false;
    return true;
  };
  return chk(c.age, k.ageMin, k.ageMax) && chk(c.weight, k.wMin, k.wMax, true) && chk(c.grade, k.gMin, k.gMax);
}
function critSummary(p){
  if (!p || p.type !== 'auto') return '';
  const k = p.criteria || {}, out = [];
  const nn = v => v != null;
  if (k.sex) out.push(k.sex === 'F' ? 'Filles' : 'Garçons');
  if (nn(k.ageMin) || nn(k.ageMax)) out.push(nn(k.ageMin) && nn(k.ageMax) ? `${k.ageMin}–${k.ageMax} ans` : nn(k.ageMin) ? `${k.ageMin} ans et +` : `jusqu'à ${k.ageMax} ans`);
  if (nn(k.wMin) || nn(k.wMax)) out.push(nn(k.wMin) && nn(k.wMax) ? `${k.wMin}–${k.wMax} kg` : nn(k.wMax) ? `−${k.wMax} kg` : `+${k.wMin} kg`);
  if (nn(k.gMin) || nn(k.gMax)) out.push(nn(k.gMin) && nn(k.gMax) ? (k.gMin === k.gMax ? gradeLabel(k.gMin) : `${gradeLabel(k.gMin)} → ${gradeLabel(k.gMax)}`) : nn(k.gMin) ? `dès ${gradeLabel(k.gMin)}` : `jusqu'au ${gradeLabel(k.gMax)}`);
  return out.join(' · ');
}
/* ---------- élimination directe ---------- */
const isBye = m => !!(m.res && m.res.bye);
const winnerOf = m => !m || !m.res ? null : (m.res.winner === 'aka' ? m.a : m.b);
const loserOf  = m => !m || !m.res || m.res.bye ? null : (m.res.winner === 'aka' ? m.b : m.a);
const playable = m => !m.res && m.a != null && m.b != null && m.a >= 0 && m.b >= 0;
function koSize(n){ let S = 2; while (S < n) S *= 2; return S; }
function seedOrder(S){
  let arr = [1];
  while (arr.length < S){ const L = arr.length * 2; arr = arr.flatMap(x => [x, L + 1 - x]); }
  return arr;
}
function koRounds(pool){ return Math.log2(koSize(pool.participants.length)); }
const mainM = (pool, r, k) => pool.matches.find(m => m.kind === 'main' && m.r === r && m.k === k);
function roundName(R, r){
  const d = R - 1 - r;
  return ['Finale', 'Demi-finale', 'Quart de finale', '8e de finale', '16e de finale', '32e de finale'][d] || `Tour ${r+1}`;
}
function makeDraw(members){
  const n = members.length, S = koSize(n), order = seedOrder(S);
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 400 && bestScore > 0; t++){
    const a = members.slice();
    for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    let score = 0;
    for (let k = 0; k < S/2; k++){
      const x = a[order[2*k]-1], y = a[order[2*k+1]-1];
      if (x && y && x.dojo && x.dojo === y.dojo) score++;
    }
    if (score < bestScore){ bestScore = score; best = a; }
  }
  return best.map(c => c.id);
}
function koBuild(pool){
  const n = pool.participants.length, S = koSize(n), R = Math.log2(S), order = seedOrder(S);
  pool.matches = [];
  for (let k = 0; k < S/2; k++){
    const sa = order[2*k], sb = order[2*k+1];
    pool.matches.push({ kind:'main', r:0, k, a: sa <= n ? sa-1 : -1, b: sb <= n ? sb-1 : -1, res:null });
  }
  for (let r = 1; r < R; r++) for (let k = 0; k < S / 2**(r+1); k++) pool.matches.push({ kind:'main', r, k, a:null, b:null, res:null });
  pool.current = -1;
  koRebuild(pool);
}
function koRebuild(pool){
  const n = pool.participants.length, S = koSize(n), R = Math.log2(S);
  for (let r = 0; r < R; r++){
    for (let k = 0; k < S / 2**(r+1); k++){
      const m = mainM(pool, r, k);
      if (r > 0){
        const A = winnerOf(mainM(pool, r-1, 2*k)), B = winnerOf(mainM(pool, r-1, 2*k+1));
        if (m.a !== A || m.b !== B){ m.a = A; m.b = B; m.res = null; }
      }
      if (m.a === -1 || m.b === -1){
        if (m.a === -1 && m.b === -1) m.res = { bye:true, winner:'aka', sa:0, sb:0 };
        else m.res = { bye:true, winner: m.a === -1 ? 'ao' : 'aka', sa:0, sb:0 };
      } else if (m.res && m.res.bye) m.res = null;
    }
  }
  // repêchage WKF : les battus des deux finalistes
  for (const side of [0, 1]){
    let L = [];
    if (pool.repechage && R >= 2){
      const f = winnerOf(mainM(pool, R-2, side));
      if (f != null){
        for (let r = 0; r <= R-2; r++){
          const cnt = S / 2**(r+1);
          for (let k = 0; k < cnt; k++){
            if (Math.floor(k / (cnt/2)) !== side) continue;
            const m = mainM(pool, r, k);
            if (m.res && !m.res.bye && winnerOf(m) === f) L.push(loserOf(m));
          }
        }
      }
    }
    const need = Math.max(0, L.length - 1);
    let chain = pool.matches.filter(m => m.kind === 'rep' && m.side === side).sort((x,y) => x.step - y.step);
    if (chain.length !== need){
      pool.matches = pool.matches.filter(m => !(m.kind === 'rep' && m.side === side));
      chain = [];
      for (let j = 0; j < need; j++){ const m = { kind:'rep', side, step:j, a:null, b:null, res:null }; pool.matches.push(m); chain.push(m); }
    }
    chain.forEach((m, j) => {
      const A = j === 0 ? L[0] : winnerOf(chain[j-1]), B = L[j+1];
      if (m.a !== (A ?? null) || m.b !== B){ m.a = A ?? null; m.b = B; m.res = null; }
    });
    pool['repL' + side] = L;
  }
}
function matchLabel(pool, m){
  if (pool.format !== 'ko') return `Combat ${pool.matches.indexOf(m)+1} / ${pool.matches.length}`;
  if (m.kind === 'rep') return `Repêchage ${m.side ? 'B' : 'A'} · combat ${m.step+1}`;
  return roundName(koRounds(pool), m.r);
}
function koOrderKey(pool, m){
  const R = koRounds(pool);
  if (m.kind === 'rep') return 1000 + m.step * 10 + m.side;
  if (m.r === R-1) return 9000;
  return m.r * 100 + m.k;
}
function nextUnplayed(pool, from){
  if (pool.format === 'ko'){
    let best = -1, bk = Infinity;
    pool.matches.forEach((m, i) => { if (i !== from && playable(m)){ const k = koOrderKey(pool, m); if (k < bk){ bk = k; best = i; } } });
    return best;
  }
  const n = pool.matches.length;
  for (let k = 1; k <= n; k++){ const i = (from + k + n) % n; if (!pool.matches[i].res && i !== from) return i; }
  return -1;
}
const poolDone = pool => pool.matches.length > 0 && pool.matches.every(m => m.res);
const realMatches = pool => pool.matches.filter(m => !isBye(m));
function koRanking(pool){
  const n = pool.participants.length, S = koSize(n), R = Math.log2(S);
  const P = pool.participants.map((p,i) => ({ i, name:p.name, dojo:p.dojo, j:0, w:0, l:0, pf:0, pa:0, rank:null, label:'En lice' }));
  for (const m of pool.matches){
    if (!m.res || m.res.bye) continue;
    const A = P[m.a], B = P[m.b];
    A.j++; B.j++; A.pf += m.res.sa; A.pa += m.res.sb; B.pf += m.res.sb; B.pa += m.res.sa;
    P[winnerOf(m)].w++; P[loserOf(m)].l++;
  }
  const set = (i, rank, label) => { if (i != null && i >= 0 && P[i].rank == null){ P[i].rank = rank; P[i].label = label; } };
  const fin = mainM(pool, R-1, 0);
  if (fin && fin.res){ set(winnerOf(fin), 1, 'Vainqueur'); set(loserOf(fin), 2, 'Finaliste'); }
  for (const side of [0, 1]){
    if (pool.repechage && R >= 2){
      const L = pool['repL' + side] || [];
      const chain = pool.matches.filter(m => m.kind === 'rep' && m.side === side).sort((x,y) => x.step - y.step);
      if (L.length === 1) set(L[0], 3, 'Bronze');
      else if (chain.length && chain[chain.length-1].res){
        const last = chain[chain.length-1];
        set(winnerOf(last), 3, 'Bronze'); set(loserOf(last), 5, '5e place');
      }
      chain.forEach(m => { if (m.res && m !== chain[chain.length-1]) set(loserOf(m), 7, 'Repêchage'); });
    } else if (R >= 2){
      set(loserOf(mainM(pool, R-2, side)), 3, 'Bronze');
    }
  }
  for (let r = 0; r < R; r++){
    for (const m of pool.matches.filter(x => x.kind === 'main' && x.r === r)){
      const l = loserOf(m); if (l == null || P[l].rank != null) continue;
      if (pool.repechage && R >= 2 && r <= R-2){
        const semisDone = mainM(pool, R-2, 0).res && mainM(pool, R-2, 1).res;
        const inRep = (pool.repL0 || []).includes(l) || (pool.repL1 || []).includes(l);
        if (!semisDone || inRep) continue;   // peut encore être repêché / déjà dans le repêchage
      }
      let rk = 2 ** (R-1-r) + 1; if (pool.repechage) rk = Math.max(rk, 7);
      set(l, rk, `Éliminé (${roundName(R, r).toLowerCase()})`);
    }
  }
  P.sort((x,y) => (x.rank ?? 0) - (y.rank ?? 0) || y.w - x.w);
  const placed = P.filter(p => p.rank != null), raw = placed.map(p => p.rank);
  placed.forEach((p, k) => p.rank = 1 + raw.filter(v => v < raw[k]).length);
  return P;
}
function bracketHTML(s, pool){
  const n = pool.participants.length, S = koSize(n), R = Math.log2(S);
  // grands tableaux (16 et plus) : on n'affiche que les 3 derniers tours (quarts, demies, finale)
  const start = Math.max(0, R - 3);
  const firstCnt = S / 2 ** (start + 1);
  const fs = (firstCnt <= 1 ? 3 : firstCnt <= 2 ? 2.4 : firstCnt <= 4 ? 1.75 : firstCnt <= 8 ? 1.05 : 0.68) * (pool.repechage && S > 2 ? 0.92 : 1);
  const nm = i => i === -1 ? '<i>exempt</i>' : i == null ? '<i>à déterminer</i>' : esc(pool.participants[i].name);
  const box = m => {
    const idx = pool.matches.indexOf(m), w = winnerOf(m), bye = isBye(m);
    if (bye){ const real = m.a === -1 ? m.b : m.a; return `<div class="bm bye"><div class="br ${m.a === -1 ? 'b' : 'a'} w"><span>${nm(real)}</span><i>exempt</i></div></div>`; }
    const row = (i, side, sc) => `<div class="br ${side} ${m.res && !bye ? (w === i ? 'w' : 'l') : ''} ${bye && i === -1 ? 'l' : ''}"><span>${nm(i)}</span>${m.res && !bye ? `<b>${sc}</b>` : ''}</div>`;
    return `<div class="bm ${idx === pool.current ? 'cur' : ''}">${row(m.a, 'a', m.res ? m.res.sa : '')}${row(m.b, 'b', m.res ? m.res.sb : '')}</div>`;
  };
  let cols = '';
  for (let r = start; r < R; r++){
    const ms = pool.matches.filter(m => m.kind === 'main' && m.r === r).sort((x,y) => x.k - y.k);
    cols += `<div class="bcol"><div class="bh">${roundName(R, r)}</div><div class="bbody">${ms.map(box).join('')}</div></div>`;
  }
  const fin = mainM(pool, R-1, 0);
  cols += `<div class="bcol win"><div class="bh">Vainqueur</div><div class="bbody"><div class="bwin">${fin && fin.res ? esc(pool.participants[winnerOf(fin)].name) : '?'}</div></div></div>`;
  let repHTML = '';
  if (pool.repechage && R >= 2){
    repHTML = '<div class="brep">' + [0,1].map(side => {
      const chain = pool.matches.filter(m => m.kind === 'rep' && m.side === side).sort((x,y) => x.step - y.step);
      const L = pool['repL' + side] || [];
      const shown = chain.slice(-3);
      const body = chain.length ? (chain.length > 3 ? '<span class="note">…</span><span class="arr">→</span>' : '') + shown.map(box).join('<span class="arr">→</span>') :
        (L.length === 1 ? `<span class="note">${esc(pool.participants[L[0]].name)} : bronze direct</span>` : '<span class="note">en attente de la demi-finale</span>');
      return `<div class="brs"><div class="bh">Repêchage ${side ? 'B' : 'A'}</div><div class="brow">${body}</div></div>`;
    }).join('') + '</div>';
  }
  return `<div class="d-bracket" style="--fs:calc(var(--u)*${fs})"><div class="bmain">${cols}</div>${repHTML}</div>`;
}
const formatLabel = p => p.format === 'ko' ? ('Élimination directe' + (p.repechage ? ' + repêchage' : ' sans repêchage')) : 'Poule (chacun contre chacun)';
function screenHTML(s, scr){
  const pool = s.pool, ko = pool.format === 'ko';
  const head = (title) => `<div class="d-sh"><div class="t">${esc(title)}</div><div class="r">${esc(s.tatami||'')} · Kumite ${MODES[s.mode]}</div></div>`;
  const N = pool.participants.length;
  if (scr === 'bracket' && !ko) scr = 'list';
  if (scr === 'list'){
    const cols = N <= 6 ? 2 : N <= 12 ? 3 : 4;
    const fs = N <= 4 ? 4.2 : N <= 6 ? 3.4 : N <= 9 ? 2.6 : N <= 12 ? 2.3 : N <= 16 ? 1.9 : 1.6;
    return head(pool.name || 'Pool') + `<div class="d-sub">${critSummary(pool) ? esc(critSummary(pool)) + ' · ' : ''}${N} compétiteurs · ${ko ? formatLabel(pool) : pool.matches.length + ' combats'}</div>
      <div class="d-plist" style="--cols:${cols};--fs:calc(var(--u)*${fs})">${pool.participants.map((p,i) =>
        `<div class="d-pc"><span class="n">${i+1}</span><div><div class="nm">${esc(p.name)}</div><div class="dj">${esc(p.dojo)}</div></div></div>`).join('')}</div>`;
  }
  if (scr === 'bracket'){
    return head(pool.name || 'Tableau') + `<div class="d-sub">${formatLabel(pool)} · ${N} compétiteurs${koRounds(pool) > 3 ? ' · 3 tours affichés' : ''}</div>` + bracketHTML(s, pool);
  }
  if (scr === 'callup'){
    const m = pool.matches[pool.current];
    if (!m || !playable(m) && !m.res) return screenHTML(s, ko ? 'bracket' : 'list');
    const A = pool.participants[m.a], B = pool.participants[m.b];
    const nx = nextUnplayed(pool, pool.current);
    const nm = nx >= 0 ? pool.matches[nx] : null;
    return head(pool.name || 'Pool') + `<div class="d-sub">${matchLabel(pool, m)} · Les compétiteurs sont appelés sur le tatami</div>
      <div class="d-call ${s.swap?'swap':''}">
        <div class="ca"><div class="tg">AKA</div><div class="nm">${esc(A.name)}</div><div class="dj">${esc(A.dojo)}</div></div>
        <div class="cb"><div class="tg">AO</div><div class="nm">${esc(B.name)}</div><div class="dj">${esc(B.dojo)}</div></div>
        <div class="d-vs">VS</div>
      </div>
      <div class="d-next">${nm ? `À suivre${ko ? ' (' + matchLabel(pool, nm).toLowerCase() + ')' : ''} : <b>${esc(pool.participants[nm.a].name)}</b> – <b>${esc(pool.participants[nm.b].name)}</b>` : 'Dernier combat du pool'}</div>`;
  }
  // ranking
  const T = poolTable(pool);
  const done = poolDone(pool);
  const fs = Math.min(3, 38 / (2.9*N + 1.5)).toFixed(2);
  if (ko){
    return head((done ? 'Classement' : 'Classement provisoire') + ' – ' + (pool.name || 'Pool')) +
      `<div class="d-sub">${formatLabel(pool)}</div>
      <div class="d-rank" style="--fs:calc(var(--u)*${fs})"><table>
        <thead><tr><th>Rg</th><th class="l">Compétiteur</th><th class="l">Résultat</th><th>V</th><th>D</th></tr></thead>
        <tbody>${T.map(p => `<tr class="r${p.rank ?? 0}"><td><span class="rk">${p.rank ?? '–'}</span></td>
          <td class="l">${esc(p.name)}<small>${esc(p.dojo)}</small></td><td class="l">${esc(p.label)}</td><td>${p.w}</td><td>${p.l}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }
  const pts = pool.ranking === 'points';
  return head((done ? 'Classement' : 'Classement provisoire') + ' – ' + (pool.name || 'Pool')) +
    `<div class="d-sub">${pts ? 'Classement aux points marqués' : 'Classement standard (victoires)'}</div>
    <div class="d-rank" style="--fs:calc(var(--u)*${fs})"><table>
      <thead><tr><th>Rg</th><th class="l">Compétiteur</th><th>Combats</th><th class="${pts?'':'key'}">V</th><th>D</th><th class="${pts?'key':''}">Pts +</th><th>Pts −</th></tr></thead>
      <tbody>${T.map(p => `<tr class="r${p.rank}"><td><span class="rk">${p.rank}</span></td>
        <td class="l">${esc(p.name)}<small>${esc(p.dojo)}</small></td><td>${p.j}</td>
        <td class="${pts?'':'key'}">${p.w}</td><td>${p.l}</td><td class="${pts?'key':''}">${p.pf}</td><td>${p.pa}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

const BOARD_HTML = `<div class="d-board">
    <div class="d-top"><span data-d="dTatami"></span><span class="mid" data-d="dCat"></span><span data-d="dModeTop"></span></div>
    <div class="d-grid" data-d="dGrid">
      <section class="d-half d-aka" data-d="d-aka"></section>
      <div class="d-center">
        <div class="d-mode" data-d="dMode"></div>
        <div class="d-phase-n" data-d="dPhaseN"></div>
        <div class="d-clock" data-d="dClock">03:00</div>
        <div class="d-atoshi" data-d="dAtoshi" hidden>ATOSHI BARAKU</div>
        <div class="d-phase-t" data-d="dPhaseT"></div>
      </div>
      <section class="d-half d-ao" data-d="d-ao"></section>
    </div>
  </div>`;
function createBoard(root, getState){
  getState = getState || (() => state);
  root.innerHTML = BOARD_HTML + '<div class="d-screen" data-d="screen" hidden></div>';
  const $ = n => root.querySelector(`[data-d="${n}"]`);
  const halfHTML = side => `
    <div class="d-head"><div class="d-tag">${side.toUpperCase()}</div><div class="d-senshu" data-k="senshu" hidden>S</div></div>
    <div class="d-name" data-k="name"></div>
    <div class="d-dojo" data-k="dojo"></div>
    <div class="d-score" data-k="score">0</div>
    <div class="d-counts">
      <span>Yuko<b data-k="yuko">0</b></span><span>Waza-ari<b data-k="waza">0</b></span><span>Ippon<b data-k="ippon">0</b></span>
    </div>
    <div class="d-pens" data-k="pens"></div>
    <div class="d-win" data-k="win" hidden>VAINQUEUR</div>`;
  for (const side of ['aka','ao']) $('d-'+side).innerHTML = halfHTML(side);
  function render(){
    const s = getState(); if (!s) return;
    $('dTatami').textContent = s.tatami || '';
    $('dCat').textContent = s.category || '';
    $('dModeTop').textContent = 'Kumite ' + MODES[s.mode];
    $('dGrid').classList.toggle('swap', !!s.swap);
    for (const side of ['aka','ao']){
      const f = s[side], el = $('d-'+side);
      const q = k => el.querySelector(`[data-k="${k}"]`);
      const n = q('name'); n.textContent = f.name || (side==='aka'?'AKA':'AO');
      n.classList.toggle('long', (f.name||'').length > 20 && (f.name||'').length <= 30);
      n.classList.toggle('xlong', (f.name||'').length > 30);
      q('dojo').textContent = f.dojo || '';
      q('score').textContent = total(f);
      q('yuko').textContent = f.yuko; q('waza').textContent = f.waza; q('ippon').textContent = f.ippon;
      q('senshu').hidden = !(s.mode === 'wkf' && f.senshu);
      const cats = s.mode === 'wkf' ? [['', f.p1]] : [['Cat. 1', f.p1], ['Cat. 2', f.p2]];
      q('pens').innerHTML = cats.map(([lbl, lv]) =>
        `<div class="d-penrow">${lbl ? `<span class="d-pl">${lbl}</span>` : ''}${PEN.map((p,i) =>
          `<span class="d-pill ${i < lv ? 'on' : ''} ${i===3?'hc':''} ${i===4?'h':''}">${p}</span>`).join('')}</div>`).join('');
      q('win').hidden = s.winner !== side;
      el.classList.toggle('lost', !!s.winner && s.winner !== side);
    }
    $('dMode').textContent = MODES[s.mode];
    const ph = PHASES[s.mode];
    if (ph){
      const [who, what, counter] = ph[s.phase] || ph[0];
      $('dPhaseN').textContent = (s.mode === 'k4x15' ? 'Assaut ' : 'Échange ') + (s.phase+1) + ' / ' + ph.length;
      $('dPhaseT').innerHTML = `<span class="${who==='AKA'?'a':'b'}">${who}</span> ${what}` +
        (counter ? `<br><span class="${counter.startsWith('AKA')?'a':'b'}">${counter.split(' ')[0]}</span> ${counter.split(' ').slice(1).join(' ')}` : '');
      $('dPhaseN').hidden = false; $('dPhaseT').hidden = false;
    } else { $('dPhaseN').hidden = true; $('dPhaseT').hidden = true; }
    $('dClock').hidden = !timerOn(s);
    const scr = s.pool ? (s.screen || 'score') : 'score';
    const se = $('screen');
    se.hidden = scr === 'score';
    if (scr !== 'score') se.innerHTML = screenHTML(s, scr);
    renderClock();
  }
  function renderClock(){
    const s = getState(); if (!s) return;
    if (!timerOn(s)) { $('dAtoshi').hidden = true; return; }
    const rem = remainingNow(s), A = atoshiMs(s);
    const c = $('dClock');
    c.textContent = fmt(rem);
    const ended = rem <= 0, warn = !ended && A > 0 && rem <= A;
    c.className = 'd-clock' + (ended ? ' ended' : warn ? ' warn' : (!s.timer.running ? ' paused' : ''));
    $('dAtoshi').hidden = !(warn && s.mode === 'wkf');
  }
  return { render, renderClock };
}


/* ---------- utilitaires partagés ---------- */
const numOrNull = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const YEAR = new Date().getFullYear();
const compText = c => [c.name, c.dojo, c.category, c.sex, c.age, c.weight, gradeLabel(c.grade)].join(' ').toLowerCase();
const compInfo = (c, short) => [short ? '' : c.dojo, c.sex, c.age != null && c.age !== '' ? c.age + ' ans' : '', c.weight != null && c.weight !== '' ? c.weight + ' kg' : '', gradeLabel(c.grade)].filter(Boolean).join(' · ');
const inPool = (c, p) => p.type === 'manual' ? (p.memberIds || []).includes(c.id) : matchesCrit(c, p.criteria || {});
const hasResults = p => (p.matches || []).some(m => m.res && !m.res.bye);
/* Recalcule participants + combats d'un pool à partir de la liste des compétiteurs
   (sans effet si le pool a déjà des résultats ou un combat chargé). Renvoie true si modifié. */
function rebuildPool(p, competitors){
  if (!p.format) p.format = 'rr';
  if (!p.matches) p.matches = [];
  if (!p.participants) p.participants = [];
  if (hasResults(p) || p.current >= 0) return false;
  let mem = competitors.filter(c => inPool(c, p));
  if (p.format === 'ko'){
    const ids = new Set(mem.map(c => c.id));
    if (!p.draw || p.draw.length !== mem.length || !p.draw.every(id => ids.has(id))) p.draw = mem.length ? makeDraw(mem) : [];
    mem = p.draw.map(id => mem.find(c => c.id === id));
  }
  const before = JSON.stringify([p.participants, p.sig]);
  const sig = [p.format, p.format === 'ko' && p.repechage ? 1 : 0, ...mem.map(c => c.id)].join('|');
  p.participants = mem.map(c => ({ id:c.id, name:c.name, dojo:c.dojo }));
  if (sig !== p.sig || (!p.matches.length && mem.length >= 2)){
    p.sig = sig; p.current = -1;
    if (mem.length < 2) p.matches = [];
    else if (p.format === 'ko') koBuild(p);
    else p.matches = roundRobin(mem.length).map(([a,b]) => ({ a, b, res:null }));
    return true;
  }
  return before !== JSON.stringify([p.participants, p.sig]);
}
function poolStatusOf(p){
  if (poolDone(p) && realMatches(p).length) return 'done';
  if (hasResults(p) || p.current >= 0) return 'live';
  return 'ready';
}
function canReplay(pool, i){
  const m = pool.matches[i];
  if (pool.format !== 'ko' || !m.res) return true;
  const key = koOrderKey(pool, m), pl = [m.a, m.b];
  return !pool.matches.some((x, j) => j !== i && x.res && !x.res.bye && koOrderKey(pool, x) > key && (pl.includes(x.a) || pl.includes(x.b)));
}
/* identifiant stable d'un combat (pour fusionner des résultats faits hors ligne) */
function matchKey(pool, m){
  if (m.kind === 'rep') return `rep:${m.side}:${m.step}`;
  if (m.kind === 'main') return `main:${m.r}:${m.k}`;
  const A = pool.participants[m.a], B = pool.participants[m.b];
  return `rr:${A ? A.id : m.a}:${B ? B.id : m.b}`;
}
function download(name, text, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => { const d = new Date(), z = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}h${z(d.getMinutes())}`; };
const csvCell = v => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
async function readTextFile(file){
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal:true }).decode(buf); } catch(_) { return new TextDecoder('windows-1252').decode(buf); }
}

/* ---------- import CSV ---------- */
function parseCSV(text){
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const count = ch => first.split(ch).length - 1;
  const delim = [';', ',', '\t'].sort((a,b) => count(b) - count(a))[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){
      if (ch === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim){ row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r'){
      if (ch === '\r' && text[i+1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c));
}
function parseSex(v){
  const t = String(v||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!t) return '';
  if (/^(f|w|d|fille|femme|feminin|female|dame|weiblich)/.test(t)) return 'F';
  if (/^(m|h|g|garcon|homme|masculin|male|herr|mannlich)/.test(t)) return 'M';
  return '';
}
function parseCompetitors(text){
  const rows = parseCSV(text); if (!rows.length) return [];
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const h = rows[0].map(norm);
  const find = re => h.findIndex(x => re.test(x));
  let iName = find(/^(nom|name|nom complet|competiteur|athlete|nom et prenom|nom prenom)$/);
  if (iName < 0) iName = find(/^nom|name|competiteur|athlete/);
  const iFirst = find(/prenom|first|vorname/);
  const iDojo = find(/dojo|club|ecole|team|equipe|verein/);
  const iCat = find(/^cat/);
  const iSex = find(/^(sexe|sex|genre|gender|geschlecht|s|m\/f|f\/m)$/);
  const iAge = find(/^(age|ans|alter)$/);
  const iBirth = find(/naissance|annee|birth|jahrgang|ne le|ne\(e\)/);
  const iW = find(/poids|weight|gewicht|^kg$/);
  const iG = find(/grade|ceinture|kyu|belt|gurt/);
  const hasHeader = [iName, iDojo, iCat, iSex, iAge, iBirth, iW, iG].some(i => i >= 0);
  const data = hasHeader ? rows.slice(1) : rows;
  const N = hasHeader ? iName : 0, D = hasHeader ? iDojo : 1, C = hasHeader ? iCat : 2, F = hasHeader && iFirst !== iName ? iFirst : -1;
  const cell = (r, i) => i >= 0 ? (r[i] || '') : '';
  return data.map(r => {
    const name = [cell(r, F), cell(r, N)].filter(Boolean).join(' ').trim();
    let age = numOrNull(cell(r, iAge));
    if (age == null){ const m = cell(r, iBirth).match(/(\d{4})/); if (m) age = YEAR - +m[1]; }
    const wt = numOrNull(cell(r, iW).replace(',', '.').replace(/[^\d.]/g, ''));
    return { id:uid(), name, dojo:cell(r, D), category:cell(r, C), sex:parseSex(cell(r, iSex)), age, weight:wt, grade:parseGrade(cell(r, iG)) };
  }).filter(c => c.name);
}

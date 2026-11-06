/* Hantei – client de l'API + session */
'use strict';
const Api = {
  token: null,
  async call(action, data = {}, opts = {}){
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
    let res, body;
    try {
      res = await fetch('api.php', { method:'POST', signal:ctrl.signal, cache:'no-store',
        headers:{ 'Content-Type':'application/json', ...(this.token ? { 'X-Kumite-Token': this.token } : {}) },
        body: JSON.stringify(Object.assign({ action }, data)) });
      body = await res.json().catch(() => null);
    } catch(e){
      const err = new Error('Pas de connexion au serveur.'); err.code = 'network'; throw err;
    } finally { clearTimeout(to); }
    if (!body || !body.ok){
      const err = new Error(body && body.error || ('Erreur serveur (' + (res && res.status) + ')'));
      err.code = body && body.code || 'http'; err.status = res && res.status; err.body = body; throw err;
    }
    return body;
  }
};
const Sess = {
  KEY: 'kumite2.sessions',
  all(){ try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; } catch(e){ return {}; } },
  get(id){ return this.all()[id] || null; },
  set(id, v){ const a = this.all(); if (v) a[id] = v; else delete a[id]; try { localStorage.setItem(this.KEY, JSON.stringify(a)); } catch(e){} },
};
const fmtKey = k => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{1,4}).*$/, '$1-$2');
const qs = (sel, root = document) => root.querySelector(sel);
const $id = id => document.getElementById(id);
function toast(msg, ms = 3000){
  let t = $id('toast');
  if (!t){ t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:10px;z-index:99;font-weight:600;max-width:90vw;box-shadow:0 4px 20px rgba(0,0,0,.3);transition:opacity .3s'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = 1; clearTimeout(t._h); t._h = setTimeout(() => t.style.opacity = 0, ms);
}

/* ---------- version de l'application, affichée en petit sur chaque page ---------- */
const APP_NAME = 'Hantei', APP_VERSION = '2.3.0';
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.nover !== undefined) return;
  const el = document.createElement('div');
  el.className = 'appver'; el.innerHTML = `<b>${APP_NAME}</b> v${APP_VERSION}`;
  document.body.appendChild(el);
});

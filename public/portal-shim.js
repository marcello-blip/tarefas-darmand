// Camada de compatibilidade (Gestão DARMAND, rotas /papi): a página do portal foi escrita para o banco do artifact (window.claude.use('db'|'user')).
// Aqui a mesma interface fala com a API do servidor (Postgres + login Google).
(function () {
  const api = async (url, opt) => {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opt || {}));
    if (r.status === 401) { (window.top || window).location.href = '/login'; throw Object.assign(new Error('login'), { code: 'revoked' }); }
    if (!r.ok) { let m = 'erro ' + r.status; try { m = (await r.json()).erro || m } catch (e) {} throw new Error(m); }
    return r.json();
  };
  const ouvintes = {}; // coleção -> [{cb, err, ord, lim}]
  const cache = {}, versoes = {};
  const snap = (c, o) => {
    let docs = (cache[c] || []).slice();
    if (o && o.ord) docs.sort((a, b) => { const x = a.data[o.ord.f], y = b.data[o.ord.f]; return (x > y ? 1 : x < y ? -1 : 0) * (o.ord.d === 'desc' ? -1 : 1) });
    if (o && o.lim) docs = docs.slice(0, o.lim);
    return { docs: docs.map(d => ({ id: d.id, exists: true, data: () => d.data })), get size() { return this.docs.length }, metadata: { fromCache: false } };
  };
  const avisa = c => (ouvintes[c] || []).forEach(o => { try { o.cb(snap(c, o)) } catch (e) { console.error(e) } });
  const carrega = async c => { const r = await api('/papi/col/' + encodeURIComponent(c)); cache[c] = r.docs; avisa(c) };
  // atualiza sozinho: a cada 2 minutos confere quais coleções mudaram e baixa só essas;
  // também confere na hora em que a pessoa volta para o portal (celular desbloqueado, aba de volta à frente)
  const confere = async () => {
    try { const v = await api('/papi/versoes'); for (const c of Object.keys(ouvintes)) { const vc = v[c] || '0:0'; if (versoes[c] !== undefined && vc !== versoes[c]) await carrega(c); versoes[c] = vc } } catch (e) {}
  };
  setInterval(confere, 120000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') confere() });
  const colecao = c => {
    const o = { ord: null, lim: 0 };
    const q = {
      orderBy(f, d) { o.ord = { f, d: d || 'asc' }; return q },
      limit(n) { o.lim = n; return q },
      onSnapshot(cb, err) {
        const reg = { cb, err, ord: o.ord, lim: o.lim }; (ouvintes[c] || (ouvintes[c] = [])).push(reg);
        if (cache[c]) setTimeout(() => cb(snap(c, reg)));
        else carrega(c).then(() => api('/papi/versoes').then(v => { versoes[c] = v[c] || '0:0' }).catch(() => {})).catch(e => err && err(e));
        return () => { ouvintes[c] = (ouvintes[c] || []).filter(x => x !== reg) };
      },
      async add(d) { const r = await api('/papi/col/' + encodeURIComponent(c), { method: 'POST', body: JSON.stringify(d) }); await carrega(c); return { id: r.id } }
    };
    return q;
  };
  const db = {
    collection: colecao,
    doc(p) {
      const [c, id] = p.split('/');
      return {
        async set(d) { await api(`/papi/doc/${encodeURIComponent(c)}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(d) }); await carrega(c) },
        async delete() { await api(`/papi/doc/${encodeURIComponent(c)}/${encodeURIComponent(id)}`, { method: 'DELETE' }); await carrega(c) }
      };
    }
  };
  const user = {
    me: () => api('/papi/me/perfil'),
    profiles: ids => api('/papi/pessoas/perfis', { method: 'POST', body: JSON.stringify({ ids }) }),
    search: q => api('/papi/pessoas?q=' + encodeURIComponent(q || ''))
  };
  window.claude = { use: async n => n === 'db' ? db : n === 'user' ? user : null };
  window.portalApi = api; window.portalRecarrega = c => carrega(c);
  window.portalSair = async () => { try { await fetch('/api/logout', { method: 'POST' }) } catch (e) {} location.href = '/login' };
})();

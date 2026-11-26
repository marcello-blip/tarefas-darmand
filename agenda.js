// Google Agenda: cada pessoa conecta a própria conta e as tarefas sob a responsabilidade dela
// viram eventos de dia inteiro (início → prazo) na agenda principal. Sincroniza do sistema para a agenda:
// criar, mudar datas, trocar responsável, concluir e apagar refletem lá. O que for mudado direto na agenda não volta.
//
// Guardamos só o refresh token de cada pessoa, cifrado (AES-256-GCM, chave derivada de SESSION_SECRET).
// Escopos pedidos: openid + email (para conferir que a conta Google é a mesma do login) e calendar.events.
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const ESCOPOS = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];

module.exports = function criaAgenda({ pool, clientId, clientSecret, segredo, dominio, appUrl, fakeBase }) {
  const disponivel = !!(clientId && clientSecret) || !!fakeBase;
  const CAL = fakeBase || 'https://www.googleapis.com/calendar/v3';
  const chave = crypto.createHash('sha256').update('agenda-google:' + segredo).digest();
  const q = async (sql, p) => (await pool.query(sql, p)).rows;

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS google_contas (
      email text PRIMARY KEY, token text NOT NULL, conectado_em timestamptz NOT NULL DEFAULT now(), erro text)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS eventos_agenda (
      tarefa_id integer NOT NULL, email text NOT NULL, evento_id text NOT NULL, PRIMARY KEY (tarefa_id, email))`);
  }

  // ---------- cifra do token ----------
  const cifra = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', chave, iv); const d = Buffer.concat([c.update(t, 'utf8'), c.final()]); return [iv, c.getAuthTag(), d].map(b => b.toString('base64url')).join('.'); };
  const decifra = s => { const [iv, tag, d] = s.split('.').map(x => Buffer.from(x, 'base64url')); const c = crypto.createDecipheriv('aes-256-gcm', chave, iv); c.setAuthTag(tag); return Buffer.concat([c.update(d), c.final()]).toString('utf8'); };

  // ---------- OAuth ----------
  const oauth = redirect => new OAuth2Client(clientId, clientSecret, redirect);
  const estadoAssina = o => { const b = Buffer.from(JSON.stringify(o)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', chave).update(b).digest('base64url'); };
  const estadoConfere = s => { try { const [b, h] = String(s).split('.'); const h2 = crypto.createHmac('sha256', chave).update(b).digest('base64url'); if (!h || h.length !== h2.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(h2))) return null; const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; } };

  function urlConectar(email, redirect) {
    return oauth(redirect).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ESCOPOS, login_hint: email, hd: dominio,
      include_granted_scopes: true, state: estadoAssina({ email, exp: Date.now() + 10 * 60e3 }) });
  }
  // volta do Google: confere o estado, troca o código, confere que a conta é a mesma do login e guarda o token
  async function retorno(emailSessao, code, state, redirect) {
    const st = estadoConfere(state);
    if (!st || st.email !== emailSessao) throw new Error('A autorização expirou ou não é desta sessão. Tente conectar de novo.');
    const c = oauth(redirect);
    const { tokens } = await c.getToken({ code, redirect_uri: redirect });
    if (!tokens.refresh_token) throw new Error('O Google não devolveu a permissão permanente. Tente conectar de novo.');
    if (!String(tokens.scope || '').includes('calendar.events')) throw new Error('A permissão para a agenda não foi marcada. Tente de novo e marque a opção do Google Agenda.');
    const id = (await c.verifyIdToken({ idToken: tokens.id_token, audience: clientId })).getPayload();
    if (String(id.email || '').toLowerCase() !== emailSessao) throw new Error(`Conecte com a mesma conta do login (${emailSessao}).`);
    await pool.query('DELETE FROM google_contas WHERE email=$1', [emailSessao]);
    await pool.query('INSERT INTO google_contas (email, token) VALUES ($1,$2)', [emailSessao, cifra(tokens.refresh_token)]);
    clientes.delete(emailSessao);
  }

  // ---------- acesso à API da agenda ----------
  const clientes = new Map();
  async function tokenDe(email) {
    if (fakeBase) return 'fake';
    let c = clientes.get(email);
    if (!c) {
      const r = await q('SELECT token FROM google_contas WHERE email=$1 AND erro IS NULL', [email]); if (!r[0]) return null;
      c = oauth(); c.setCredentials({ refresh_token: decifra(r[0].token) }); clientes.set(email, c);
    }
    try { return (await c.getAccessToken()).token; }
    catch (e) {
      const ruim = /invalid_grant|unauthorized_client|invalid_client/.test(String(e.message) + JSON.stringify((e.response && e.response.data) || {}));
      if (ruim) { clientes.delete(email); await pool.query('UPDATE google_contas SET erro=$2 WHERE email=$1', [email, 'A permissão foi revogada ou expirou. Conecte de novo.']); return null; }
      throw e;
    }
  }
  async function cal(email, metodo, caminho, corpo) {
    const tok = await tokenDe(email); if (!tok) return { semConta: true };
    const r = await fetch(CAL + caminho, { method: metodo, headers: { authorization: 'Bearer ' + tok, ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    if (r.status === 401 || r.status === 403) {
      const t = await r.text(); console.error('agenda: acesso negado', email, r.status, t.slice(0, 200));
      if (r.status === 401) { clientes.delete(email); }
      return { status: r.status, erro: true };
    }
    return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
  }

  // ---------- montagem do evento ----------
  const maisUmDia = s => { const [a, m, d] = s.split('-').map(Number); const x = new Date(Date.UTC(a, m - 1, d + 1)); return x.toISOString().slice(0, 10); };
  const fmt = v => v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const STATUS = { afazer: 'A fazer', andamento: 'Em andamento', aguardando: 'Aguardando', concluida: 'Concluída' };
  const PRI = { 1: 'Baixa', 2: 'Normal', 3: 'Alta', 4: 'Urgente' };
  const br = s => s ? s.split('-').reverse().join('/') : '—';
  function evento(t) {
    const ini = fmt(t.inicio) || fmt(t.prazo), fim = fmt(t.prazo) || fmt(t.inicio);
    const feita = t.status === 'concluida';
    const linhas = [
      t.projeto_nome ? `Projeto: ${t.projeto_nome}` : null,
      `Situação: ${STATUS[t.status] || t.status}`, `Prioridade: ${PRI[t.prioridade] || t.prioridade}`,
      `Início: ${br(fmt(t.inicio))} · Prazo: ${br(fmt(t.prazo))}`,
      t.descricao ? '\n' + String(t.descricao).slice(0, 2000) : null,
      appUrl ? `\nAbrir no sistema: ${appUrl}` : null,
      '\n(Evento criado pelo sistema de Tarefas DARMAND. Para mudar datas ou situação, altere pelo sistema.)',
    ].filter(Boolean);
    const e = {
      summary: (feita ? '✅ ' : '📌 ') + t.titulo,
      description: linhas.join('\n'),
      start: { date: ini }, end: { date: maisUmDia(fim) },
      transparency: 'transparent',
      extendedProperties: { private: { tarefaDarmand: String(t.id) } },
    };
    const cor = feita ? '8' : t.prioridade === 4 ? '11' : t.prioridade === 3 ? '6' : null; // grafite, vermelho, laranja
    if (cor) e.colorId = cor;
    if (appUrl && /^https?:\/\//.test(appUrl)) e.source = { title: 'Tarefas DARMAND', url: appUrl };
    return e;
  }

  // ---------- sincronização ----------
  async function apaga(email, eventoId) {
    const r = await cal(email, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventoId)}`);
    return r.semConta || [200, 204, 404, 410].includes(r.status);
  }
  async function sincronizarTarefa(id) {
    const t = (await q('SELECT t.*, p.nome AS projeto_nome FROM tarefas t LEFT JOIN projetos p ON p.id = t.projeto_id WHERE t.id=$1', [id]))[0];
    const maps = await q('SELECT * FROM eventos_agenda WHERE tarefa_id=$1', [id]);
    let dono = t && t.responsavel && (t.inicio || t.prazo) ? t.responsavel : null;
    if (dono && !(await q('SELECT 1 FROM google_contas WHERE email=$1 AND erro IS NULL', [dono]))[0]) dono = null;
    for (const m of maps) if (m.email !== dono) {
      if (await apaga(m.email, m.evento_id)) await pool.query('DELETE FROM eventos_agenda WHERE tarefa_id=$1 AND email=$2', [id, m.email]);
    }
    if (!dono) return;
    const corpo = evento(t), m = maps.find(x => x.email === dono);
    if (m) {
      const r = await cal(dono, 'PUT', `/calendars/primary/events/${encodeURIComponent(m.evento_id)}`, corpo);
      if (r.status === 200) return;
      if (r.status !== 404 && r.status !== 410) return; // erro de acesso: tenta de novo na próxima mudança
      await pool.query('DELETE FROM eventos_agenda WHERE tarefa_id=$1 AND email=$2', [id, dono]); // a pessoa apagou o evento: cria de novo
    }
    const r = await cal(dono, 'POST', '/calendars/primary/events', corpo);
    if (r.status === 200 && r.json && r.json.id) await pool.query('INSERT INTO eventos_agenda (tarefa_id, email, evento_id) VALUES ($1,$2,$3)', [id, dono, r.json.id]);
  }
  // uma fila por tarefa, para mudanças seguidas (arrastar no Gantt) não criarem eventos duplicados
  const fila = new Map();
  function tarefa(id) {
    if (!disponivel) return Promise.resolve();
    const p = (fila.get(id) || Promise.resolve()).then(() => sincronizarTarefa(id)).catch(e => console.error('agenda: falha ao sincronizar tarefa', id, e.message));
    fila.set(id, p); p.then(() => { if (fila.get(id) === p) fila.delete(id); });
    return p;
  }
  async function sincronizarPessoa(email) {
    const ids = new Set([...(await q('SELECT id FROM tarefas WHERE responsavel=$1', [email])).map(r => r.id), ...(await q('SELECT tarefa_id FROM eventos_agenda WHERE email=$1', [email])).map(r => r.tarefa_id)]);
    for (const id of ids) await tarefa(id);
    return ids.size;
  }
  async function desconectar(email) {
    for (const m of await q('SELECT * FROM eventos_agenda WHERE email=$1', [email])) { try { await apaga(email, m.evento_id); } catch {} }
    await pool.query('DELETE FROM eventos_agenda WHERE email=$1', [email]);
    const r = await q('SELECT token FROM google_contas WHERE email=$1', [email]);
    if (r[0] && !fakeBase) { try { await oauth().revokeToken(decifra(r[0].token)); } catch {} }
    await pool.query('DELETE FROM google_contas WHERE email=$1', [email]);
    clientes.delete(email);
  }
  async function status(email) {
    const r = (await q('SELECT conectado_em, erro FROM google_contas WHERE email=$1', [email]))[0];
    const n = r ? (await q('SELECT count(*)::int AS n FROM eventos_agenda WHERE email=$1', [email]))[0].n : 0;
    return { disponivel, conectado: !!r && !r.erro, erro: r ? r.erro : null, eventos: n };
  }
  const conectados = async () => new Set((await q('SELECT email FROM google_contas WHERE erro IS NULL')).map(r => r.email));
  // só para o modo de teste local: conecta sem passar pelo Google
  const conectarFalso = async email => { await pool.query('DELETE FROM google_contas WHERE email=$1', [email]); await pool.query('INSERT INTO google_contas (email, token) VALUES ($1,$2)', [email, cifra('falso')]); };

  return { disponivel, init, urlConectar, retorno, tarefa, sincronizarPessoa, desconectar, status, conectados, conectarFalso };
};

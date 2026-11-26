// Gestão de Tarefas DARMAND — servidor para o Railway
// - Login com Google (Google Identity Services): só contas do Google Workspace do domínio permitido.
//   Gestores fixos vêm de ADMIN_EMAILS; outros podem ser promovidos na tela Equipe.
// - Banco: Postgres, com tabelas próprias (pessoas, projetos, tarefas, comentarios). Não usa o banco do Portal do Gerente.
// - A página (public/app.html) conversa com a API /api/* deste servidor.
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const { OAuth2Client } = require('google-auth-library');
const ia = require('./ia');

const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_DOMAIN = (process.env.ALLOWED_DOMAIN || 'darmand.com.br').toLowerCase();
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_DAYS = 14;
const NO_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
// modo de teste no computador: banco em memória e entrada sem Google. Nunca liga dentro do Railway.
const DEV = process.env.DEV_LOGIN === '1' && !NO_RAILWAY;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) { console.error('Defina SESSION_SECRET (32+ caracteres).'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('Defina DATABASE_URL (Postgres do Railway).'); process.exit(1); }
if (process.env.DEV_LOGIN === '1' && NO_RAILWAY) console.error('DEV_LOGIN ignorado: não vale no Railway.');

// datas (prazo) chegam como texto AAAA-MM-DD, sem fuso
pg.types.setTypeParser(1082, v => v);

function criaPool() {
  if (process.env.DATABASE_URL === 'memoria') {
    if (NO_RAILWAY) { console.error('Banco em memória não é permitido no Railway.'); process.exit(1); }
    const { newDb } = require('pg-mem');
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    return new Pool();
  }
  const url = process.env.DATABASE_URL;
  return new pg.Pool({ connectionString: url, ssl: process.env.PGSSL === 'disable' || url.includes('railway.internal') ? false : { rejectUnauthorized: false } });
}
const pool = criaPool();
const google = new OAuth2Client(GOOGLE_CLIENT_ID);
// endereço público (link nos eventos da agenda e retorno do Google): APP_URL, ou o domínio que o Railway gera
const APP_URL = (process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '')).replace(/\/$/, '');
const agenda = require('./agenda')({ pool, clientId: GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET || '', segredo: SESSION_SECRET,
  dominio: ALLOWED_DOMAIN, appUrl: APP_URL, fakeBase: DEV ? process.env.GOOGLE_FAKE_BASE || null : null });

const STATUS = ['afazer', 'andamento', 'aguardando', 'concluida'];
const STATUS_NOME = { afazer: 'A fazer', andamento: 'Fazendo', aguardando: 'Aguardando aprovação', concluida: 'Concluída' };
const PRIORIDADE_NOME = { 1: 'Baixa', 2: 'Normal', 3: 'Alta', 4: 'Urgente' };
// recorrência de tarefas e lembretes: ao concluir, a próxima ocorrência é criada (tarefa) ou a data avança (lembrete)
const RECORRENCIAS = { diaria: 'Todo dia', dias_uteis: 'Dias úteis', semanal: 'Toda semana', quinzenal: 'A cada 15 dias', mensal: 'Todo mês', anual: 'Todo ano' };
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
function somaRegra(s, regra) {
  const [a, m, d] = s.split('-').map(Number), dt = new Date(Date.UTC(a, m - 1, d));
  if (regra === 'diaria') dt.setUTCDate(dt.getUTCDate() + 1);
  else if (regra === 'dias_uteis') { do dt.setUTCDate(dt.getUTCDate() + 1); while ([0, 6].includes(dt.getUTCDay())); }
  else if (regra === 'semanal') dt.setUTCDate(dt.getUTCDate() + 7);
  else if (regra === 'quinzenal') dt.setUTCDate(dt.getUTCDate() + 14);
  return dt.toISOString().slice(0, 10);
}
// soma meses mantendo o dia original; dia 31 vira o último dia do mês quando ele não existe
function somaMeses(s, n) {
  const [a, m, d] = s.split('-').map(Number), alvo = new Date(Date.UTC(a, m - 1 + n, 1)), ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`;
}
// próxima data a partir de "base": avança pela regra até chegar a hoje ou depois (não acumula ocorrências atrasadas)
function proximaData(base, regra) {
  const h = hojeSP(); base = base || h;
  if (regra === 'mensal' || regra === 'anual') { const passo = regra === 'mensal' ? 1 : 12; for (let k = 1; k < 2000; k++) { const s = somaMeses(base, k * passo); if (s >= h) return s; } }
  let s = somaRegra(base, regra), n = 0; while (s < h && n++ < 5000) s = somaRegra(s, regra); return s;
}
const difDias = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const somaDias = (s, n) => { const x = new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5); return x.toISOString().slice(0, 10); };

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS pessoas (
    email text PRIMARY KEY, nome text NOT NULL, foto text, cargo text, area text,
    papel text NOT NULL DEFAULT 'membro', ativo boolean NOT NULL DEFAULT true,
    criado_em timestamptz NOT NULL DEFAULT now(), ultimo_acesso timestamptz, prefs text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projetos (
    id serial PRIMARY KEY, nome text NOT NULL, cor text NOT NULL DEFAULT '#9d162e', ativo boolean NOT NULL DEFAULT true,
    descricao text, responsavel text, inicio date, fim date, status text NOT NULL DEFAULT 'andamento',
    criado_em timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS tarefas (
    id serial PRIMARY KEY, titulo text NOT NULL, descricao text, responsavel text, criado_por text NOT NULL,
    projeto_id integer, prioridade integer NOT NULL DEFAULT 2, status text NOT NULL DEFAULT 'afazer', inicio date, prazo date,
    criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(), concluida_em timestamptz,
    recorrencia text, recorrencia_de integer)`);
  // lembretes pessoais: só o dono vê (checklist, lembretes com ou sem data, que podem se repetir)
  await pool.query(`CREATE TABLE IF NOT EXISTS lembretes (
    id serial PRIMARY KEY, dono text NOT NULL, texto text NOT NULL, data date, recorrencia text,
    feito_em timestamptz, ultima_vez timestamptz, criado_em timestamptz NOT NULL DEFAULT now())`);
  // colunas que vieram depois da primeira versão (bancos já criados recebem aqui)
  for (const sql of [
    'ALTER TABLE projetos ADD COLUMN IF NOT EXISTS descricao text', 'ALTER TABLE projetos ADD COLUMN IF NOT EXISTS responsavel text',
    'ALTER TABLE projetos ADD COLUMN IF NOT EXISTS inicio date', 'ALTER TABLE projetos ADD COLUMN IF NOT EXISTS fim date',
    "ALTER TABLE projetos ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'andamento'", 'ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS inicio date',
    'ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS recorrencia text', 'ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS recorrencia_de integer',
    'ALTER TABLE pessoas ADD COLUMN IF NOT EXISTS prefs text',
  ]) { try { await pool.query(sql); } catch (e) { if (process.env.DATABASE_URL !== 'memoria') throw e; } }
  await pool.query(`CREATE TABLE IF NOT EXISTS comentarios (
    id serial PRIMARY KEY, tarefa_id integer NOT NULL, autor text NOT NULL, tipo text NOT NULL DEFAULT 'nota',
    texto text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now())`);
  await pool.query('CREATE INDEX IF NOT EXISTS comentarios_tarefa ON comentarios (tarefa_id)');
  await agenda.init();
}

// compara dois textos em tempo constante (tamanho medido em bytes) sem lançar erro
function iguais(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

// ---------- sessão: cookie assinado (HMAC) com e-mail e validade ----------
function assina(obj) { const b = Buffer.from(JSON.stringify(obj)).toString('base64url'); const h = crypto.createHmac('sha256', SESSION_SECRET).update(b).digest('base64url'); return b + '.' + h; }
function confere(tok) {
  try {
    if (!tok || typeof tok !== 'string' || !tok.includes('.')) return null;
    const [b, h] = tok.split('.'); const h2 = crypto.createHmac('sha256', SESSION_SECRET).update(b).digest('base64url');
    if (!iguais(h, h2)) return null;
    const o = JSON.parse(Buffer.from(b, 'base64url').toString());
    return o && typeof o.email === 'string' && o.exp > Date.now() ? o : null;
  } catch { return null; }
}
const isAdminFixo = email => ADMIN_EMAILS.includes(String(email || '').toLowerCase());

// ---------- utilidades ----------
const txt = (v, max) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
const ms = v => (v == null ? null : new Date(v).getTime());
const dataOk = v => v == null || v === '' ? null : (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(Date.parse(v)) ? String(v) : undefined);
const fmtData = v => { if (v == null) return null; if (v instanceof Date) return v.toISOString().slice(0, 10); return String(v).slice(0, 10); };
const brData = v => v ? v.split('-').reverse().join('/') : 'sem prazo';
const emailOk = e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e || ''));

function tarefaOut(t, nComent) {
  return {
    id: t.id, titulo: t.titulo, descricao: t.descricao || '', responsavel: t.responsavel || null, criadoPor: t.criado_por,
    projetoId: t.projeto_id || null, prioridade: t.prioridade, status: t.status, inicio: fmtData(t.inicio), prazo: fmtData(t.prazo),
    recorrencia: t.recorrencia || null,
    criadoEm: ms(t.criado_em), atualizadoEm: ms(t.atualizado_em), concluidaEm: ms(t.concluida_em), comentarios: nComent || 0,
  };
}
const pessoaOut = p => ({ email: p.email, nome: p.nome, foto: p.foto || '', cargo: p.cargo || '', area: p.area || '', papel: p.papel, ativo: p.ativo, fixo: isAdminFixo(p.email), ultimoAcesso: ms(p.ultimo_acesso) });

async function registraEvento(tarefaId, autor, texto) {
  await pool.query('INSERT INTO comentarios (tarefa_id, autor, tipo, texto) VALUES ($1,$2,$3,$4)', [tarefaId, autor, 'evento', texto]);
}

const app = express();
// rotas async: qualquer erro vai para o tratador no fim do arquivo (o Express 4 não trata promessa rejeitada)
const envolve = h => typeof h !== 'function' || h.length === 4 ? h : (req, res, next) => { try { const r = h(req, res, next); if (r && typeof r.catch === 'function') r.catch(next); } catch (e) { next(e); } };
for (const m of ['get', 'post', 'put', 'delete']) { const orig = app[m].bind(app); app[m] = (rota, ...hs) => hs.length ? orig(rota, ...hs.map(envolve)) : orig(rota); }
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(cookieParser());
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); res.set('X-Frame-Options', 'DENY'); next(); });

app.get('/healthz', (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, versao: String(process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null }));

// ---------- logo e ícones (públicos: o login também usa) ----------
app.get('/marca/:arq', (req, res) => {
  if (!/^[a-z0-9-]+\.png$/.test(req.params.arq)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(__dirname, 'public', 'marca', req.params.arq), e => { if (e) res.status(404).end(); });
});
app.get('/favicon.ico', (req, res) => res.redirect(301, '/marca/icone-64.png'));

// ---------- login ----------
async function abreSessao(req, res, email, nome, foto) {
  const r = await pool.query('SELECT ativo FROM pessoas WHERE email=$1', [email]);
  if (r.rows[0] && !r.rows[0].ativo && !isAdminFixo(email)) return false;
  if (r.rows[0]) await pool.query('UPDATE pessoas SET nome=$2, foto=$3, ultimo_acesso=now() WHERE email=$1', [email, nome || email, foto || '']);
  else await pool.query('INSERT INTO pessoas (email, nome, foto, papel, ultimo_acesso) VALUES ($1,$2,$3,$4,now())', [email, nome || email, foto || '', isAdminFixo(email) ? 'gestor' : 'membro']);
  res.cookie('sessao', assina({ email, exp: Date.now() + SESSION_DAYS * 864e5 }), { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: SESSION_DAYS * 864e5 });
  return true;
}
app.get('/login', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'login.html'), 'utf8')
    .replace('__GOOGLE_CLIENT_ID__', GOOGLE_CLIENT_ID).replaceAll('__DOMINIO__', ALLOWED_DOMAIN).replace('__DEV__', DEV ? '1' : '');
  res.set('Cache-Control', 'no-store').type('html').send(html);
});
app.post('/api/login', express.json({ limit: '10kb' }), async (req, res) => {
  let p;
  try { p = (await google.verifyIdToken({ idToken: String(req.body.credential || ''), audience: GOOGLE_CLIENT_ID })).getPayload(); }
  catch { return res.status(401).json({ erro: 'Não foi possível confirmar o login com o Google.' }); }
  const email = String(p.email || '').toLowerCase();
  if (!p.email_verified) return res.status(403).json({ erro: 'E-mail do Google não verificado.' });
  // fora dos gestores fixos, a conta tem de ser do Google Workspace da empresa (claim hd), não só ter o domínio no e-mail
  if (!isAdminFixo(email) && (!email.endsWith('@' + ALLOWED_DOMAIN) || String(p.hd || '').toLowerCase() !== ALLOWED_DOMAIN)) return res.status(403).json({ erro: `Use sua conta do Google Workspace @${ALLOWED_DOMAIN}.` });
  if (!(await abreSessao(req, res, email, p.name, p.picture))) return res.status(403).json({ erro: 'Seu acesso foi desativado. Fale com o gestor.' });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('sessao'); res.json({ ok: true }); });

// entrada de teste (só no computador, com DEV_LOGIN=1, e só de quem está na própria máquina)
if (DEV) {
  app.get('/dev/entrar', async (req, res) => {
    const ip = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return res.status(403).end();
    const email = String(req.query.email || '').toLowerCase();
    if (!emailOk(email)) return res.status(400).send('e-mail inválido');
    if (!(await abreSessao(req, res, email, txt(req.query.nome, 80) || email.split('@')[0], ''))) return res.status(403).send('acesso desativado');
    res.redirect('/');
  });
}

// ---------- autenticação ----------
async function auth(req, res, next) {
  const s = confere(req.cookies.sessao);
  const nega = () => req.path.startsWith('/api/') ? res.status(401).json({ erro: 'login' }) : res.redirect('/login');
  if (!s) return nega();
  const r = await pool.query('SELECT * FROM pessoas WHERE email=$1', [s.email]);
  const p = r.rows[0];
  if (!p || (!p.ativo && !isAdminFixo(p.email))) { res.clearCookie('sessao'); return nega(); }
  req.email = p.email; req.pessoa = p; req.gestor = isAdminFixo(p.email) || p.papel === 'gestor';
  next();
}
const soGestor = (req, res, next) => req.gestor ? next() : res.status(403).json({ erro: 'Só gestores podem fazer isso.' });

// ---------- página ----------
app.get('/', auth, (req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'public', 'app.html')));

// ---------- eu ----------
const lePrefs = p => { try { return JSON.parse(p.prefs || '{}') || {}; } catch { return {}; } };
app.get('/api/me', auth, async (req, res) => res.json({ ...pessoaOut(req.pessoa), gestor: req.gestor, ia: ia.temChave() || DEV, agenda: await agenda.status(req.email), prefs: lePrefs(req.pessoa) }));
// preferências de cada pessoa (como quer ver as tarefas: lista ou quadro), valem em qualquer computador
const PREFS = { visao: ['lista', 'quadro'], visaoInicio: ['lista', 'quadro'] };
app.put('/api/me/prefs', auth, express.json({ limit: '5kb' }), async (req, res) => {
  const p = lePrefs(req.pessoa), b = req.body || {};
  for (const [k, ok] of Object.entries(PREFS)) if (b[k] !== undefined && ok.includes(b[k])) p[k] = b[k];
  await pool.query('UPDATE pessoas SET prefs=$2 WHERE email=$1', [req.email, JSON.stringify(p)]);
  res.json(p);
});

// ---------- lembretes pessoais (só o dono vê) ----------
const lembreteOut = l => ({ id: l.id, texto: l.texto, data: fmtData(l.data), recorrencia: l.recorrencia || null, feito: !!l.feito_em, feitoEm: ms(l.feito_em), ultimaVez: ms(l.ultima_vez), criadoEm: ms(l.criado_em) });
app.get('/api/lembretes', auth, async (req, res) => {
  // abertos + os feitos nos últimos 7 dias (para conseguir desmarcar)
  const r = await pool.query("SELECT * FROM lembretes WHERE dono=$1 AND (feito_em IS NULL OR feito_em > now() - interval '7 days') ORDER BY id", [req.email]);
  res.json(r.rows.map(lembreteOut));
});
function validaLembrete(b, ant) {
  const o = { texto: ant ? ant.texto : null, data: ant ? fmtData(ant.data) : null, recorrencia: ant ? ant.recorrencia : null };
  if (b.texto !== undefined) o.texto = txt(b.texto, 300);
  if (!o.texto) return { erro: 'Escreva o lembrete.' };
  if (b.data !== undefined) { o.data = dataOk(b.data); if (o.data === undefined) return { erro: 'Data inválida.' }; }
  if (b.recorrencia !== undefined) { o.recorrencia = b.recorrencia || null; if (o.recorrencia && !RECORRENCIAS[o.recorrencia]) return { erro: 'Repetição inválida.' }; }
  return { dados: o };
}
app.post('/api/lembretes', auth, express.json({ limit: '10kb' }), async (req, res) => {
  const n = await pool.query('SELECT count(*)::int AS n FROM lembretes WHERE dono=$1 AND feito_em IS NULL', [req.email]);
  if (n.rows[0].n >= 300) return res.status(400).json({ erro: 'Você já tem muitos lembretes abertos. Conclua ou apague alguns.' });
  const v = validaLembrete(req.body || {}); if (v.erro) return res.status(400).json(v);
  const r = await pool.query('INSERT INTO lembretes (dono, texto, data, recorrencia) VALUES ($1,$2,$3,$4) RETURNING *', [req.email, v.dados.texto, v.dados.data, v.dados.recorrencia]);
  res.json(lembreteOut(r.rows[0]));
});
app.put('/api/lembretes/:id', auth, express.json({ limit: '10kb' }), async (req, res) => {
  const r = await pool.query('SELECT * FROM lembretes WHERE id=$1 AND dono=$2', [parseInt(req.params.id, 10), req.email]); const l = r.rows[0];
  if (!l) return res.status(404).json({ erro: 'Lembrete não encontrado.' });
  const b = req.body || {};
  const v = validaLembrete(b, l); if (v.erro) return res.status(400).json(v);
  let { data } = v.dados, feito_em = l.feito_em, ultima_vez = l.ultima_vez, avancou = false;
  if (b.feito === true) {
    ultima_vez = new Date();
    // lembrete que se repete: não fica "feito", a data pula para a próxima vez
    if (v.dados.recorrencia) { data = proximaData(data || hojeSP(), v.dados.recorrencia); feito_em = null; avancou = true; }
    else feito_em = new Date();
  } else if (b.feito === false) feito_em = null;
  const r2 = await pool.query('UPDATE lembretes SET texto=$2, data=$3, recorrencia=$4, feito_em=$5, ultima_vez=$6 WHERE id=$1 RETURNING *', [l.id, v.dados.texto, data, v.dados.recorrencia, feito_em, ultima_vez]);
  res.json({ ...lembreteOut(r2.rows[0]), avancou });
});
app.delete('/api/lembretes/:id', auth, async (req, res) => {
  const r = await pool.query('DELETE FROM lembretes WHERE id=$1 AND dono=$2 RETURNING id', [parseInt(req.params.id, 10), req.email]);
  if (!r.rows[0]) return res.status(404).json({ erro: 'Lembrete não encontrado.' });
  res.json({ ok: true });
});

// ---------- Google Agenda ----------
const retornoGoogle = req => (APP_URL || `${req.protocol}://${req.get('host')}`) + '/api/google/retorno';
app.get('/api/google/conectar', auth, (req, res) => {
  if (!agenda.disponivel) return res.redirect('/?agenda=indisponivel');
  res.redirect(agenda.urlConectar(req.email, retornoGoogle(req)));
});
app.get('/api/google/retorno', auth, async (req, res) => {
  if (req.query.error) return res.redirect('/?agenda=cancelado');
  try { await agenda.retorno(req.email, String(req.query.code || ''), String(req.query.state || ''), retornoGoogle(req)); }
  catch (e) { console.error('agenda: falha ao conectar', req.email, e.message); return res.redirect('/?agenda=erro&msg=' + encodeURIComponent(e.message.slice(0, 200))); }
  agenda.sincronizarPessoa(req.email).catch(e => console.error('agenda: sincronização inicial', e.message));
  res.redirect('/?agenda=conectado');
});
app.get('/api/google/status', auth, async (req, res) => res.json(await agenda.status(req.email)));
app.post('/api/google/sincronizar', auth, async (req, res) => {
  const st = await agenda.status(req.email); if (!st.conectado) return res.status(400).json({ erro: 'Seu Google Agenda não está conectado.' });
  res.json({ ok: true, tarefas: await agenda.sincronizarPessoa(req.email) });
});
app.post('/api/google/desconectar', auth, async (req, res) => { await agenda.desconectar(req.email); res.json({ ok: true }); });
if (DEV && process.env.GOOGLE_FAKE_BASE) {
  app.get('/dev/google-falso', async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return res.status(403).end();
    const email = String(req.query.email || '').toLowerCase(); await agenda.conectarFalso(email); await agenda.sincronizarPessoa(email); res.json({ ok: true });
  });
}

// ---------- equipe ----------
app.get('/api/pessoas', auth, async (req, res) => {
  const [r, con] = await Promise.all([pool.query('SELECT * FROM pessoas ORDER BY nome'), agenda.conectados()]);
  res.json(r.rows.filter(p => req.gestor || p.ativo).map(p => ({ ...pessoaOut(p), agenda: con.has(p.email) })));
});
// cadastra alguém antes do primeiro acesso (para já receber tarefas)
app.post('/api/pessoas', auth, soGestor, express.json({ limit: '10kb' }), async (req, res) => {
  const b = req.body || {}, email = String(b.email || '').trim().toLowerCase();
  if (!emailOk(email) || !email.endsWith('@' + ALLOWED_DOMAIN)) return res.status(400).json({ erro: `Informe um e-mail @${ALLOWED_DOMAIN}.` });
  const ex = await pool.query('SELECT email FROM pessoas WHERE email=$1', [email]);
  if (ex.rows[0]) return res.status(409).json({ erro: 'Essa pessoa já está na equipe.' });
  await pool.query('INSERT INTO pessoas (email, nome, cargo, area, papel) VALUES ($1,$2,$3,$4,$5)',
    [email, txt(b.nome, 80) || email.split('@')[0], txt(b.cargo, 60), txt(b.area, 60), b.papel === 'gestor' ? 'gestor' : 'membro']);
  res.json({ ok: true });
});
app.put('/api/pessoas/:email', auth, express.json({ limit: '10kb' }), async (req, res) => {
  const email = String(req.params.email).toLowerCase(), b = req.body || {};
  const r = await pool.query('SELECT * FROM pessoas WHERE email=$1', [email]); const p = r.rows[0];
  if (!p) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
  const proprio = email === req.email;
  if (!req.gestor && !proprio) return res.status(403).json({ erro: 'Sem permissão.' });
  const novo = { nome: p.nome, cargo: p.cargo, area: p.area, papel: p.papel, ativo: p.ativo };
  if (b.nome !== undefined) novo.nome = txt(b.nome, 80) || p.nome;
  if (b.cargo !== undefined) novo.cargo = txt(b.cargo, 60);
  if (b.area !== undefined) novo.area = txt(b.area, 60);
  if (req.gestor && !proprio) {
    if (b.papel !== undefined) novo.papel = b.papel === 'gestor' ? 'gestor' : 'membro';
    if (b.ativo !== undefined) novo.ativo = !!b.ativo;
  }
  if (isAdminFixo(email)) { novo.papel = 'gestor'; novo.ativo = true; }
  await pool.query('UPDATE pessoas SET nome=$2, cargo=$3, area=$4, papel=$5, ativo=$6 WHERE email=$1', [email, novo.nome, novo.cargo, novo.area, novo.papel, novo.ativo]);
  res.json({ ok: true });
});

// ---------- projetos ----------
// Cadastro: nome, cor, descrição, responsável (dono do projeto), início, fim previsto e situação.
// Só gestores criam; o gestor ou o responsável pelo projeto editam.
const corOk = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
const PROJ_STATUS = ['planejamento', 'andamento', 'pausado', 'concluido', 'cancelado'];
const projetoOut = p => ({ id: p.id, nome: p.nome, cor: p.cor, descricao: p.descricao || '', responsavel: p.responsavel || null,
  inicio: fmtData(p.inicio), fim: fmtData(p.fim), status: p.status || 'andamento', ativo: !['concluido', 'cancelado'].includes(p.status), criadoEm: ms(p.criado_em) });
async function validaProjeto(b, ant) {
  const o = { nome: ant.nome, cor: ant.cor, descricao: ant.descricao, responsavel: ant.responsavel, inicio: fmtData(ant.inicio), fim: fmtData(ant.fim), status: ant.status || 'andamento' };
  if (b.nome !== undefined) o.nome = txt(b.nome, 80);
  if (!o.nome) return { erro: 'Dê um nome ao projeto.' };
  if (b.cor !== undefined && corOk(b.cor)) o.cor = b.cor;
  if (b.descricao !== undefined) o.descricao = txt(b.descricao, 3000);
  if (b.responsavel !== undefined) {
    o.responsavel = b.responsavel ? String(b.responsavel).toLowerCase() : null;
    if (o.responsavel) { const r = await pool.query('SELECT ativo FROM pessoas WHERE email=$1', [o.responsavel]); if (!r.rows[0] || !r.rows[0].ativo) return { erro: 'Responsável não está na equipe.' }; }
  }
  for (const k of ['inicio', 'fim']) if (b[k] !== undefined) { o[k] = dataOk(b[k]); if (o[k] === undefined) return { erro: 'Data inválida.' }; }
  if (o.inicio && o.fim && o.fim < o.inicio) return { erro: 'O fim previsto não pode ser antes do início.' };
  if (b.status !== undefined) { if (!PROJ_STATUS.includes(b.status)) return { erro: 'Situação inválida.' }; o.status = b.status; }
  return { dados: o };
}
app.get('/api/projetos', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM projetos ORDER BY nome');
  res.json(r.rows.map(projetoOut));
});
app.post('/api/projetos', auth, soGestor, express.json({ limit: '20kb' }), async (req, res) => {
  const v = await validaProjeto(req.body || {}, { cor: '#9d162e', status: 'andamento' }); if (v.erro) return res.status(400).json(v);
  const d = v.dados;
  const r = await pool.query('INSERT INTO projetos (nome, cor, descricao, responsavel, inicio, fim, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [d.nome, d.cor, d.descricao, d.responsavel, d.inicio, d.fim, d.status]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/projetos/:id', auth, express.json({ limit: '20kb' }), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await pool.query('SELECT * FROM projetos WHERE id=$1', [id]); const p = r.rows[0];
  if (!p) return res.status(404).json({ erro: 'Projeto não encontrado.' });
  if (!req.gestor && p.responsavel !== req.email) return res.status(403).json({ erro: 'Só o gestor ou o responsável pelo projeto podem editá-lo.' });
  const v = await validaProjeto(req.body || {}, p); if (v.erro) return res.status(400).json(v);
  const d = v.dados;
  await pool.query('UPDATE projetos SET nome=$2, cor=$3, descricao=$4, responsavel=$5, inicio=$6, fim=$7, status=$8 WHERE id=$1',
    [id, d.nome, d.cor, d.descricao, d.responsavel, d.inicio, d.fim, d.status]);
  if (d.nome !== p.nome) for (const t of (await pool.query('SELECT id FROM tarefas WHERE projeto_id=$1', [id])).rows) agenda.tarefa(t.id); // nome do projeto aparece no evento
  res.json({ ok: true });
});

// ---------- tarefas ----------
// Quem pode o quê:
//  - gestor: tudo;
//  - quem criou a tarefa: edita tudo e pode apagar;
//  - responsável: muda o andamento (status) e comenta; prazo, responsável e conteúdo ficam com quem criou ou com o gestor;
//  - todos da equipe veem todas as tarefas e podem comentar.
app.get('/api/tarefas', auth, async (req, res) => {
  const [t, c] = await Promise.all([
    pool.query('SELECT * FROM tarefas ORDER BY id DESC'),
    pool.query("SELECT tarefa_id, count(*) AS n FROM comentarios WHERE tipo='nota' GROUP BY tarefa_id"),
  ]);
  const n = {}; for (const x of c.rows) n[x.tarefa_id] = +x.n;
  res.json(t.rows.map(x => tarefaOut(x, n[x.id])));
});

async function validaTarefa(b, parcial) {
  const out = {}, erro = m => ({ erro: m });
  if (!parcial || b.titulo !== undefined) { out.titulo = txt(b.titulo, 160); if (!out.titulo) return erro('Dê um título à tarefa.'); }
  if (b.descricao !== undefined) out.descricao = txt(b.descricao, 5000);
  if (b.responsavel !== undefined) {
    out.responsavel = b.responsavel ? String(b.responsavel).toLowerCase() : null;
    if (out.responsavel) { const r = await pool.query('SELECT ativo FROM pessoas WHERE email=$1', [out.responsavel]); if (!r.rows[0] || !r.rows[0].ativo) return erro('Responsável não está na equipe.'); }
  }
  if (b.projetoId !== undefined) {
    out.projeto_id = b.projetoId ? parseInt(b.projetoId, 10) : null;
    if (out.projeto_id) { const r = await pool.query('SELECT id FROM projetos WHERE id=$1', [out.projeto_id]); if (!r.rows[0]) return erro('Projeto não encontrado.'); }
  }
  if (b.prioridade !== undefined) { out.prioridade = parseInt(b.prioridade, 10); if (!PRIORIDADE_NOME[out.prioridade]) return erro('Prioridade inválida.'); }
  if (b.status !== undefined) { out.status = String(b.status); if (!STATUS.includes(out.status)) return erro('Situação inválida.'); }
  if (b.prazo !== undefined) { out.prazo = dataOk(b.prazo); if (out.prazo === undefined) return erro('Prazo inválido.'); }
  if (b.inicio !== undefined) { out.inicio = dataOk(b.inicio); if (out.inicio === undefined) return erro('Data de início inválida.'); }
  if (b.recorrencia !== undefined) { out.recorrencia = b.recorrencia || null; if (out.recorrencia && !RECORRENCIAS[out.recorrencia]) return erro('Recorrência inválida.'); }
  return { dados: out };
}

// tarefa recorrente concluída: cria a próxima ocorrência (mesmo responsável, projeto e duração), sem duplicar
async function proximaOcorrencia(t, autor) {
  if (!t.recorrencia) return null;
  const origem = t.recorrencia_de || t.id;
  const ja = await pool.query("SELECT id FROM tarefas WHERE recorrencia_de=$1 AND status <> 'concluida' AND id <> $2", [origem, t.id]);
  if (ja.rows[0]) return null;
  const ini = fmtData(t.inicio), fim = fmtData(t.prazo), base = fim || ini;
  const prazo = proximaData(base, t.recorrencia);
  const inicio = ini && fim ? somaDias(prazo, -difDias(ini, fim)) : (ini && !fim ? prazo : null);
  const novoPrazo = fim || !ini ? prazo : null;
  const r = await pool.query(`INSERT INTO tarefas (titulo, descricao, responsavel, criado_por, projeto_id, prioridade, status, inicio, prazo, recorrencia, recorrencia_de)
    VALUES ($1,$2,$3,$4,$5,$6,'afazer',$7,$8,$9,$10) RETURNING id`, [t.titulo, t.descricao, t.responsavel, t.criado_por, t.projeto_id, t.prioridade, inicio, novoPrazo, t.recorrencia, origem]);
  const nid = r.rows[0].id;
  await registraEvento(nid, autor, `criou esta ocorrência da tarefa recorrente (${RECORRENCIAS[t.recorrencia].toLowerCase()}), prazo: ${brData(novoPrazo || inicio)}`);
  await registraEvento(t.id, autor, `próxima ocorrência criada para ${brData(novoPrazo || inicio)}`);
  agenda.tarefa(nid);
  return nid;
}

app.post('/api/tarefas', auth, express.json({ limit: '50kb' }), async (req, res) => {
  const v = await validaTarefa(req.body || {}, false); if (v.erro) return res.status(400).json(v);
  const d = { descricao: null, responsavel: null, projeto_id: null, prioridade: 2, status: 'afazer', inicio: null, prazo: null, recorrencia: null, ...v.dados };
  if (d.inicio && d.prazo && d.prazo < d.inicio) return res.status(400).json({ erro: 'O prazo não pode ser antes do início.' });
  const r = await pool.query(`INSERT INTO tarefas (titulo, descricao, responsavel, criado_por, projeto_id, prioridade, status, inicio, prazo, concluida_em, recorrencia)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [d.titulo, d.descricao, d.responsavel, req.email, d.projeto_id, d.prioridade, d.status, d.inicio, d.prazo, d.status === 'concluida' ? new Date() : null, d.recorrencia]);
  const t = r.rows[0];
  await registraEvento(t.id, req.email, `criou a tarefa (prazo: ${brData(d.prazo)}${d.recorrencia ? ', repete: ' + RECORRENCIAS[d.recorrencia].toLowerCase() : ''})`);
  agenda.tarefa(t.id);
  res.json(tarefaOut(t, 0));
});

app.put('/api/tarefas/:id', auth, express.json({ limit: '50kb' }), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await pool.query('SELECT * FROM tarefas WHERE id=$1', [id]); const t = r.rows[0];
  if (!t) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
  const v = await validaTarefa(req.body || {}, true); if (v.erro) return res.status(400).json(v);
  const d = v.dados;
  // quem aprova: quem criou a tarefa ou um gestor. Quem só é responsável leva a tarefa até "Aguardando aprovação".
  const total = req.gestor || t.criado_por === req.email;
  let enviadaParaAprovacao = false;
  if (!total) {
    const soStatus = Object.keys(d).every(k => k === 'status');
    if (!(t.responsavel === req.email && soStatus)) return res.status(403).json({ erro: 'Você só pode mudar a situação das tarefas sob sua responsabilidade. Prazo e responsável ficam com quem criou a tarefa ou com o gestor.' });
    if (d.status === 'concluida') { d.status = 'aguardando'; enviadaParaAprovacao = true; }
    if (t.status === 'concluida' && d.status && d.status !== 'concluida') return res.status(403).json({ erro: 'Esta tarefa já foi aprovada. Para reabrir, fale com quem criou a tarefa ou com o gestor.' });
  }
  const n = { titulo: t.titulo, descricao: t.descricao, responsavel: t.responsavel, projeto_id: t.projeto_id, prioridade: t.prioridade, status: t.status, inicio: fmtData(t.inicio), prazo: fmtData(t.prazo), recorrencia: t.recorrencia || null, ...d };
  if (n.inicio && n.prazo && n.prazo < n.inicio) return res.status(400).json({ erro: 'O prazo não pode ser antes do início.' });
  const concluida_em = n.status === 'concluida' ? (t.status === 'concluida' ? t.concluida_em : new Date()) : null;
  await pool.query(`UPDATE tarefas SET titulo=$2, descricao=$3, responsavel=$4, projeto_id=$5, prioridade=$6, status=$7, inicio=$8, prazo=$9, concluida_em=$10, recorrencia=$11, atualizado_em=now() WHERE id=$1`,
    [id, n.titulo, n.descricao, n.responsavel, n.projeto_id, n.prioridade, n.status, n.inicio, n.prazo, concluida_em, n.recorrencia]);
  // histórico do que importa para o controle
  if (n.status !== t.status) {
    const outro = t.responsavel && t.responsavel !== req.email;
    const txtEv = t.status === 'aguardando' && n.status === 'concluida' && outro ? 'aprovou a tarefa ✅'
      : t.status === 'aguardando' && ['afazer', 'andamento'].includes(n.status) && outro ? `devolveu a tarefa para ajustes (${STATUS_NOME[n.status]})`
      : n.status === 'aguardando' ? 'terminou e enviou para aprovação'
      : `mudou a situação de "${STATUS_NOME[t.status]}" para "${STATUS_NOME[n.status]}"`;
    await registraEvento(id, req.email, txtEv);
  }
  if ((n.recorrencia || null) !== (t.recorrencia || null)) await registraEvento(id, req.email, n.recorrencia ? `passou a repetir: ${RECORRENCIAS[n.recorrencia].toLowerCase()}` : 'deixou de repetir');
  let proxima = null;
  if (n.status === 'concluida' && t.status !== 'concluida') proxima = await proximaOcorrencia({ ...t, ...n, id }, req.email);
  if (n.prazo !== fmtData(t.prazo)) await registraEvento(id, req.email, `mudou o prazo de ${brData(fmtData(t.prazo))} para ${brData(n.prazo)}`);
  if (n.responsavel !== t.responsavel) {
    const nm = async e => { if (!e) return 'ninguém'; const r = await pool.query('SELECT nome FROM pessoas WHERE email=$1', [e]); return (r.rows[0] && r.rows[0].nome) || e; };
    await registraEvento(id, req.email, `passou a tarefa de ${await nm(t.responsavel)} para ${await nm(n.responsavel)}`);
  }
  if (n.prioridade !== t.prioridade) await registraEvento(id, req.email, `mudou a prioridade para ${PRIORIDADE_NOME[n.prioridade]}`);
  agenda.tarefa(id);
  const r2 = await pool.query('SELECT * FROM tarefas WHERE id=$1', [id]);
  res.json({ ...tarefaOut(r2.rows[0]), enviadaParaAprovacao, proximaOcorrencia: proxima });
});

app.delete('/api/tarefas/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await pool.query('SELECT criado_por FROM tarefas WHERE id=$1', [id]); const t = r.rows[0];
  if (!t) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
  if (!req.gestor && t.criado_por !== req.email) return res.status(403).json({ erro: 'Só quem criou a tarefa ou um gestor pode apagá-la.' });
  await pool.query('DELETE FROM comentarios WHERE tarefa_id=$1', [id]);
  await pool.query('DELETE FROM tarefas WHERE id=$1', [id]);
  agenda.tarefa(id); // apaga o evento da agenda
  res.json({ ok: true });
});

// ---------- comentários e histórico ----------
app.get('/api/tarefas/:id/comentarios', auth, async (req, res) => {
  const r = await pool.query('SELECT id, autor, tipo, texto, criado_em FROM comentarios WHERE tarefa_id=$1 ORDER BY id', [parseInt(req.params.id, 10)]);
  res.json(r.rows.map(c => ({ id: c.id, autor: c.autor, tipo: c.tipo, texto: c.texto, em: ms(c.criado_em) })));
});
app.post('/api/tarefas/:id/comentarios', auth, express.json({ limit: '20kb' }), async (req, res) => {
  const id = parseInt(req.params.id, 10), texto = txt(req.body && req.body.texto, 2000);
  if (!texto) return res.status(400).json({ erro: 'Escreva o comentário.' });
  const r = await pool.query('SELECT id FROM tarefas WHERE id=$1', [id]); if (!r.rows[0]) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
  await pool.query('INSERT INTO comentarios (tarefa_id, autor, tipo, texto) VALUES ($1,$2,$3,$4)', [id, req.email, 'nota', texto]);
  await pool.query('UPDATE tarefas SET atualizado_em=now() WHERE id=$1', [id]);
  res.json({ ok: true });
});
app.delete('/api/comentarios/:id', auth, async (req, res) => {
  const r = await pool.query('SELECT autor, tipo FROM comentarios WHERE id=$1', [parseInt(req.params.id, 10)]); const c = r.rows[0];
  if (!c || c.tipo !== 'nota') return res.status(404).json({ erro: 'Comentário não encontrado.' });
  if (c.autor !== req.email && !req.gestor) return res.status(403).json({ erro: 'Sem permissão.' });
  await pool.query('DELETE FROM comentarios WHERE id=$1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
});

// ---------- narrar (IA) ----------
// A IA devolve uma PROPOSTA; aqui ela é conferida (pessoas, projetos e datas têm de existir e ser válidos)
// e volta para a tela, onde a pessoa revisa e cria pelas rotas normais.
const usoNarrar = new Map(); // limite simples por pessoa: 30 narrações por hora
const EXEMPLO_DEV = h => ({ resumo: 'Exemplo de teste (sem chave da IA neste computador): 2 tarefas para um projeto novo.',
  projetos_novos: [{ ref: 'p1', nome: 'Projeto de exemplo', descricao: 'Criado no modo de teste', responsavel: null, inicio: h, fim: null }],
  tarefas: [
    { titulo: 'Primeira tarefa do exemplo', descricao: '', responsavel: null, projeto_id: null, projeto_novo_ref: 'p1', inicio: h, prazo: h, prioridade: 2 },
    { titulo: 'Segunda tarefa do exemplo', descricao: 'Detalhe de exemplo', responsavel: null, projeto_id: null, projeto_novo_ref: 'p1', inicio: null, prazo: null, prioridade: 3, recorrencia: 'semanal' },
  ], lembretes: [{ texto: 'Lembrete de exemplo: ligar para o fornecedor', data: h, recorrencia: null }], duvidas: ['Este é um exemplo fixo: configure ANTHROPIC_API_KEY para a IA entender a narração de verdade.'] });

app.post('/api/narrar', auth, express.json({ limit: '40kb' }), async (req, res) => {
  const texto = txt(req.body && req.body.texto, 8000);
  if (!texto || texto.length < 5) return res.status(400).json({ erro: 'Narre ou escreva o que precisa ser feito.' });
  if (!ia.temChave() && !DEV) console.error('IA: narração recusada, ANTHROPIC_API_KEY não definida');
  if (!ia.temChave() && !DEV) return res.status(503).json({ erro: 'A IA ainda não foi configurada. Falta a variável ANTHROPIC_API_KEY no Railway.' });
  const agora = Date.now(), uso = (usoNarrar.get(req.email) || []).filter(t => agora - t < 3600e3);
  if (uso.length >= 30) return res.status(429).json({ erro: 'Muitas narrações na última hora. Espere um pouco.' });
  usoNarrar.set(req.email, uso.concat(agora));

  const [pp, pj] = await Promise.all([pool.query('SELECT * FROM pessoas WHERE ativo = true ORDER BY nome'), pool.query('SELECT * FROM projetos ORDER BY nome')]);
  const pessoas = pp.rows, projetos = pj.rows.map(projetoOut).filter(p => p.ativo);
  const foco = req.body.projetoId ? projetos.find(p => p.id === parseInt(req.body.projetoId, 10)) : null;
  const hoje = hojeSP();
  const contexto = {
    hoje, dia_da_semana: new Date(hoje + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' }),
    narrador: { email: req.email, nome: req.pessoa.nome },
    equipe: pessoas.map(p => ({ email: p.email, nome: p.nome, cargo: p.cargo || undefined, area: p.area || undefined })),
    projetos: projetos.map(p => ({ id: p.id, nome: p.nome, inicio: p.inicio || undefined, fim: p.fim || undefined, responsavel: p.responsavel || undefined })),
    pode_criar_projetos: req.gestor, projeto_foco: foco ? { id: foco.id, nome: foco.nome } : null,
  };

  let r;
  if (!ia.temChave()) r = EXEMPLO_DEV(hoje);
  else {
    const t0 = Date.now();
    try { r = await ia.entender(texto, contexto); console.log('IA: narração entendida', req.email, `${Date.now() - t0} ms`, `${(r.tarefas || []).length} tarefas`); }
    catch (e) {
      console.error('IA: falha', req.email, `${Date.now() - t0} ms`, e.constructor && e.constructor.name, e.status || '', String(e.message || '').slice(0, 300));
      if (e.status === 422 || (e.status === 502 && !(e instanceof ia.Anthropic.APIError))) return res.status(e.status).json({ erro: e.message });
      if (e instanceof ia.Anthropic.RateLimitError) return res.status(429).json({ erro: 'A IA está ocupada agora. Tente de novo em um minuto.' });
      if (e instanceof ia.Anthropic.AuthenticationError || e instanceof ia.Anthropic.PermissionDeniedError) { console.error('IA: chave recusada', e.status); return res.status(503).json({ erro: 'A chave da IA foi recusada. Confira ANTHROPIC_API_KEY no Railway (tem de ser uma chave de API, que começa com sk-ant-api).' }); }
      if (e instanceof ia.Anthropic.BadRequestError && /credit|billing|balance/i.test(String(e.message))) return res.status(503).json({ erro: 'A conta da Anthropic está sem créditos. Adicione créditos em platform.claude.com → Billing.' });
      if (e instanceof ia.Anthropic.APIConnectionError) return res.status(504).json({ erro: 'Sem resposta da IA. Tente de novo.' });
      if (e instanceof ia.Anthropic.APIError) { console.error('IA: erro', e.status, e.message); return res.status(502).json({ erro: 'A IA respondeu com erro. Tente de novo.' }); }
      throw e;
    }
  }

  // confere tudo o que a IA propôs
  const emails = new Set(pessoas.map(p => p.email)), idsProj = new Set(projetos.map(p => p.id));
  const pessoaOk = e => { const x = e ? String(e).toLowerCase() : null; return x && emails.has(x) ? x : null; };
  const data = v => { const d = dataOk(v); return d === undefined ? null : d; };
  const ordena = (a, b) => (a && b && b < a ? [b, a] : [a, b]);
  const projetosNovos = (req.gestor && Array.isArray(r.projetos_novos) ? r.projetos_novos : []).slice(0, 5).map(p => {
    const [inicio, fim] = ordena(data(p.inicio), data(p.fim));
    return { ref: txt(p.ref, 20), nome: txt(p.nome, 80), descricao: txt(p.descricao, 3000) || '', responsavel: pessoaOk(p.responsavel), inicio, fim };
  }).filter(p => p.ref && p.nome);
  const refs = new Set(projetosNovos.map(p => p.ref));
  const tarefas = (Array.isArray(r.tarefas) ? r.tarefas : []).slice(0, 60).map(t => {
    const [inicio, prazo] = ordena(data(t.inicio), data(t.prazo));
    const pid = Number.isInteger(t.projeto_id) && idsProj.has(t.projeto_id) ? t.projeto_id : null;
    const ref = !pid && t.projeto_novo_ref && refs.has(t.projeto_novo_ref) ? t.projeto_novo_ref : null;
    return { titulo: txt(t.titulo, 160), descricao: txt(t.descricao, 5000) || '', responsavel: pessoaOk(t.responsavel), projetoId: pid, projetoNovoRef: ref,
      inicio, prazo, prioridade: [1, 2, 3, 4].includes(t.prioridade) ? t.prioridade : 2, recorrencia: RECORRENCIAS[t.recorrencia] ? t.recorrencia : null };
  }).filter(t => t.titulo);
  const duvidas = (Array.isArray(r.duvidas) ? r.duvidas : []).map(d => txt(d, 300)).filter(Boolean).slice(0, 10);
  const lembretes = (Array.isArray(r.lembretes) ? r.lembretes : []).slice(0, 30).map(l => ({ texto: txt(l.texto, 300), data: data(l.data), recorrencia: RECORRENCIAS[l.recorrencia] ? l.recorrencia : null })).filter(l => l.texto);
  res.json({ resumo: txt(r.resumo, 400) || '', projetosNovos, tarefas, lembretes, duvidas });
});

// tratador de erro: responde em vez de derrubar o processo
app.use((err, req, res, next) => {
  const st = err && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (st === 500) console.error('erro na rota', req.method, req.path, err);
  if (res.headersSent) return next(err);
  res.status(st).json({ erro: st === 500 ? 'Erro interno. Tente de novo.' : 'Requisição inválida.' });
});
process.on('unhandledRejection', e => console.error('promessa rejeitada sem tratamento:', e));

initDb().then(() => app.listen(PORT, () => console.log(`Gestão de Tarefas no ar na porta ${PORT}${DEV ? ' (modo de teste: http://localhost:' + PORT + '/login)' : ''}`))).catch(e => { console.error(e); process.exit(1); });

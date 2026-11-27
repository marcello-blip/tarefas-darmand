// Módulos do Portal do Gerente (vendas, metas, produto, equipe de vendas, comunicados) dentro da Gestão DARMAND.
// - Dados: tabela docs (coleção + id + JSON), no mesmo formato do portal antigo. A tarefa diária grava por /api/ingest (token INGEST_TOKEN).
//   Mudança do portal antigo: com o INGEST_TOKEN igual ao do portal, na primeira subida tudo é copiado de lá para o banco próprio (uma vez só).
// - Página: portal/painel-lojas.html, aberta dentro da Gestão (em /painel); public/portal-shim.js liga a página às rotas /papi.
// - Quem vê: níveis de acesso por pessoa (administrador geral, diretoria, gerente de loja, equipe), definidos em Admin → Pessoas e acessos.
// - Integração com as tarefas: comunicado com "exigir ação" vira uma tarefa para o gerente de cada loja, e a diretoria acompanha por loja.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COLS = new Set(['lojas', 'vendas', 'analise', 'base', 'ano', 'metas', 'ecommerce', 'estoque', 'mov', 'gerentes', 'recados', 'leituras', 'perfis', 'equipe']);
const UPSERT = `INSERT INTO docs(col,id,data) VALUES($1,$2,$3) ON CONFLICT (col,id) DO UPDATE SET data=EXCLUDED.data, version=docs.version+1, updated_at=now()`;

module.exports = function criaPortal({ app, express, pool, origem, auth, isAdmin, dominio, iguais, agenda, hojeSP }) {
  // os dados das lojas (tabela docs) ficam no banco próprio; "origem" é de onde vem a cópia única do portal antigo: { ids(col), doc(col, id), usuarios() }
  const dpool = pool;
  const INGEST_TOKEN = process.env.INGEST_TOKEN || '';
  const J = v => JSON.stringify(v); // jsonb sempre entra como texto JSON (vale para objeto, lista e número)
  const grava = (col, id, data, c) => (c || dpool).query(UPSERT, [col, id, J(data)]);
  const le = async (col, id) => { const r = await dpool.query('SELECT data FROM docs WHERE col=$1 AND id=$2', [col, id]); return r.rows[0] ? r.rows[0].data : null; };
  const leCol = async col => (await dpool.query('SELECT id, data, updated_at FROM docs WHERE col=$1', [col])).rows;
  const nomeDe = async e => { const r = await pool.query('SELECT nome FROM pessoas WHERE email=$1', [e]); return (r.rows[0] && r.rows[0].nome) || e; };
  const ehGerente = req => !!(req.vinc && (req.vinc.papel || 'gerente') === 'gerente');

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS docs (
      col text NOT NULL, id text NOT NULL, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (col, id))`);
    // tarefa que nasceu de um comunicado: origem = 'recado:<id do comunicado>'
    try { await pool.query('ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS origem text'); } catch (e) { if (process.env.DATABASE_URL !== 'memoria') throw e; }
    // níveis de acesso: nível, módulos marcados (vazio = padrão do nível) e "todas as lojas" para quem só consulta
    for (const c of ['nivel', 'acesso_modulos', 'acesso_lojas']) { try { await pool.query(`ALTER TABLE pessoas ADD COLUMN IF NOT EXISTS ${c} text`); } catch (e) { if (process.env.DATABASE_URL !== 'memoria') throw e; } }
  }

  // ---------- mudança do portal antigo: copia tudo, uma vez, para o banco próprio ----------
  // Só roda quando o banco próprio ainda não tem lojas. As lojas são copiadas por último: se a cópia parar no meio,
  // na próxima subida ela recomeça (o que já foi copiado não é gravado de novo).
  const estado = { importacao: origem ? 'pendente' : 'sem origem' };
  async function importaDoPortal() {
    if (!origem) return null;
    if ((await pool.query("SELECT id FROM docs WHERE col='lojas' LIMIT 1")).rows[0]) { estado.importacao = 'já feita'; return null; }
    estado.importacao = 'copiando';
    // antes de tudo, confere se o portal antigo já tem as rotas de cópia (senão os documentos viriam vazios)
    const usuarios = await origem.usuarios();
    if (!usuarios) throw new Error('o portal antigo ainda não tem as rotas de cópia');
    const cont = {};
    for (const col of [...[...COLS].filter(c => c !== 'lojas'), 'lojas']) {
      const ids = await origem.ids(col);
      cont[col] = 0;
      for (const id of ids) { // um por vez: alguns documentos são grandes
        if ((await pool.query('SELECT id FROM docs WHERE col=$1 AND id=$2', [col, id])).rows[0]) { cont[col]++; continue; } // já veio numa tentativa anterior
        const r = await origem.doc(col, id); if (!r) continue;
        await pool.query('INSERT INTO docs(col,id,data,version,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (col,id) DO NOTHING', [col, id, J(r.data), r.version || 1, r.updated_at ? new Date(r.updated_at) : new Date()]);
        estado.importacao = `copiando (${col})`;
        cont[col]++;
      }
    }
    // gerentes vinculados entram na equipe com o nome e a foto que tinham no portal (para já receberem tarefas)
    let pessoas = 0;
    try {
      const us = new Map(usuarios.map(u => [String(u.email).toLowerCase(), u]));
      for (const g of (await pool.query("SELECT id FROM docs WHERE col='gerentes'")).rows) {
        const e = String(g.id).toLowerCase(), u = us.get(e);
        if (!/^[^@s|]+@[^@s|]+.[a-z]{2,}$/.test(e)) continue;
        const r = await pool.query(`INSERT INTO pessoas (email, nome, foto, papel) VALUES ($1,$2,$3,'membro') ON CONFLICT (email) DO NOTHING`, [e, (u && u.nome) || e.split('@')[0], (u && u.foto) || '']);
        pessoas += r.rowCount || 0;
      }
    } catch (e) { console.error('portal: não copiei os nomes dos gerentes:', e.message); }
    dadosEm = 0; estado.importacao = 'feita agora'; estado.copiados = cont;
    console.log('Portal: dados copiados do portal antigo:', JSON.stringify(cont), '· pessoas novas:', pessoas);
    return cont;
  }
  const situacao = async () => ({ lojas: await temDados(), importacao: estado.importacao });

  // acesso ao portal: diretoria, ou vínculo com uma loja
  // sem nenhuma loja gravada (banco novo, antes da primeira carga), os módulos do portal nem aparecem
  let dadosEm = 0, dadosOk = false;
  async function temDados() {
    if (dadosOk || Date.now() - dadosEm < 120000) return dadosOk;
    dadosEm = Date.now();
    try { dadosOk = !!(await dpool.query("SELECT id FROM docs WHERE col='lojas' LIMIT 1")).rows[0]; } catch (e) { console.error('portal: não consegui ler os dados das lojas:', e.message); dadosOk = false; }
    return dadosOk;
  }
  // ---------- níveis de acesso ----------
  // admin (administrador geral): vê tudo e define o acesso dos outros. Quem está em ADMIN_EMAILS é sempre admin.
  // diretoria: todas as lojas; escreve comunicados e metas; não mexe nos acessos.
  // gerente: uma loja (vínculo em docs/gerentes, papel "gerente"); compara com as outras, sem o detalhe delas.
  // equipe: só tarefas. Se o administrador marcar módulos, a pessoa só consulta: uma loja (papel "leitor") ou todas.
  const NIVEIS = ['admin', 'diretoria', 'gerente', 'equipe'], MODULOS = ['vendas', 'produto', 'pessoas'];
  const VISTAS = { vendas: ['visao', 'vendas', 'metas', 'ano', 'ese', 'campanhas', 'rede'], produto: ['demanda', 'produto', 'estoque'], pessoas: ['comunicados', 'equipe', 'perfil'] };
  function calcula(p, vinc) {
    const papelV = vinc ? (vinc.papel || 'gerente') : null;
    const nivel = isAdmin(p.email) ? 'admin' : NIVEIS.includes(p.nivel) ? p.nivel : papelV === 'gerente' ? 'gerente' : 'equipe';
    let modulos = nivel === 'admin' ? MODULOS : p.acesso_modulos != null ? String(p.acesso_modulos).split(',').filter(m => MODULOS.includes(m)) : nivel === 'equipe' ? [] : MODULOS;
    const lojas = nivel === 'admin' || nivel === 'diretoria' ? 'todas' : nivel === 'equipe' && p.acesso_lojas === 'todas' ? 'todas' : vinc && vinc.loja ? [vinc.loja] : [];
    if (lojas !== 'todas' && !lojas.length) modulos = []; // sem loja não há o que mostrar
    const diretoria = nivel === 'admin' || nivel === 'diretoria';
    // telas da página do portal que a pessoa pode abrir ("time" = contexto dos vendedores: só diretoria e o gerente da loja)
    const vistas = modulos.flatMap(m => VISTAS[m]).concat(modulos.includes('pessoas') && (diretoria || nivel === 'gerente') ? ['time'] : []);
    return { nivel, admin: nivel === 'admin', diretoria, modulos, lojas, vistas };
  }
  async function acesso(p) {
    if (typeof p === 'string') p = (await pool.query('SELECT * FROM pessoas WHERE email=$1', [p])).rows[0] || { email: p };
    const semDados = { ...calcula(p, null), modulos: [], vistas: [], vinculo: null, dados: false };
    if (!(await temDados())) return semDados;
    try { const vinc = isAdmin(p.email) ? null : await le('gerentes', p.email); return { ...calcula(p, vinc), vinculo: vinc, dados: true }; }
    catch (e) { console.error('portal: falha ao ler o vínculo:', e.message); return semDados; }
  }
  // req.geral = administrador geral; req.admin = poderes de diretoria (escreve comunicados e metas, vê todas as lojas);
  // req.vinc = vínculo com a loja; quem só consulta todas as lojas entra como "leitor" sem loja
  const pauth = [auth, async (req, res, next) => {
    const a = await acesso(req.pessoa); req.acesso = a; req.geral = a.admin; req.admin = a.diretoria; req.lojas = a.lojas; req.modulos = a.modulos;
    req.vinc = a.diretoria || !a.modulos.length ? null : (a.vinculo || { loja: null, papel: 'leitor' });
    next();
  }];
  const soGeral = (req, res, next) => req.geral ? next() : res.status(403).json({ erro: 'Só o administrador geral pode fazer isso.' });
  // outras lojas: da análise fica só o que a comparação entre lojas usa (venda e vendedores por dia), sem produtos, pagamentos e horários
  const resumida = d => ({ loja: d.loja, mes: d.mes, fonte: d.fonte, atualizadoEm: d.atualizadoEm, resumida: true, vendedores: d.vendedores || {},
    dias: Object.fromEntries(Object.entries(d.dias || {}).map(([k, x]) => [k, { v: x.v, n: x.n, p: x.p, desc: x.desc, vend: x.vend || {} }])) });

  // ---------- página ----------
  let cache = null, mt0 = 0;
  app.get('/painel', auth, (req, res) => {
    const f = path.join(__dirname, 'portal', 'painel-lojas.html'), mt = fs.statSync(f).mtimeMs;
    if (!cache || mt !== mt0) { mt0 = mt; cache = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/portal-shim.js"></script>\n' + fs.readFileSync(f, 'utf8') + '\n</html>'; }
    res.set('Cache-Control', 'no-store').type('html').send(cache);
  });
  app.get('/portal-shim.js', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'portal-shim.js')));

  // ---------- tarefas que nascem de comunicado ----------
  const tarefasDoRecado = async id => (await pool.query('SELECT id, responsavel, status, prazo, concluida_em, atualizado_em FROM tarefas WHERE origem=$1', ['recado:' + id])).rows;
  const fmtData = v => v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  async function criaTarefasDoRecado(id, d, autor) {
    const ger = (await leCol('gerentes')).filter(g => g.data && (g.data.papel || 'gerente') === 'gerente' && (d.para === 'todas' || g.data.loja === d.para));
    let n = 0;
    for (const g of ger) {
      const email = String(g.id).toLowerCase();
      // gerente vinculado antes do primeiro acesso: entra na equipe para já receber a tarefa
      await pool.query(`INSERT INTO pessoas (email, nome, papel) VALUES ($1,$2,'membro') ON CONFLICT (email) DO NOTHING`, [email, email.split('@')[0]]);
      const p = await pool.query('SELECT ativo FROM pessoas WHERE email=$1', [email]); if (!p.rows[0] || !p.rows[0].ativo) continue;
      const r = await pool.query(`INSERT INTO tarefas (titulo, descricao, responsavel, criado_por, prioridade, status, prazo, origem)
        VALUES ($1,$2,$3,$4,3,'afazer',$5,$6) RETURNING id`, [d.titulo.slice(0, 160), `Comunicado da matriz:\n\n${d.texto}`.slice(0, 5000), email, autor, d.acao.prazo || null, 'recado:' + id]);
      await pool.query('INSERT INTO comentarios (tarefa_id, autor, tipo, texto) VALUES ($1,$2,$3,$4)', [r.rows[0].id, autor, 'evento', 'criou a tarefa a partir de um comunicado da matriz']);
      if (agenda) agenda.tarefa(r.rows[0].id);
      n++;
    }
    return n;
  }
  // junta, em cada comunicado com ação, o andamento por loja (diretoria) ou a própria tarefa (gerente)
  async function comAcompanhamento(docs, req) {
    const com = docs.filter(d => d.data && d.data.acao); if (!com.length) return docs;
    const [ger, ts] = await Promise.all([leCol('gerentes'), pool.query("SELECT id, responsavel, status, prazo, concluida_em, origem FROM tarefas WHERE origem LIKE 'recado:%'")]);
    const loja = Object.fromEntries(ger.map(g => [g.id, g.data && g.data.loja]));
    for (const d of com) {
      const meus = ts.rows.filter(t => t.origem === 'recado:' + d.id);
      const item = async t => ({ tarefa: t.id, email: t.responsavel, nome: await nomeDe(t.responsavel), loja: loja[t.responsavel] || null, status: t.status, prazo: fmtData(t.prazo), concluidaEm: t.concluida_em ? new Date(t.concluida_em).getTime() : null });
      d.data = { ...d.data, acomp: req.admin ? await Promise.all(meus.map(item)) : await Promise.all(meus.filter(t => t.responsavel === req.email).map(item)) };
    }
    return docs;
  }

  // ---------- API usada pela página (pelo shim) ----------
  app.get('/papi/me', pauth, (req, res) => res.json({ id: req.email, email: req.email, admin: req.admin, vinculo: req.vinc, nivel: req.acesso.nivel }));
  app.get('/papi/me/perfil', pauth, async (req, res) => res.json({ id: req.email, name: req.pessoa.nome || req.email, avatarUrl: req.pessoa.foto || '', canEdit: req.admin, verTodas: req.lojas === 'todas', vistas: req.acesso.vistas, nivel: req.acesso.nivel }));
  // leitura: a diretoria lê tudo; quem tem loja lê os totais de todas (comparação) e o detalhe só da sua; os demais, nada
  app.get('/papi/col/:col', pauth, async (req, res) => {
    const col = req.params.col; if (!COLS.has(col)) return res.status(404).json({ erro: 'coleção' });
    if (!req.admin && !req.vinc && col !== 'gerentes') return res.json({ docs: [], versao: 0 });
    const restrito = !req.admin && req.lojas !== 'todas', minha = id => req.lojas !== 'todas' && req.lojas.includes(String(id).split('_')[0]);
    let docs;
    // estoque e movimentação: só da própria loja (nem chegam a ser lidos os das outras)
    if (restrito && (col === 'estoque' || col === 'mov')) { docs = []; for (const id of req.lojas) { const r = await dpool.query('SELECT id, data, updated_at FROM docs WHERE col=$1 AND id=$2', [col, id]); if (r.rows[0]) docs.push(r.rows[0]); } }
    else docs = await leCol(col);
    if (!req.admin && !req.vinc) docs = docs.filter(d => d.id === req.email);
    if (restrito && col === 'analise') docs = docs.map(d => minha(d.id) ? d : { ...d, data: resumida(d.data || {}) });
    // comunicados: quem não é da diretoria só vê os da sua loja e os de todas as lojas; "ciente": cada um só vê o seu
    if (!req.admin && col === 'recados') docs = req.modulos.includes('pessoas') ? docs.filter(d => d.data && (d.data.para === 'todas' || d.data.para === req.vinc.loja)) : [];
    if (!req.admin && col === 'leituras') docs = docs.filter(d => d.data && d.data.email === req.email);
    // contexto dos vendedores (dados pessoais): só a diretoria e o gerente da própria loja
    if (!req.admin && col === 'equipe') docs = ehGerente(req) ? docs.filter(d => d.data && d.data.loja === req.vinc.loja) : [];
    if (col === 'recados') docs = await comAcompanhamento(docs, req);
    const versao = docs.reduce((m, d) => Math.max(m, new Date(d.updated_at).getTime()), 0);
    res.json({ docs: docs.map(d => ({ id: d.id, data: d.data })), versao });
  });
  // versões por coleção (o shim consulta a cada poucos minutos e só baixa o que mudou)
  app.get('/papi/versoes', pauth, async (req, res) => {
    const r = await dpool.query('SELECT col, max(updated_at) AS t, count(*) AS n FROM docs GROUP BY col');
    const o = Object.fromEntries(r.rows.map(x => [x.col, `${new Date(x.t).getTime()}:${+x.n}`]));
    // o andamento das tarefas de comunicado também conta como mudança nos comunicados
    const t = await pool.query("SELECT max(atualizado_em) AS t, count(*) AS n FROM tarefas WHERE origem LIKE 'recado:%'");
    if (t.rows[0] && +t.rows[0].n) o.recados = (o.recados || '0:0') + `:${new Date(t.rows[0].t).getTime()}:${+t.rows[0].n}`;
    res.json(o);
  });
  // escrita pela página: metas (diretoria ou gerente da própria loja); recados e vínculos (só diretoria)
  function podeEscrever(req, col, id, data) {
    if (req.admin) return ['metas', 'recados'].includes(col) || (col === 'gerentes' && req.geral); // vínculos: só o administrador geral
    if (col === 'metas' && ehGerente(req)) { const loja = (data && data.loja) || String(id).split('_')[0]; return loja === req.vinc.loja && String(id).startsWith(req.vinc.loja + '_'); }
    return false;
  }
  // "Ciente" de um comunicado: só a própria pessoa (id = <comunicado>|<e-mail>), só em comunicado da sua loja ou de todas.
  app.put('/papi/doc/leituras/:id', pauth, async (req, res) => {
    const id = String(req.params.id), i = id.lastIndexOf('|'), rec = id.slice(0, i), email = id.slice(i + 1);
    if (i < 1 || email !== req.email) return res.status(403).json({ erro: 'sem permissão' });
    const d = await le('recados', rec);
    if (!d) return res.status(404).json({ erro: 'comunicado não encontrado' });
    if (!req.admin && !(req.vinc && (d.para === 'todas' || d.para === req.vinc.loja))) return res.status(403).json({ erro: 'sem permissão' });
    const data = { recado: rec, email: req.email, nome: req.pessoa.nome || req.email, loja: req.vinc ? req.vinc.loja : null, papel: req.vinc ? (req.vinc.papel || 'gerente') : 'diretoria', em: Date.now() };
    await dpool.query('INSERT INTO docs(col,id,data) VALUES($1,$2,$3) ON CONFLICT (col,id) DO NOTHING', ['leituras', id, J(data)]);
    res.json({ ok: true });
  });
  // Contexto de um vendedor (id = <loja>|<código do vendedor>). Só a diretoria e o gerente da própria loja leem e escrevem.
  const EQ_CAMPOS = { nome: 80, idade: 20, desde: 40, funcao: 60, sobre: 1500, familia: 800, fortes: 800, atencao: 800, objetivo: 400 };
  app.put('/papi/doc/equipe/:id', pauth, express.json({ limit: '100kb' }), async (req, res) => {
    const id = String(req.params.id), i = id.indexOf('|'), loja = id.slice(0, i), vend = id.slice(i + 1);
    if (i < 1 || !vend || vend.length > 40) return res.status(400).json({ erro: 'vendedor inválido' });
    if (!req.admin && !(ehGerente(req) && req.vinc.loja === loja)) return res.status(403).json({ erro: 'sem permissão' });
    const b = req.body || {}, ant = (await le('equipe', id)) || {};
    const data = { loja, vend, atualizadoEm: Date.now(), por: req.email };
    for (const [k, max] of Object.entries(EQ_CAMPOS)) { const v = b[k] != null ? b[k] : ant[k]; if (v != null && String(v).trim()) data[k] = String(v).trim().slice(0, max); }
    let notas = Array.isArray(ant.notas) ? ant.notas : [];
    if (b.apagarNota != null) notas = notas.filter(n => !(n.em === +b.apagarNota && (req.admin || n.por === req.email)));
    const nova = String(b.novaNota || '').trim().slice(0, 800);
    if (nova) notas = notas.concat({ t: nova, por: req.email, nome: req.pessoa.nome || req.email, em: Date.now() }).slice(-200);
    data.notas = notas;
    await grava('equipe', id, data);
    res.json({ ok: true });
  });
  // Perfil (foto ou personagem) de uma pessoa: a própria pessoa ou a diretoria.
  const PERS_CHAVES = ['pele', 'cabelo', 'corCabelo', 'barba', 'oculos', 'boca', 'camisa', 'fundo', 'chapeu'];
  app.put('/papi/doc/perfis/:email', pauth, express.json({ limit: '400kb' }), async (req, res) => {
    const email = String(req.params.email).toLowerCase(), b = req.body || {};
    if (email !== req.email && !req.admin) return res.status(403).json({ erro: 'sem permissão' });
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ erro: 'e-mail inválido' });
    const data = { tipo: ['foto', 'personagem', 'google'].includes(b.tipo) ? b.tipo : 'google', atualizadoEm: Date.now(), por: req.email };
    const frase = String(b.frase || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (frase) data.frase = frase;
    if (data.tipo === 'foto') {
      const f = String(b.foto || '');
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f) || f.length > 300000) return res.status(400).json({ erro: 'foto inválida ou grande demais' });
      data.foto = f;
    }
    if (data.tipo === 'personagem') {
      const p = b.personagem && typeof b.personagem === 'object' ? b.personagem : {}; data.personagem = {};
      for (const k of PERS_CHAVES) if (p[k] != null) data.personagem[k] = String(p[k]).slice(0, 24);
    }
    await grava('perfis', email, data);
    res.json({ ok: true });
  });
  app.put('/papi/doc/:col/:id', pauth, express.json({ limit: '2mb' }), async (req, res) => {
    const { col, id } = req.params; if (!COLS.has(col) || !podeEscrever(req, col, id, req.body)) return res.status(403).json({ erro: 'sem permissão' });
    await grava(col, id, col === 'metas' ? { ...req.body, autor: req.email } : req.body);
    res.json({ ok: true });
  });
  const dataOk = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v));
  app.post('/papi/col/:col', pauth, express.json({ limit: '1mb' }), async (req, res) => {
    const col = req.params.col, id = crypto.randomUUID(); if (!COLS.has(col) || !podeEscrever(req, col, id, req.body)) return res.status(403).json({ erro: 'sem permissão' });
    let data = { ...req.body, autor: req.email }, tarefas = 0;
    if (col === 'recados') {
      const b = req.body || {}, titulo = String(b.titulo || '').trim().slice(0, 80), texto = String(b.texto || '').trim().slice(0, 1200), para = String(b.para || 'todas');
      if (!titulo || !texto) return res.status(400).json({ erro: 'Escreva o título e a mensagem.' });
      if (para !== 'todas' && !(await le('lojas', para))) return res.status(400).json({ erro: 'Loja não encontrada.' });
      data = { para, titulo, texto, criadoEm: Date.now(), autor: req.email };
      if (b.acao) {
        const prazo = b.acao.prazo ? String(b.acao.prazo) : null;
        if (prazo && (!dataOk(prazo) || prazo < hojeSP())) return res.status(400).json({ erro: 'O prazo da ação tem de ser hoje ou depois.' });
        data.acao = { prazo };
      }
    }
    await dpool.query('INSERT INTO docs(col,id,data) VALUES($1,$2,$3)', [col, id, J(data)]);
    if (col === 'recados' && data.acao) tarefas = await criaTarefasDoRecado(id, data, req.email);
    res.json({ id, tarefas });
  });
  app.delete('/papi/doc/:col/:id', pauth, async (req, res) => {
    const { col, id } = req.params; if (!COLS.has(col) || !req.admin || !['recados', 'gerentes'].includes(col) || (col === 'gerentes' && !req.geral)) return res.status(403).json({ erro: 'sem permissão' });
    await dpool.query('DELETE FROM docs WHERE col=$1 AND id=$2', [col, id]);
    if (col === 'recados') {
      for (const l of (await leCol('leituras')).filter(x => x.data && x.data.recado === id)) await dpool.query("DELETE FROM docs WHERE col='leituras' AND id=$1", [l.id]); // apaga junto quem marcou ciente
      // as tarefas que ninguém começou saem junto; as que já andaram ficam no histórico de quem fez
      for (const t of (await tarefasDoRecado(id)).filter(t => t.status === 'afazer')) {
        await pool.query('DELETE FROM comentarios WHERE tarefa_id=$1', [t.id]); await pool.query('DELETE FROM tarefa_participantes WHERE tarefa_id=$1', [t.id]); await pool.query('DELETE FROM tarefas WHERE id=$1', [t.id]);
        if (agenda) agenda.tarefa(t.id);
      }
    }
    res.json({ ok: true });
  });
  // "Lembrar quem não fez": sobe a prioridade e registra o lembrete nas tarefas ainda abertas do comunicado
  app.post('/papi/recados/:id/lembrar', pauth, async (req, res) => {
    if (!req.admin) return res.status(403).json({ erro: 'sem permissão' });
    const abertas = (await tarefasDoRecado(String(req.params.id))).filter(t => ['afazer', 'andamento'].includes(t.status));
    for (const t of abertas) {
      await pool.query('UPDATE tarefas SET prioridade=4, atualizado_em=now() WHERE id=$1', [t.id]);
      await pool.query('INSERT INTO comentarios (tarefa_id, autor, tipo, texto) VALUES ($1,$2,$3,$4)', [t.id, req.email, 'nota', 'Lembrete da matriz: esta ação ainda está pendente.']);
    }
    res.json({ ok: true, lembrados: abertas.length });
  });
  // pessoas: busca na equipe; um e-mail completo do domínio pode ser vinculado antes do primeiro acesso
  app.get('/papi/pessoas', pauth, async (req, res) => {
    if (!req.admin) return res.json([]);
    const q = String(req.query.q || '').trim().toLowerCase();
    const r = await pool.query('SELECT email, nome, foto, ultimo_acesso FROM pessoas WHERE ativo = true');
    const out = r.rows.filter(x => !q || x.email.toLowerCase().includes(q) || String(x.nome || '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.ultimo_acesso || 0) - new Date(a.ultimo_acesso || 0)).slice(0, 12)
      .map(x => ({ id: x.email, name: `${x.nome} (${x.email})`, avatarUrl: x.foto || '' }));
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(q) && q.endsWith('@' + dominio) && !out.some(x => x.id === q)) out.unshift({ id: q, name: q + ' (ainda não entrou)', avatarUrl: '' });
    res.json(out);
  });
  app.post('/papi/pessoas/perfis', pauth, express.json({ limit: '100kb' }), async (req, res) => {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 200);
    const r = await pool.query('SELECT email, nome, foto FROM pessoas'), mapa = new Map(r.rows.map(x => [x.email, x]));
    const o = {}; for (const id of ids) { const x = mapa.get(id); o[id] = { name: (x && x.nome) || id, avatarUrl: (x && x.foto) || '' }; }
    res.json(o);
  });

  // ---------- Admin → Pessoas e acessos (só o administrador geral) ----------
  app.get('/api/acessos', pauth, soGeral, async (req, res) => {
    const [ps, ger, lojas] = await Promise.all([pool.query('SELECT * FROM pessoas ORDER BY nome'), leCol('gerentes'), leCol('lojas')]);
    const vinc = new Map(ger.map(g => [g.id, g.data]));
    res.json({ dados: await temDados(),
      lojas: lojas.sort((a, b) => (a.data.ordem || 99) - (b.data.ordem || 99)).map(l => ({ id: l.id, nome: l.data.nome || l.id })),
      pessoas: ps.rows.map(p => {
        const v = vinc.get(p.email) || null, a = calcula(p, v);
        return { email: p.email, nome: p.nome, foto: p.foto || '', cargo: p.cargo || '', area: p.area || '', ativo: p.ativo, fixo: isAdmin(p.email), gestor: isAdmin(p.email) || p.papel === 'gestor',
          ultimoAcesso: p.ultimo_acesso ? new Date(p.ultimo_acesso).getTime() : null, nivel: a.nivel, modulos: a.modulos, loja: a.lojas === 'todas' ? 'todas' : (a.lojas[0] || null) };
      }) });
  });
  app.put('/api/acessos/:email', pauth, soGeral, express.json({ limit: '10kb' }), async (req, res) => {
    const email = String(req.params.email).toLowerCase(), b = req.body || {}, erro = m => res.status(400).json({ erro: m });
    const p = (await pool.query('SELECT * FROM pessoas WHERE email=$1', [email])).rows[0];
    if (!p) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
    if (isAdmin(email)) return erro('Este administrador é fixo (definido na configuração do sistema) e não pode ser alterado aqui.');
    const nivel = String(b.nivel || ''); if (!NIVEIS.includes(nivel)) return erro('Nível de acesso inválido.');
    let modulos = Array.isArray(b.modulos) ? MODULOS.filter(m => b.modulos.includes(m)) : null; // null = padrão do nível
    let loja = b.loja ? String(b.loja) : null;
    const lojasOk = new Set((await leCol('lojas')).map(l => l.id));
    if (nivel === 'gerente') { if (!loja || !lojasOk.has(loja)) return erro('Escolha a loja deste gerente.'); }
    else if (nivel === 'equipe') {
      if (modulos && modulos.length) { if (loja !== 'todas' && !lojasOk.has(loja)) return erro('Escolha de qual loja a pessoa vê os dados (ou todas as lojas).'); }
      else { modulos = []; loja = null; }
    } else loja = null; // administrador e diretoria: todas as lojas
    if (nivel === 'admin') modulos = null;
    const papel = nivel === 'admin' ? 'gestor' : b.gestor === undefined ? p.papel : (b.gestor ? 'gestor' : 'membro');
    const ativo = b.ativo === undefined ? p.ativo : !!b.ativo;
    if (email === req.email && (nivel !== 'admin' || !ativo)) return erro('Você não pode tirar o seu próprio acesso de administrador.');
    await pool.query('UPDATE pessoas SET nivel=$2, acesso_modulos=$3, acesso_lojas=$4, papel=$5, ativo=$6 WHERE email=$1', [email, nivel, modulos ? modulos.join(',') : null, loja === 'todas' ? 'todas' : null, papel, ativo]);
    // vínculo com a loja: gerente (cadastra metas, recebe as tarefas dos comunicados) ou leitor (só consulta)
    if (loja && loja !== 'todas') await grava('gerentes', email, { loja, papel: nivel === 'gerente' ? 'gerente' : 'leitor', vinculadoEm: Date.now(), por: req.email });
    else await dpool.query('DELETE FROM docs WHERE col=$1 AND id=$2', ['gerentes', email]);
    res.json({ ok: true });
  });

  // ---------- resumo para o Início (minha loja no mês, lojas abaixo do ritmo, comunicados sem ciente) ----------
  app.get('/papi/resumo', pauth, async (req, res) => {
    if (!req.admin && !req.vinc) return res.json({ acesso: false });
    const [lojas, vendas, metas, ger, recs, leit] = await Promise.all(['lojas', 'vendas', 'metas', 'gerentes', 'recados', 'leituras'].map(leCol));
    const meses = vendas.map(v => v.data && v.data.mes).filter(Boolean).sort(), mes = meses[meses.length - 1] || null;
    const soma = o => Object.values(o || {}).reduce((s, x) => s + (typeof x === 'number' ? x : (x && x.v) || 0), 0);
    const gerDe = id => ger.filter(g => g.data && g.data.loja === id && (g.data.papel || 'gerente') === 'gerente').map(g => g.id);
    const linhas = [];
    for (const l of lojas.sort((a, b) => ((a.data.ordem || 99) - (b.data.ordem || 99)))) {
      if (!req.modulos.includes('vendas') || (req.lojas !== 'todas' && !req.lojas.includes(l.id))) continue;
      const v = vendas.find(x => x.id === `${l.id}_${mes}`), m = metas.find(x => x.id === `${l.id}_${mes}`);
      if (!v) continue;
      const dias = Object.keys(v.data.dias || {}).filter(d => (v.data.dias[d].v || 0) > 0).sort(), ult = dias[dias.length - 1] || null;
      const vendido = soma(v.data.dias), meta = m ? +m.data.meta || 0 : 0;
      // ritmo: o que a meta diária pedia até o último dia com venda
      const esperado = m && ult ? Object.entries(m.data.metaDias || {}).filter(([d]) => d <= ult).reduce((s, [, x]) => s + (+x || 0), 0) : 0;
      linhas.push({ id: l.id, nome: l.data.nome || l.id, vendido, meta, esperado, ultimoDia: ult ? { dia: `${mes}-${ult}`, v: v.data.dias[ult].v || 0, meta: m ? +(m.data.metaDias || {})[ult] || 0 : 0 } : null, gerentes: gerDe(l.id) });
    }
    const meus = req.modulos.includes('pessoas') ? recs.filter(r => r.data && (req.admin || r.data.para === 'todas' || r.data.para === req.vinc.loja)) : [];
    const lidos = new Set(leit.filter(x => x.data && x.data.email === req.email).map(x => x.data.recado));
    const naoLidos = req.admin ? [] : meus.filter(r => !lidos.has(r.id)).sort((a, b) => b.data.criadoEm - a.data.criadoEm).slice(0, 5).map(r => ({ id: r.id, titulo: r.data.titulo, criadoEm: r.data.criadoEm, acao: !!r.data.acao }));
    res.json({ acesso: true, admin: req.admin, loja: req.vinc ? req.vinc.loja : null, mes, lojas: linhas, naoLidos });
  });

  // ---------- gravação pela tarefa diária (token) ----------
  const tokenOk = req => !!INGEST_TOKEN && iguais(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), INGEST_TOKEN);
  const exigeToken = (req, res, next) => tokenOk(req) ? next() : res.status(401).json({ erro: 'token' });
  app.post('/api/ingest', exigeToken, express.json({ limit: '60mb' }), async (req, res) => {
    const writes = Array.isArray(req.body && req.body.writes) ? req.body.writes : [];
    if (!writes.length || writes.length > 500) return res.status(400).json({ erro: 'writes: 1 a 500' });
    for (const w of writes) if (!w || typeof w !== 'object' || !COLS.has(w.collection) || !w.doc_id || !['set', 'update', 'delete'].includes(w.op)) return res.status(400).json({ erro: 'escrita inválida', w: { op: w && w.op, collection: w && w.collection, doc_id: w && w.doc_id } });
    const c = await dpool.connect();
    try {
      await c.query('BEGIN');
      for (const w of writes) {
        if (w.op === 'delete') await c.query('DELETE FROM docs WHERE col=$1 AND id=$2', [w.collection, w.doc_id]);
        else if (w.op === 'update') { const a = await c.query('SELECT data FROM docs WHERE col=$1 AND id=$2', [w.collection, w.doc_id]); await grava(w.collection, w.doc_id, { ...(a.rows[0] ? a.rows[0].data : {}), ...w.data }, c); }
        else await grava(w.collection, w.doc_id, w.data, c);
      }
      await c.query('COMMIT'); res.json({ ok: true, gravados: writes.length });
    } catch (e) { await c.query('ROLLBACK'); res.status(500).json({ erro: String(e.message || e) }); } finally { c.release(); }
  });
  app.get('/api/ingest/lista/:col', exigeToken, async (req, res) => {
    const r = await dpool.query('SELECT id, version, updated_at FROM docs WHERE col=$1 ORDER BY id', [req.params.col]);
    res.json(r.rows);
  });

  // ---------- carga para teste no computador: lê pastas <pasta>/<coleção>/<id>.json (a exportação da tarefa diária) ----------
  async function semeia(pastas) {
    let n = 0;
    for (const pasta of pastas) {
      if (!fs.existsSync(pasta)) continue;
      for (const col of fs.readdirSync(pasta)) {
        if (!COLS.has(col) || !fs.statSync(path.join(pasta, col)).isDirectory()) continue;
        for (const f of fs.readdirSync(path.join(pasta, col)).filter(x => x.endsWith('.json'))) {
          try { const data = JSON.parse(fs.readFileSync(path.join(pasta, col, f), 'utf8').replace(/^﻿/, '')); await grava(col, f.slice(0, -5), data); n++; } catch (e) { console.error('carga de teste: pulei', col, f, e.message); }
        }
      }
    }
    return n;
  }

  return { init, acesso, semeia, grava, le, importaDoPortal, situacao, estado };
};

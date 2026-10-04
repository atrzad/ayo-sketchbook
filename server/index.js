import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { db, lerPreferencias, gravarPreferencias } from './db.js';
import { autenticar, criarSessao, encerrarSessao, carregarSessao, bloqueado, falhou, limparFalhas } from './auth.js';
import * as cofre from './cofre.js';
import { ErroHttp } from './cofre.js';
import { indiceDe, invalidar, backlinks, tags, buscar, grafo, resolver } from './indice.js';
import { renderizar, hashLinha, RE_TAREFA, urlCaminho } from './markdown.js';
import { paginaEntrar, paginaApp } from './paginas.js';

process.umask(0o077);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Host desconhecido = possível DNS rebinding.
app.use((req, res, next) => {
  const bruto = String(req.headers.host || '').toLowerCase();
  const host = bruto.startsWith('[') ? bruto.slice(0, bruto.indexOf(']') + 1) : bruto.split(':')[0];
  if (!config.hosts.has(host)) return res.status(421).type('text').send('Host não permitido.');
  next();
});
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.get('/saude', (req, res) => res.json({ ok: true }));
app.use('/fonts', express.static(path.join(config.publicDir, 'fonts'), { immutable: true, maxAge: '365d', index: false }));
app.use(express.static(config.publicDir, { index: false, cacheControl: false, setHeaders: (r) => r.set('Cache-Control', 'no-cache') }));
app.use(carregarSessao);

// CSRF: escrita só da mesma origem e com cabeçalho próprio.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  const origem = req.headers.origin;
  if (origem) { let h = null; try { h = new URL(origem).host; } catch {} if (h !== req.headers.host) return res.status(403).json({ erro: 'Origem não permitida.' }); }
  if (req.headers['x-ayo'] !== '1') return res.status(403).json({ erro: 'Requisição inválida.' });
  next();
});
app.use('/api/anexo', express.raw({ type: ['image/*', 'application/pdf'], limit: '15mb' }));
app.use('/api/desenho', express.json({ limit: '12mb' }));
app.use('/api', express.json({ limit: '5mb' }));

// ---------- entrada ----------
app.get('/entrar', (req, res) => (req.usuario ? res.redirect(303, '/') : res.send(paginaEntrar({ ayoStd: config.ayoStdUrl }))));
app.post('/api/entrar', async (req, res) => {
  if (bloqueado(req.ip)) return res.status(429).json({ erro: 'Muitas tentativas. Tente de novo em 15 minutos.' });
  const { usuario, senha } = req.body ?? {};
  if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario || !senha) return res.status(400).json({ erro: 'Informe usuário e senha.' });
  const r = await autenticar(usuario, senha.slice(0, 200));
  if (r.erro) { if (r.erro.startsWith('Usuário')) falhou(req.ip); return res.status(401).json({ erro: r.erro }); }
  limparFalhas(req.ip);
  criarSessao(req, res, r.id);
  res.json({ ok: true });
});
app.post('/api/sair', (req, res) => { encerrarSessao(req, res); res.json({ ok: true }); });

// ---------- daqui para baixo, só com login ----------
app.use((req, res, next) => {
  if (req.usuario) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ erro: 'Sua sessão terminou. Entre de novo.' });
  res.redirect(303, '/entrar');
});

const relDe = (req) => (Array.isArray(req.params.caminho) ? req.params.caminho.join('/') : String(req.params.caminho || ''));
const shell = (req, res) => res.send(paginaApp({ usuario: req.usuario, ayoStd: config.ayoStdUrl, prefs: lerPreferencias(req.usuario.id) }));
app.get('/', shell);
app.get('/n/*caminho', shell);
app.get('/d/*caminho', shell);
app.get('/grafo', shell);

// Abre uma nota nova já com título/pasta/tags (atalho usado pelos botões "Anotar" do Ayo Std).
app.get('/nova', async (req, res) => {
  const u = req.usuario;
  const titulo = String(req.query.titulo || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || `Nota ${new Date().toLocaleDateString('sv-SE')}`;
  const pasta = String(req.query.pasta || '').split('/').map((p) => p.replace(/[\\:*?"<>|]/g, '').trim()).filter((p) => p && !p.startsWith('.')).join('/').slice(0, 150);
  const tagsQ = String(req.query.tags || '').split(',').map((t) => t.trim().replace(/[^\p{L}\p{N}_/-]/gu, '')).filter(Boolean).slice(0, 8);
  const fm = tagsQ.length ? `---\ntags: [${tagsQ.join(', ')}]\ndata: ${new Date().toLocaleDateString('sv-SE')}\n---\n` : '';
  const rel = await cofre.criarArquivo(u, `${pasta ? `${pasta}/` : ''}${titulo}.md`, `${fm}# ${titulo}\n\n`);
  invalidar(u);
  res.redirect(303, `/n/${urlCaminho(rel)}?editar=1`);
});

app.get('/arquivo/*caminho', async (req, res) => {
  const rel = relDe(req);
  const tipo = cofre.tipoDe(rel);
  if (tipo !== 'imagem' && tipo !== 'pdf') throw new ErroHttp(404, 'Arquivo não encontrado.');
  const abs = await cofre.caminhoSeguro(req.usuario, rel);
  if (tipo === 'pdf') res.removeHeader('Content-Security-Policy');
  else res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set('Cache-Control', 'private, no-cache');
  res.sendFile(abs, { dotfiles: 'deny', headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}` } });
});

// ---------- API do cofre ----------
const exigirTexto = (v, nome) => { if (typeof v !== 'string' || !v) throw new ErroHttp(400, `Informe ${nome}.`); return v; };

app.get('/api/arvore', async (req, res) => res.json({ arvore: await cofre.arvore(req.usuario) }));

app.get('/api/indice', async (req, res) => {
  const ind = await indiceDe(req.usuario);
  const notas = [];
  const arquivos = [];
  for (const e of ind.values()) (e.tipo === 'nota' ? notas : arquivos).push({ rel: e.rel, nome: e.nome, tipo: e.tipo, titulos: e.titulos?.map((t) => t.texto) || [] });
  res.json({ notas, arquivos, tags: tags(ind) });
});

app.get('/api/nota', async (req, res) => {
  const rel = exigirTexto(req.query.c, 'a nota');
  if (cofre.tipoDe(rel) !== 'nota') throw new ErroHttp(400, 'Isto não é uma nota.');
  res.json(await cofre.lerTexto(req.usuario, rel));
});

app.post('/api/nota', async (req, res) => {
  const { c, texto, hash } = req.body ?? {};
  if (cofre.tipoDe(exigirTexto(c, 'a nota')) !== 'nota') throw new ErroHttp(400, 'Isto não é uma nota.');
  const novo = await cofre.gravarTexto(req.usuario, c, texto, typeof hash === 'string' ? hash : undefined);
  res.json({ ok: true, hash: novo });
});

app.post('/api/render', async (req, res) => {
  const { c, texto } = req.body ?? {};
  if (typeof texto !== 'string') throw new ErroHttp(400, 'Texto ausente.');
  const r = renderizar(texto, { indice: await indiceDe(req.usuario), origem: typeof c === 'string' ? c : '' });
  res.json(r);
});

app.post('/api/criar', async (req, res) => {
  const u = req.usuario;
  const { c, tipo, conteudo } = req.body ?? {};
  exigirTexto(c, 'o nome');
  let rel = c;
  if (tipo === 'pasta') await cofre.criarPasta(u, c);
  else if (tipo === 'desenho') rel = await cofre.criarArquivo(u, c.toLowerCase().endsWith('.sketch.json') ? c : `${c}.sketch.json`, JSON.stringify({ v: 1, fundo: 'pautado', altura: 1400, tracos: [] }));
  else rel = await cofre.criarArquivo(u, c.toLowerCase().endsWith('.md') ? c : `${c}.md`, typeof conteudo === 'string' ? conteudo.slice(0, 100_000) : '');
  invalidar(u);
  res.json({ ok: true, c: rel });
});

app.post('/api/mover', async (req, res) => {
  const { de, para } = req.body ?? {};
  const r = await cofre.mover(req.usuario, exigirTexto(de, 'a origem'), exigirTexto(para, 'o destino'));
  invalidar(req.usuario);
  res.json({ ok: true, ...r });
});

app.post('/api/apagar', async (req, res) => {
  await cofre.apagar(req.usuario, exigirTexto(req.body?.c, 'o arquivo'));
  invalidar(req.usuario);
  res.json({ ok: true });
});

app.get('/api/busca', async (req, res) => res.json({ resultados: buscar(await indiceDe(req.usuario), String(req.query.q || '').slice(0, 200)) }));
app.get('/api/backlinks', async (req, res) => res.json({ backlinks: backlinks(await indiceDe(req.usuario), String(req.query.c || '')) }));
app.get('/api/grafo', async (req, res) => res.json(grafo(await indiceDe(req.usuario))));
app.get('/api/resolver', async (req, res) => res.json({ rel: resolver(await indiceDe(req.usuario), String(req.query.alvo || ''), String(req.query.origem || '')) }));

// Marca/desmarca tarefa direto no modo leitura (confere a linha pelo hash).
app.post('/api/tarefa', async (req, res) => {
  const u = req.usuario;
  const { c, linha, hash, marcado } = req.body ?? {};
  const { texto, hash: hashArquivo } = await cofre.lerTexto(u, exigirTexto(c, 'a nota'));
  const linhas = texto.split('\n');
  const n = Number(linha);
  if (!Number.isInteger(n) || n < 0 || n >= linhas.length || hashLinha(linhas[n]) !== hash || !RE_TAREFA.test(linhas[n].replace(/\r$/, ''))) {
    throw new ErroHttp(409, 'A nota mudou depois que a página abriu.');
  }
  linhas[n] = linhas[n].replace(RE_TAREFA, (_, a, _b, d) => a + (marcado ? 'x' : ' ') + d);
  const novo = await cofre.gravarTexto(u, c, linhas.join('\n'), hashArquivo);
  res.json({ ok: true, hash: novo, hashLinha: hashLinha(linhas[n]) });
});

// Nota do dia: Diário/AAAA-MM-DD.md, a partir de Modelos/Diária.md se existir.
app.post('/api/diaria', async (req, res) => {
  const u = req.usuario;
  const hoje = new Date().toLocaleDateString('sv-SE');
  const rel = `Diário/${hoje}.md`;
  if (!(await cofre.existe(u, rel))) {
    let modelo = `# ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n\n## Hoje\n\n- [ ] \n\n## Anotações\n\n`;
    try { modelo = (await cofre.lerTexto(u, 'Modelos/Diária.md')).texto.replaceAll('{{data}}', hoje); } catch {}
    await cofre.criarArquivo(u, rel, modelo);
    invalidar(u);
  }
  res.json({ ok: true, c: rel });
});

// Anexo colado/arrastado: vai para Anexos/ com nome único; devolve o caminho para o ![[embed]].
app.post('/api/anexo', async (req, res) => {
  const u = req.usuario;
  const tipos = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf' };
  const ext = tipos[String(req.headers['content-type']).split(';')[0]];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new ErroHttp(400, 'Envie uma imagem (PNG, JPG, GIF, WEBP) ou PDF.');
  const base = String(req.query.nome || '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    || `Colado ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
  const rel = await cofre.nomeLivre(u, `Anexos/${base}${ext}`);
  await cofre.gravarBinario(u, rel, req.body);
  invalidar(u);
  res.json({ ok: true, c: rel });
});

// ---------- desenhos (.sketch.json + prévia .sketch.png) ----------
app.get('/api/desenho', async (req, res) => {
  const rel = exigirTexto(req.query.c, 'o desenho');
  if (!cofre.ehDesenho(rel)) throw new ErroHttp(400, 'Isto não é um desenho.');
  const { texto, hash } = await cofre.lerTexto(req.usuario, rel);
  let desenho;
  try { desenho = JSON.parse(texto); } catch { throw new ErroHttp(422, 'O arquivo do desenho está corrompido.'); }
  res.json({ desenho, hash });
});

function validarDesenho(d) {
  if (!d || !Array.isArray(d.tracos) || d.tracos.length > 8000) throw new ErroHttp(400, 'Desenho inválido.');
  const fundo = ['pautado', 'quadriculado', 'pontilhado', 'liso'].includes(d.fundo) ? d.fundo : 'pautado';
  const altura = Math.min(1400 * 30, Math.max(1400, Math.round(Number(d.altura) || 1400)));
  const imagens = (Array.isArray(d.imagens) ? d.imagens : []).slice(0, 20).map((im) => {
    if (typeof im?.c !== 'string' || cofre.tipoDe(im.c) !== 'imagem') throw new ErroHttp(400, 'Imagem do desenho inválida.');
    return { c: im.c, x: Number(im.x) || 0, y: Number(im.y) || 0, w: Math.max(10, Number(im.w) || 500), h: Math.max(10, Number(im.h) || 500) };
  });
  const tracos = d.tracos.map((t) => {
    if (!t || !['caneta', 'marca', 'lapis'].includes(t.f) || !/^#[0-9a-f]{6}$/i.test(t.c) || !Array.isArray(t.p) || t.p.length % 3 || t.p.length > 30000) throw new ErroHttp(400, 'Desenho inválido.');
    return { f: t.f, c: t.c.toLowerCase(), w: Math.min(60, Math.max(0.5, Number(t.w) || 3)), p: t.p.map((n) => { const v = Number(n); if (!Number.isFinite(v)) throw new ErroHttp(400, 'Desenho inválido.'); return Math.round(v * 100) / 100; }) };
  });
  return { v: 1, fundo, altura, imagens, tracos };
}

app.post('/api/desenho', async (req, res) => {
  const u = req.usuario;
  const { c, desenho, png, hash } = req.body ?? {};
  if (!cofre.ehDesenho(exigirTexto(c, 'o desenho'))) throw new ErroHttp(400, 'Isto não é um desenho.');
  const json = JSON.stringify(validarDesenho(desenho));
  const novo = await cofre.gravarTexto(u, c, json, typeof hash === 'string' ? hash : undefined);
  if (typeof png === 'string' && png.startsWith('data:image/png;base64,')) {
    const buf = Buffer.from(png.slice(22), 'base64');
    if (buf.length < 10 * 1024 * 1024) await cofre.gravarBinario(u, c.replace(/\.sketch\.json$/i, '.sketch.png'), buf);
  }
  invalidar(u);
  res.json({ ok: true, hash: novo });
});

// ---------- preferências (painéis abertos, última nota, modo) ----------
app.get('/api/preferencias', (req, res) => res.json(lerPreferencias(req.usuario.id)));
app.post('/api/preferencias', (req, res) => {
  const p = req.body ?? {};
  const limpo = {
    ultima: typeof p.ultima === 'string' ? p.ultima.slice(0, 400) : undefined,
    modo: ['editar', 'ler', 'dividir'].includes(p.modo) ? p.modo : undefined,
    esquerda: typeof p.esquerda === 'boolean' ? p.esquerda : undefined,
    direita: typeof p.direita === 'boolean' ? p.direita : undefined,
    abertas: Array.isArray(p.abertas) ? p.abertas.filter((x) => typeof x === 'string').slice(0, 200) : undefined,
  };
  gravarPreferencias(req.usuario.id, { ...lerPreferencias(req.usuario.id), ...Object.fromEntries(Object.entries(limpo).filter(([, v]) => v !== undefined)) });
  res.json({ ok: true });
});

// ---------- erros ----------
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((req, res) => res.status(404).type('text').send('Página não encontrada.'));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err instanceof ErroHttp ? err.status : err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500;
  if (err.code === 'ENOENT') status = 404;
  if (status === 500) console.error('[erro]', req.method, req.originalUrl, err);
  const msg = status === 500 ? 'Erro interno. Nada foi gravado pela metade.' : status === 413 && !(err instanceof ErroHttp) ? 'Arquivo grande demais.' : err.message;
  if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ erro: msg });
  res.status(status).type('text').send(msg);
});

const servidor = app.listen(config.porta, config.host, () => console.log(`[sketchbook] ouvindo em http://${config.host}:${config.porta} · dados em ${config.dataDir}`));
const desligar = () => servidor.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', desligar);
process.on('SIGINT', desligar);
process.on('uncaughtException', (e) => { console.error('[fatal]', e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[fatal]', e); process.exit(1); });

// Índice do cofre: nomes, links, tags, títulos e texto de cada nota (relido só quando o arquivo muda).
// Dá conta de: resolver [[links]], backlinks, lista de tags, busca e grafo.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { listarArquivos, caminhoSeguro, tipoDe } from './cofre.js';

const caches = new Map(); // usuarioId -> Map(rel -> entrada)

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RE_LINK = /(!?)\[\[([^\]|#^\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const RE_TAG = /(^|[\s(])#([\p{L}][\p{L}\p{N}_/-]{0,60})/gu;
const RE_CERCA = /^\s*(```|~~~)/;

export function lerFrontmatter(texto) {
  if (!texto.startsWith('---\n') && !texto.startsWith('---\r\n')) return { props: {}, fim: 0 };
  const fim = texto.indexOf('\n---', 4);
  if (fim < 0) return { props: {}, fim: 0 };
  const props = {};
  let chave = null;
  for (const linha of texto.slice(4, fim).split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(linha);
    if (m) {
      chave = m[1];
      let v = m[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      else v = v.replace(/^["']|["']$/g, '');
      props[chave] = v === '' ? [] : v;
    } else if (chave && /^\s*-\s+/.test(linha)) {
      if (!Array.isArray(props[chave])) props[chave] = props[chave] ? [props[chave]] : [];
      props[chave].push(linha.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
    }
  }
  const finalLinha = texto.indexOf('\n', fim + 1);
  return { props, fim: finalLinha < 0 ? texto.length : finalLinha + 1 };
}

function analisar(rel, texto) {
  const { props, fim } = lerFrontmatter(texto);
  const corpo = texto.slice(fim);
  const links = [];
  const tags = new Set();
  const titulos = [];
  let cerca = false;
  for (const linha of corpo.split('\n')) {
    if (RE_CERCA.test(linha)) { cerca = !cerca; continue; }
    if (cerca) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(linha);
    if (h) titulos.push({ nivel: h[1].length, texto: h[2] });
    const semCodigo = linha.replace(/`[^`]*`/g, '');
    for (const m of semCodigo.matchAll(RE_LINK)) links.push({ alvo: m[2].trim(), embed: m[1] === '!' });
    for (const m of semCodigo.matchAll(RE_TAG)) tags.add(m[2]);
  }
  const tagsProps = props.tags ? (Array.isArray(props.tags) ? props.tags : [props.tags]) : [];
  for (const t of tagsProps) tags.add(String(t).replace(/^#/, ''));
  return { rel, nome: path.posix.basename(rel, '.md'), props, links, tags: [...tags], titulos, texto, textoBusca: semAcento(texto) };
}

export async function indiceDe(u) {
  let cache = caches.get(u.id);
  if (!cache) { cache = new Map(); caches.set(u.id, cache); }
  const arquivos = await listarArquivos(u);
  const vistos = new Set();
  for (const rel of arquivos) {
    vistos.add(rel);
    if (tipoDe(rel) !== 'nota') {
      if (!cache.has(rel)) cache.set(rel, { rel, tipo: tipoDe(rel), nome: path.posix.basename(rel) });
      continue;
    }
    const abs = await caminhoSeguro(u, rel);
    const st = await fsp.stat(abs);
    const atual = cache.get(rel);
    if (atual && atual.mtime === st.mtimeMs && atual.tamanho === st.size) continue;
    if (st.size > 5 * 1024 * 1024) continue;
    const texto = await fsp.readFile(abs, 'utf8');
    cache.set(rel, { ...analisar(rel, texto), tipo: 'nota', mtime: st.mtimeMs, tamanho: st.size });
  }
  for (const rel of cache.keys()) if (!vistos.has(rel)) cache.delete(rel);
  return cache;
}

export const invalidar = (u) => caches.delete(u.id);

// [[Nome]], [[Pasta/Nome]], [[Nome.md]], anexos pelo nome do arquivo: igual ao Obsidian, o caminho mais curto ganha.
export function resolver(indice, alvo, origem = '') {
  const a = alvo.trim().replace(/\\/g, '/');
  const comExt = /\.(md|png|jpe?g|gif|webp|pdf|json)$/i.test(a) ? a : `${a}.md`;
  const baixo = comExt.toLowerCase();
  const pasta = origem.includes('/') ? origem.slice(0, origem.lastIndexOf('/') + 1) : '';
  const candidatos = [];
  for (const rel of indice.keys()) {
    const r = rel.toLowerCase();
    if (r === baixo || r === (pasta + comExt).toLowerCase()) return rel;
    if (r.endsWith(`/${baixo}`) || r === baixo || path.posix.basename(r) === baixo) candidatos.push(rel);
  }
  return candidatos.sort((x, y) => x.length - y.length)[0] || null;
}

export function backlinks(indice, rel) {
  const saida = [];
  for (const e of indice.values()) {
    if (e.tipo !== 'nota' || e.rel === rel) continue;
    const linhas = [];
    for (const l of e.links) if (resolver(indice, l.alvo, e.rel) === rel) linhas.push(l.alvo);
    if (linhas.length) {
      const nomeAlvo = path.posix.basename(rel, '.md').toLowerCase();
      const trecho = e.texto.split('\n').find((l) => l.toLowerCase().includes(`[[${nomeAlvo}`) || l.toLowerCase().includes(`[[${rel.slice(0, -3).toLowerCase()}`)) || '';
      saida.push({ rel: e.rel, nome: e.nome, trecho: trecho.trim().slice(0, 200) });
    }
  }
  return saida.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function tags(indice) {
  const contagem = new Map();
  for (const e of indice.values()) if (e.tipo === 'nota') for (const t of e.tags) contagem.set(t, (contagem.get(t) || 0) + 1);
  return [...contagem].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'pt-BR'));
}

export function buscar(indice, consulta, limite = 60) {
  const q = semAcento(String(consulta || '').trim());
  if (!q) return [];
  const tagBusca = q.startsWith('tag:') ? q.slice(4).replace(/^#/, '') : null;
  const saida = [];
  for (const e of indice.values()) {
    if (e.tipo !== 'nota') continue;
    if (tagBusca) {
      if (e.tags.some((t) => semAcento(t) === tagBusca || semAcento(t).startsWith(`${tagBusca}/`))) saida.push({ rel: e.rel, nome: e.nome, trechos: [] });
      continue;
    }
    const noNome = semAcento(e.nome).includes(q);
    const trechos = [];
    let pos = e.textoBusca.indexOf(q);
    while (pos >= 0 && trechos.length < 3) {
      const ini = Math.max(0, pos - 50);
      trechos.push({ antes: e.texto.slice(ini, pos).replace(/\s+/g, ' '), achado: e.texto.slice(pos, pos + q.length), depois: e.texto.slice(pos + q.length, pos + q.length + 70).replace(/\s+/g, ' ') });
      pos = e.textoBusca.indexOf(q, pos + q.length);
    }
    if (noNome || trechos.length) saida.push({ rel: e.rel, nome: e.nome, noNome, trechos });
  }
  return saida.sort((a, b) => (b.noNome - a.noNome) || a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, limite);
}

export function grafo(indice) {
  const nos = [];
  const arestas = [];
  const fantasmas = new Map();
  for (const e of indice.values()) if (e.tipo === 'nota') nos.push({ id: e.rel, nome: e.nome, tags: e.tags.length });
  for (const e of indice.values()) {
    if (e.tipo !== 'nota') continue;
    for (const l of e.links) {
      if (l.embed) continue;
      const alvo = resolver(indice, l.alvo, e.rel);
      if (alvo && indice.get(alvo)?.tipo === 'nota') arestas.push([e.rel, alvo]);
      else if (!alvo) {
        const id = `?${l.alvo}`;
        if (!fantasmas.has(id)) fantasmas.set(id, { id, nome: l.alvo, fantasma: true });
        arestas.push([e.rel, id]);
      }
    }
  }
  return { nos: [...nos, ...fantasmas.values()], arestas };
}

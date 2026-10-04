// Markdown com o sabor do Obsidian: [[links]], ![[embeds]], #tags, ==destaque==, callouts, tarefas e propriedades.
// html: false → HTML cru das notas aparece como texto (nenhuma nota injeta código na página).
import crypto from 'node:crypto';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { resolver, lerFrontmatter } from './indice.js';
import { EXT_IMAGEM } from './cofre.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const urlCaminho = (rel) => rel.split('/').map(encodeURIComponent).join('/');
export const hashLinha = (l) => crypto.createHash('sha1').update(l.replace(/\r$/, '')).digest('hex').slice(0, 12);
const RE_TAREFA = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\][ \t]+)(?=\S)/;
export { RE_TAREFA };

const slug = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'secao';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });

// ![[embed]] e [[link]]
md.inline.ruler.before('link', 'wiki', (state, silencioso) => {
  const src = state.src;
  let pos = state.pos;
  const embed = src.charCodeAt(pos) === 0x21;
  if (embed) pos++;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const fim = src.indexOf(']]', pos + 2);
  if (fim < 0) return false;
  const corpo = src.slice(pos + 2, fim);
  if (!corpo || corpo.length > 300 || corpo.includes('\n')) return false;
  if (!silencioso) {
    const [alvoBruto, apelido] = corpo.split('|');
    const [alvo, ancora] = alvoBruto.split('#');
    const tok = state.push(embed ? 'wiki_embed' : 'wiki_link', '', 0);
    tok.meta = { alvo: alvo.trim(), ancora: ancora?.trim() || '', apelido: apelido?.trim() || '' };
  }
  state.pos = fim + 2;
  return true;
});

md.renderer.rules.wiki_link = (tokens, i, _o, env) => {
  const { alvo, ancora, apelido } = tokens[i].meta;
  const texto = apelido || (ancora ? `${alvo} › ${ancora}` : alvo);
  if (!alvo && ancora) return `<a class="wikilink" href="#${slug(ancora)}">${esc(texto)}</a>`;
  const rel = env.indice ? resolver(env.indice, alvo, env.origem) : null;
  if (!rel) return `<a class="wikilink nao-existe" href="#" data-criar="${esc(alvo)}" title="Nota ainda não existe: clique para criar">${esc(texto)}</a>`;
  return `<a class="wikilink" href="/n/${urlCaminho(rel)}${ancora ? `#${slug(ancora)}` : ''}" data-nota="${esc(rel)}">${esc(texto)}</a>`;
};

md.renderer.rules.wiki_embed = (tokens, i, _o, env) => {
  const { alvo, apelido } = tokens[i].meta;
  const rel = env.indice ? resolver(env.indice, alvo, env.origem) : null;
  if (!rel) return `<span class="embed-faltando">${esc(alvo)} (não encontrado)</span>`;
  const r = rel.toLowerCase();
  // desenho: a prévia .sketch.png (que o Obsidian também mostra) + abrir no editor de caneta
  if (r.endsWith('.sketch.json') || r.endsWith('.sketch.png')) {
    const json = rel.replace(/\.sketch\.png$/i, '.sketch.json');
    const png = rel.replace(/\.sketch\.json$/i, '.sketch.png');
    const temPng = env.indice.has(png);
    return `<figure class="desenho-embed" data-desenho="${esc(json)}">${temPng ? `<img src="/arquivo/${urlCaminho(png)}?v=${env.indice.get(png)?.mtime || ''}" alt="Desenho ${esc(path.posix.basename(json, '.sketch.json'))}" loading="lazy">` : '<span class="vazio">Desenho sem prévia ainda</span>'}<figcaption><a href="/d/${urlCaminho(json)}">✎ ${esc(path.posix.basename(json, '.sketch.json'))}</a></figcaption></figure>`;
  }
  if (EXT_IMAGEM.has(path.extname(r))) {
    const largura = /^\d{1,4}$/.test(apelido) ? ` width="${apelido}"` : '';
    return `<img class="embed-imagem" src="/arquivo/${urlCaminho(rel)}" alt="${esc(apelido && !largura ? apelido : path.posix.basename(rel))}"${largura} loading="lazy">`;
  }
  if (r.endsWith('.pdf')) return `<a class="embed-pdf" href="/arquivo/${urlCaminho(rel)}" target="_blank" rel="noopener">📄 ${esc(path.posix.basename(rel))}</a>`;
  if (r.endsWith('.md')) {
    // transclusão de nota (um nível só, para não entrar em laço)
    if ((env.profundidade || 0) >= 1) return `<a class="wikilink" href="/n/${urlCaminho(rel)}">${esc(alvo)}</a>`;
    const e = env.indice.get(rel);
    const corpo = e ? e.texto.slice(lerFrontmatter(e.texto).fim) : '';
    const html = md.render(corpo, { ...env, origem: rel, profundidade: 1, linhas: null, toc: [] });
    return `<div class="embed-nota"><a class="embed-titulo" href="/n/${urlCaminho(rel)}">${esc(path.posix.basename(rel, '.md'))}</a>${html}</div>`;
  }
  return esc(alvo);
};

// #tag
md.inline.ruler.push('tag', (state, silencioso) => {
  if (state.src.charCodeAt(state.pos) !== 0x23) return false;
  if (state.pos > 0 && !/[\s(]/.test(state.src[state.pos - 1])) return false;
  const m = /^#([\p{L}][\p{L}\p{N}_/-]{0,60})/u.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silencioso) state.push('tag', '', 0).content = m[1];
  state.pos += m[0].length;
  return true;
});
md.renderer.rules.tag = (t, i) => `<a class="tag" href="#" data-tag="${esc(t[i].content)}">#${esc(t[i].content)}</a>`;

// ==destaque==
md.inline.ruler.before('emphasis', 'destaque', (state, silencioso) => {
  if (state.src.charCodeAt(state.pos) !== 0x3d || state.src.charCodeAt(state.pos + 1) !== 0x3d) return false;
  const fim = state.src.indexOf('==', state.pos + 2);
  if (fim < 0 || fim === state.pos + 2) return false;
  if (!silencioso) state.push('destaque', '', 0).content = state.src.slice(state.pos + 2, fim);
  state.pos = fim + 2;
  return true;
});
md.renderer.rules.destaque = (t, i) => `<mark>${esc(t[i].content)}</mark>`;

// títulos com âncora, tarefas clicáveis (pela linha + hash) e callouts
md.core.ruler.push('ayo', (state) => {
  const { tokens, env } = state;
  const usados = new Set();
  env.toc = env.toc || [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'heading_open') {
      const texto = tokens[i + 1].children.map((c) => c.content || c.meta?.alvo || '').join('');
      let id = slug(texto);
      for (let n = 2; usados.has(id); n++) id = `${slug(texto)}-${n}`;
      usados.add(id);
      tok.attrSet('id', id);
      if (!env.profundidade) env.toc.push({ nivel: Number(tok.tag.slice(1)), texto, id });
    }
    if (tok.type === 'inline' && tokens[i - 1]?.type === 'paragraph_open' && tokens[i - 2]?.type === 'list_item_open') {
      const m = /^\[([ xX])\][ \t]+/.exec(tok.content);
      const primeiro = tok.children[0];
      if (m && primeiro?.type === 'text' && primeiro.content.startsWith(m[0])) {
        const item = tokens[i - 2];
        const linha = item.map ? item.map[0] + (env.desvio || 0) : -1;
        const fonte = env.linhas?.[linha] ?? '';
        const valida = !env.profundidade && linha >= 0 && RE_TAREFA.test(fonte.replace(/\r$/, ''));
        const feito = m[1] !== ' ';
        primeiro.content = primeiro.content.slice(m[0].length);
        const abre = new state.Token('html_inline', '', 0);
        abre.content = `<label class="tarefa"><input type="checkbox" class="cb"${feito ? ' checked' : ''}${valida ? ` data-linha="${linha}" data-hash="${hashLinha(fonte)}"` : ' disabled'}><span class="tarefa-txt">`;
        const fecha = new state.Token('html_inline', '', 0);
        fecha.content = '</span></label>';
        tok.children.unshift(abre);
        tok.children.push(fecha);
        item.attrJoin('class', feito ? 'item-tarefa feito' : 'item-tarefa');
      }
    }
    if (tok.type === 'blockquote_open' && tokens[i + 1]?.type === 'paragraph_open' && tokens[i + 2]?.type === 'inline') {
      const inline = tokens[i + 2];
      const p = inline.children[0];
      const m = p?.type === 'text' ? /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(p.content) : null;
      if (m) {
        tok.attrJoin('class', `callout callout-${slug(m[1])}`);
        const t = new state.Token('html_inline', '', 0);
        t.content = `<span class="callout-titulo">${esc(m[2] || m[1])}</span>`;
        inline.children.splice(0, 1, t);
        if (inline.children[1]?.type === 'softbreak') inline.children.splice(1, 1);
      }
    }
  }
});

md.renderer.rules.link_open = (tokens, i, opcoes, env, self) => {
  const tok = tokens[i];
  const href = tok.attrGet('href') || '';
  if (/^https?:/i.test(href)) { tok.attrSet('target', '_blank'); tok.attrSet('rel', 'noopener noreferrer'); tok.attrJoin('class', 'externo'); }
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#') && env.indice) {
    let alvo;
    try { alvo = decodeURIComponent(href.split('#')[0]); } catch { alvo = href; }
    const rel = resolver(env.indice, alvo, env.origem);
    if (rel) tok.attrSet('href', rel.toLowerCase().endsWith('.md') ? `/n/${urlCaminho(rel)}` : `/arquivo/${urlCaminho(rel)}`);
  }
  return self.renderToken(tokens, i, opcoes);
};
md.renderer.rules.table_open = () => '<div class="tabela"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

export function renderizar(texto, { indice, origem }) {
  const { props, fim } = lerFrontmatter(texto);
  const linhas = texto.split('\n');
  const desvio = texto.slice(0, fim).split('\n').length - 1;
  const env = { indice, origem, linhas, desvio, toc: [] };
  const html = md.render(texto.slice(fim), env);
  return { html, toc: env.toc, props };
}

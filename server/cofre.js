// Cofre de cada pessoa: uma pasta de arquivos (.md, desenhos .sketch.json, anexos), no formato que o Obsidian abre.
// Todo caminho passa por caminhoSeguro: nada sai da pasta do cofre, nada oculto (.obsidian, .lixeira) é exposto.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

export class ErroHttp extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export const EXT_IMAGEM = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const EXT_PERMITIDAS = new Set(['.md', '.pdf', ...EXT_IMAGEM]);
export const ehDesenho = (rel) => rel.toLowerCase().endsWith('.sketch.json');
export const tipoDe = (rel) => {
  const r = rel.toLowerCase();
  if (r.endsWith('.sketch.json')) return 'desenho';
  if (r.endsWith('.md')) return 'nota';
  if (r.endsWith('.pdf')) return 'pdf';
  if (EXT_IMAGEM.has(path.extname(r))) return 'imagem';
  return null;
};

const BOAS_VINDAS = `# Bem-vindo ao Ayo Sketchbook

Este é o seu cofre. Cada nota é um arquivo Markdown, e o Obsidian abre esta mesma pasta.

## Atalhos

- **Ctrl+O**: abrir nota pelo nome
- **Ctrl+P**: paleta de comandos
- **Ctrl+N**: nova nota
- **Ctrl+E**: alternar entre editar e ler
- **Ctrl+Shift+F**: buscar em todo o cofre

## Para experimentar

- [ ] Criar uma nota e ligar a outra com \`[[nome da nota]]\`
- [ ] Usar #tags e ver a lista de tags na lateral
- [ ] Abrir a **nota do dia**
- [ ] Desenhar com a caneta: botão **Novo desenho**
- [ ] Abrir o **grafo** e ver as notas ligadas

> [!tip] Caneta
> Com S Pen, Apple Pencil ou mesa digitalizadora, o traço segue a pressão. O dedo rola a página.
`;

export async function raizDe(u) {
  const raiz = u.dono && config.cofreDono ? config.cofreDono : path.join(config.dataDir, 'cofres', `u${u.id}`);
  if (!fs.existsSync(raiz)) {
    await fsp.mkdir(raiz, { recursive: true, mode: 0o700 });
    await fsp.writeFile(path.join(raiz, 'Bem-vindo.md'), BOAS_VINDAS);
  }
  return fsp.realpath(raiz);
}

function validarRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400) throw new ErroHttp(400, 'Caminho inválido.');
  const partes = rel.split('/');
  if (partes.some((p) => !p || p === '.' || p === '..' || p.startsWith('.') || p.length > 150 || /[\\\0<>:"|?*\u0000-\u001f]/.test(p))) {
    throw new ErroHttp(400, 'Nome inválido. Evite / \\ : * ? " < > | e nomes começando com ponto.');
  }
  return partes;
}

// Caminho já existente dentro do cofre (segue links simbólicos só se continuarem dentro).
export async function caminhoSeguro(u, rel) {
  const partes = validarRel(rel);
  const raiz = await raizDe(u);
  let real;
  try { real = await fsp.realpath(path.join(raiz, ...partes)); } catch { throw new ErroHttp(404, 'Arquivo não encontrado.'); }
  if (!real.startsWith(raiz + path.sep)) throw new ErroHttp(403, 'Fora do cofre.');
  return real;
}

// Caminho novo: a pasta-mãe precisa existir dentro do cofre.
async function caminhoNovo(u, rel, { criarPastas = true } = {}) {
  const partes = validarRel(rel);
  const raiz = await raizDe(u);
  const destino = path.join(raiz, ...partes);
  const mae = path.dirname(destino);
  if (criarPastas) await fsp.mkdir(mae, { recursive: true, mode: 0o700 });
  const maeReal = await fsp.realpath(mae);
  if (maeReal !== raiz && !maeReal.startsWith(raiz + path.sep)) throw new ErroHttp(403, 'Fora do cofre.');
  return path.join(maeReal, path.basename(destino));
}

const hashTexto = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);

async function gravarAtomico(abs, dados) {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fh = await fsp.open(tmp, 'wx', 0o600);
  try { await fh.writeFile(dados); await fh.sync(); } finally { await fh.close(); }
  try {
    try { const st = await fsp.stat(abs); await fsp.chmod(tmp, st.mode & 0o777); } catch {}
    await fsp.rename(tmp, abs);
  } catch (e) { await fsp.rm(tmp, { force: true }); throw e; }
}

const travas = new Map();
function comTrava(chave, fn) {
  const ant = travas.get(chave) || Promise.resolve();
  const atual = ant.then(fn);
  const guarda = atual.catch(() => {});
  travas.set(chave, guarda);
  guarda.then(() => { if (travas.get(chave) === guarda) travas.delete(chave); });
  return atual;
}

// ---------- leitura ----------

export async function arvore(u) {
  const raiz = await raizDe(u);
  async function andar(dir, rel, nivel) {
    let itens;
    try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
    const saida = [];
    for (const it of itens) {
      if (it.name.startsWith('.') || it.name === 'node_modules') continue;
      const r = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (nivel < 12) saida.push({ nome: it.name, caminho: r, tipo: 'pasta', filhos: await andar(path.join(dir, it.name), r, nivel + 1) });
      } else if (it.isFile()) {
        const tipo = tipoDe(r);
        // a imagem .sketch.png é a prévia de um desenho: some da árvore (o desenho aparece no lugar)
        if (tipo && !r.toLowerCase().endsWith('.sketch.png')) saida.push({ nome: it.name, caminho: r, tipo });
      }
    }
    return saida.sort((a, b) => (a.tipo === 'pasta') - (b.tipo === 'pasta') ? (a.tipo === 'pasta' ? -1 : 1) : a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
  }
  return andar(raiz, '', 0);
}

export async function lerTexto(u, rel) {
  const abs = await caminhoSeguro(u, rel);
  const st = await fsp.stat(abs);
  if (st.size > 5 * 1024 * 1024) throw new ErroHttp(413, 'Arquivo grande demais para abrir aqui.');
  const texto = await fsp.readFile(abs, 'utf8');
  return { texto, hash: hashTexto(texto), mtime: st.mtimeMs };
}

// ---------- escrita ----------

// hashAnterior: o que o editor tinha ao abrir. Se o arquivo mudou (Obsidian, outra aba), recusa com 409.
export async function gravarTexto(u, rel, texto, hashAnterior) {
  if (!rel.toLowerCase().endsWith('.md') && !ehDesenho(rel)) throw new ErroHttp(400, 'Só notas e desenhos são editados aqui.');
  if (typeof texto !== 'string' || texto.length > 4 * 1024 * 1024) throw new ErroHttp(413, 'Conteúdo grande demais.');
  const abs = await caminhoNovo(u, rel);
  return comTrava(abs, async () => {
    if (fs.existsSync(abs) && hashAnterior !== undefined) {
      const atual = await fsp.readFile(abs, 'utf8');
      if (hashTexto(atual) !== hashAnterior) throw new ErroHttp(409, 'Esta nota mudou em outro lugar (outra aba ou o Obsidian).');
    }
    await gravarAtomico(abs, texto);
    return hashTexto(texto);
  });
}

export async function gravarBinario(u, rel, buffer) {
  const t = tipoDe(rel);
  if (t !== 'imagem' && t !== 'pdf') throw new ErroHttp(400, 'Tipo de anexo não aceito.');
  const abs = await caminhoNovo(u, rel);
  await comTrava(abs, () => gravarAtomico(abs, buffer));
}

export async function existe(u, rel) {
  try { await caminhoSeguro(u, rel); return true; } catch { return false; }
}

// Nome livre: "Nota.md", "Nota 1.md", "Nota 2.md"…
export async function nomeLivre(u, rel) {
  if (!(await existe(u, rel))) return rel;
  const m = /^(.*?)(\.sketch\.json|\.[^./]+)?$/.exec(rel);
  for (let i = 1; i < 1000; i++) {
    const tent = `${m[1]} ${i}${m[2] || ''}`;
    if (!(await existe(u, tent))) return tent;
  }
  throw new ErroHttp(409, 'Não foi possível achar um nome livre.');
}

export async function criarPasta(u, rel) {
  const abs = await caminhoNovo(u, rel);
  if (fs.existsSync(abs)) throw new ErroHttp(409, 'Já existe algo com esse nome.');
  await fsp.mkdir(abs, { mode: 0o700 });
}

export async function criarArquivo(u, rel, conteudo = '') {
  const tipo = tipoDe(rel);
  if (tipo !== 'nota' && tipo !== 'desenho') throw new ErroHttp(400, 'Crie notas (.md) ou desenhos.');
  const livre = await nomeLivre(u, rel);
  const abs = await caminhoNovo(u, livre);
  await fsp.writeFile(abs, conteudo, { flag: 'wx', mode: 0o600 });
  return livre;
}

const escaparRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Renomear/mover. Notas renomeadas têm os [[links]] atualizados em todo o cofre, como no Obsidian.
export async function mover(u, de, para) {
  const origem = await caminhoSeguro(u, de);
  if (tipoDe(de) !== tipoDe(para) && !(fs.statSync(origem).isDirectory())) throw new ErroHttp(400, 'Mantenha a extensão do arquivo.');
  const destino = await caminhoNovo(u, para);
  if (fs.existsSync(destino)) throw new ErroHttp(409, 'Já existe algo com esse nome no destino.');
  await fsp.rename(origem, destino);
  // desenho leva junto a prévia .sketch.png
  if (ehDesenho(de)) {
    const png = origem.replace(/\.sketch\.json$/i, '.sketch.png');
    if (fs.existsSync(png)) await fsp.rename(png, destino.replace(/\.sketch\.json$/i, '.sketch.png'));
  }
  let atualizadas = 0;
  if (de.toLowerCase().endsWith('.md') && para.toLowerCase().endsWith('.md')) {
    const antigo = path.posix.basename(de, '.md');
    const novo = path.posix.basename(para, '.md');
    const semExtAntigo = de.slice(0, -3);
    const semExtNovo = para.slice(0, -3);
    const re = new RegExp(`\\[\\[(${escaparRe(semExtAntigo)}|${escaparRe(antigo)})(?=[\\]|#])`, 'g');
    for (const n of await listarArquivos(u, '.md')) {
      const abs = await caminhoSeguro(u, n);
      const texto = await fsp.readFile(abs, 'utf8');
      const novoTexto = texto.replace(re, (_, alvo) => `[[${alvo === semExtAntigo ? semExtNovo : novo}`);
      if (novoTexto !== texto) { await gravarAtomico(abs, novoTexto); atualizadas++; }
    }
  }
  return { atualizadas };
}

// Apagar = mover para .lixeira (dá para recuperar pela pasta do cofre).
export async function apagar(u, rel) {
  const origem = await caminhoSeguro(u, rel);
  const raiz = await raizDe(u);
  const lixeira = path.join(raiz, '.lixeira');
  await fsp.mkdir(lixeira, { recursive: true, mode: 0o700 });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  await fsp.rename(origem, path.join(lixeira, `${carimbo} ${path.basename(origem)}`));
  if (ehDesenho(rel)) {
    const png = origem.replace(/\.sketch\.json$/i, '.sketch.png');
    if (fs.existsSync(png)) await fsp.rename(png, path.join(lixeira, `${carimbo} ${path.basename(png)}`));
  }
}

export async function listarArquivos(u, ext = null) {
  const raiz = await raizDe(u);
  const saida = [];
  async function andar(dir, rel, nivel) {
    let itens;
    try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      if (it.name.startsWith('.') || it.name === 'node_modules') continue;
      const r = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory() && nivel < 12) await andar(path.join(dir, it.name), r, nivel + 1);
      else if (it.isFile() && (!ext || it.name.toLowerCase().endsWith(ext)) && tipoDe(r)) saida.push(r);
    }
  }
  await andar(raiz, '', 0);
  return saida;
}

export { hashTexto };

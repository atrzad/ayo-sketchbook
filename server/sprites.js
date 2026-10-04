// Sprites originais em pixel art, desenhados aqui mesmo (nada copiado de jogos).
// Cada sprite é uma grade de cores; o SVG junta pixels vizinhos da mesma cor em retângulos.

import { esc } from './markdown.js';

const CONTORNO = '#120d0a';

function grade(l, a) {
  return Array.from({ length: a }, () => Array(l).fill(null));
}

// Contorno automático: todo pixel vazio encostado (4 vizinhos) num pixel pintado vira contorno.
function contornar(g, cor = CONTORNO) {
  const a = g.length, l = g[0].length;
  const marcar = [];
  for (let y = 0; y < a; y++) for (let x = 0; x < l; x++) {
    if (g[y][x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== cor)) marcar.push([x, y]);
  }
  for (const [x, y] of marcar) g[y][x] = cor;
  return g;
}

function deMapa(linhas, paleta) {
  const a = linhas.length, l = Math.max(...linhas.map((s) => s.length));
  const g = grade(l, a);
  linhas.forEach((s, y) => [...s].forEach((ch, x) => { if (paleta[ch]) g[y][x] = paleta[ch]; }));
  return g;
}

function paraRetangulos(g) {
  const partes = [];
  for (let y = 0; y < g.length; y++) {
    let x = 0;
    while (x < g[y].length) {
      const c = g[y][x];
      if (!c) { x++; continue; }
      let fim = x + 1;
      while (fim < g[y].length && g[y][fim] === c) fim++;
      partes.push(`<rect x="${x}" y="${y}" width="${fim - x}" height="1" fill="${c}"/>`);
      x = fim;
    }
  }
  return partes.join('');
}

function svg(quadros, { classe = '', titulo = '', escala = 2 } = {}) {
  const l = quadros[0][0].length, a = quadros[0].length;
  const corpo = quadros.length === 1
    ? paraRetangulos(quadros[0])
    : quadros.map((q, i) => `<g class="quadro q${i + 1}">${paraRetangulos(q)}</g>`).join('');
  const rotulo = titulo ? `role="img" aria-label="${esc(titulo)}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="sprite ${classe}" ${rotulo} viewBox="0 0 ${l} ${a}" width="${l * escala}" height="${a * escala}" shape-rendering="crispEdges">${corpo}</svg>`;
}

// ---------- fogueira com espada (o checkpoint) ----------
const PAL_FOGO = {
  k: CONTORNO, h: '#4a2f1a', G: '#d9dee6', g: '#8c939e', w: '#6b4526', W: '#93633a', a: '#3d3631',
  r: '#a8301c', o: '#e2722b', y: '#f6c445', Y: '#fff1b8',
};
const CHAMAS = [
  ['................', '................', '................', '................',
   '................', '........o.......', '......o.oo......', '.....ooyoo.o....',
   '....ooyyyooo....', '...roYyyYyyor...', '...ryYYYYYyor...', '..rroyYYYYyorr..', '..rrooyyyyoorr..'],
  ['................', '................', '................', '................',
   '.......o........', '......oo..o.....', '.....ooyo.oo....', '....ooyyyoo.....',
   '....oyyYyyoo....', '...royYYYyyor...', '..rroyYYYYyorr..', '..roYyYYYyYyor..', '..rrooyyyyoorr..'],
  ['................', '................', '................', '................',
   '.........o......', '.....o..oo......', '.....oo.oyo.....', '....ooyooyoo....',
   '...rooyyYyoo....', '...royyYYyyor...', '..rroyYYYYYorr..', '..royYYYYYyyor..', '..rrooyyyyoorr..'],
];
const ESPADA = [
  '.......kk.......', '.......hh.......', '.......hh.......', '.....kGGGGk.....',
  '.......Gg.......', '.......gG.......', '.......Gg.......', '.......gG.......',
  '.......Gg.......', '.......gG.......', '.......Gg.......',
];
const TORAS = ['', '', '', '', '', '', '', '', '', '', '', '', '', '.WWw.......wWW..', '..wWWwwkkwwWWw..', '.aaaaaaaaaaaaaa.'];

function fogueira() {
  return CHAMAS.map((chama) => {
    const g = deMapa([...chama, '', '', ''].slice(0, 16), PAL_FOGO);
    const sobre = (mapa) => mapa.forEach((s, y) => [...s].forEach((ch, x) => { if (PAL_FOGO[ch]) g[y][x] = PAL_FOGO[ch]; }));
    sobre(ESPADA);
    sobre(TORAS);
    return g;
  });
}

// ---------- picareta de cobre (Trilha Dev, à la Terraria) ----------
function picareta() {
  const n = 16, g = grade(n, n);
  const cx = 3, cy = 12.5;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = x + 0.5, py = y + 0.5;
    const d = Math.hypot(px - cx, py - cy);
    const ang = (Math.atan2(cy - py, px - cx) * 180) / Math.PI;
    if (d >= 9 && d <= 11 && ang >= 6 && ang <= 84) g[y][x] = d < 9.9 ? '#f0a46a' : '#c4703a';
  }
  // cabo de madeira do canto inferior esquerdo até o meio da lâmina
  const [x0, y0, x1, y1] = [1.5, 14.5, 9.5, 5.5];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = x + 0.5, py = y + 0.5;
    const t = Math.max(0, Math.min(1, ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)));
    const d = Math.hypot(px - (x0 + t * (x1 - x0)), py - (y0 + t * (y1 - y0)));
    if (d <= 0.75 && !g[y][x]) g[y][x] = t > 0.5 ? '#93633a' : '#6b4526';
  }
  return [contornar(g)];
}

// ---------- orbe vermelho e branco (ENEM, à la Pokébola) ----------
function orbe() {
  const n = 16, g = grade(n, n), c = 7.5;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x + 0.5 - (c + 0.5), dy = y + 0.5 - (c + 0.5);
    const d = Math.hypot(dx, dy);
    if (d > 7.2) continue;
    let cor = dy < 0 ? '#e0453a' : '#efe9e1';
    if (dy < 0 && dx < -1 && dy < -3) cor = '#ff7a66';
    if (dy > 0 && d > 5.6) cor = '#b9b0a4';
    if (Math.abs(dy) < 1) cor = CONTORNO;
    if (d < 2.6) cor = CONTORNO;
    if (d < 1.7) cor = '#efe9e1';
    g[y][x] = cor;
  }
  return [contornar(g)];
}

// ---------- triângulos dourados (Manaus Previdência, à la Triforce) ----------
function triforca() {
  const l = 15, a = 13, g = grade(l, a);
  const tri = (topoX, topoY, altura) => {
    for (let i = 0; i < altura; i++) for (let x = topoX - i; x <= topoX + i; x++) {
      g[topoY + i][x] = i === altura - 1 ? '#a87b1c' : (x - (topoX - i) < 1 ? '#ffe68a' : '#f2c12e');
    }
  };
  tri(7, 0, 6);
  tri(3, 6, 6);
  tri(11, 6, 6);
  return [contornar(g)];
}

// ---------- moeda de ouro (BB, à la Stardew) ----------
function moeda() {
  const n = 14, g = grade(n, n), c = 6.5;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - (c + 0.5), (y + 0.5 - (c + 0.5)) * 1.05);
    if (d > 6.4) continue;
    let cor = d > 5.2 ? '#b8860b' : '#f2c12e';
    if (d <= 5.2 && x < c && y < c - 1 && d > 3.2) cor = '#ffe68a';
    g[y][x] = cor;
  }
  // um "g" gravado no meio
  ['.ddd', 'd..d', '.ddd', '...d', '.dd.'].forEach((s, i) => [...s].forEach((ch, j) => { if (ch === 'd') g[4 + i][5 + j] = '#9a6f08'; }));
  return [contornar(g)];
}

// ---------- coração (contêiner de vida, à la Zelda) ----------
const MAPA_CORACAO = ['.kk...kk.', 'kRRk.kRRk', 'kRwRkRRRk', 'kRRRRRRRk', '.kRRRRRk.', '..kRRRk..', '...kRk...', '....k....'];
function coracao(estado = 'cheio') {
  const pal = estado === 'vazio'
    ? { k: CONTORNO, R: '#3b2a26', w: '#4a3631' }
    : { k: CONTORNO, R: '#e0453a', w: '#ffd2c8' };
  const g = deMapa(MAPA_CORACAO, pal);
  if (estado === 'meio') {
    for (let y = 0; y < g.length; y++) for (let x = 5; x < 9; x++) if (g[y][x] && g[y][x] !== CONTORNO) g[y][x] = '#3b2a26';
  }
  return [g];
}

// ---------- bloco de minério (fases da Trilha Dev, tingido pela cor da fase) ----------
function misturar(hex, alvo, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(alvo)];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const MAPA_MINERIO = [
  'ssssSsssssss', 'sSoossssSsss', 'ssoOosssssss', 'sssosssoosSs', 'Sssssssooss s', 'sssSsssssss',
  'ssssssSssoos', 'soossssssoOs', 'sooOssSsssss', 'ssosssssssSs', 'sssssoosssss', 'sSsssssssss',
];
function minerio(hex = '#c4703a') {
  const pal = { s: '#4a4440', S: '#5f5853', o: hex, O: misturar(hex, '#ffffff', 0.45) };
  const g = deMapa(MAPA_MINERIO.map((l) => l.padEnd(12, 's').slice(0, 12).replace(/ /g, 's')), pal);
  return [contornar(g)];
}

// ---------- lágrima (moeda de progresso, à la Blasphemous) ----------
const MAPA_LAGRIMA = ['...w...', '..wWw..', '..wWw..', '.wWWWw.', 'wWWYWWw', 'wWYYWWw', 'wWWWWWw', '.wWWWw.', '..www..'];
function lagrima() {
  return [contornar(deMapa(MAPA_LAGRIMA, { w: '#7fb6d9', W: '#bfe3f5', Y: '#ffffff' }))];
}

// ---------- caveira (erros) ----------
const MAPA_CAVEIRA = ['..bbbbb..', '.bbbbbbb.', 'bbbbbbbbb', 'bkkbbbkkb', 'bkkbbbkkb', 'bbbbkbbbb', '.bbbbbbb.', '..bkbkb..', '..bbbbb..'];
function caveira() {
  return [contornar(deMapa(MAPA_CAVEIRA, { b: '#e8dcc4', k: CONTORNO }))];
}

// ---------- ampulheta (pomodoro) ----------
function ampulheta() {
  const l = 11, a = 15, g = grade(l, a);
  const vidro = '#9fc7d6', areia = '#f2c12e';
  for (let x = 0; x < l; x++) { g[0][x] = '#c9a45c'; g[14][x] = '#c9a45c'; }
  for (let y = 1; y < 14; y++) { g[y][1] = '#8a6a35'; g[y][9] = '#8a6a35'; }
  const largura = (y) => Math.floor(((y - 1) * 3) / 5); // estreita de 7 para 1
  for (let y = 1; y <= 6; y++) {
    const m = largura(y);
    for (let x = 2 + m; x <= 8 - m; x++) { g[y][x] = y >= 4 ? areia : vidro; g[14 - y][x] = 14 - y >= 11 ? areia : vidro; }
  }
  g[7][5] = areia;
  for (let y = 8; y <= 10; y++) g[y][5] = areia;
  return [contornar(g)];
}

// ---------- frasco de foco (uma sessão concluída) ----------
const MAPA_FRASCO = ['...ccc...', '...ggg...', '...gfg...', '..gfffg..', '.gffyffg.', 'gffyYyffg', 'gfffyfffg', 'gfffffffg', '.gfffffg.', '..ggggg..'];
function frasco(estado = 'cheio') {
  const cheio = estado === 'cheio';
  const pal = { c: '#6b4526', g: '#9fb3b8', f: cheio ? '#e2722b' : '#2a2320', y: cheio ? '#f6c445' : '#2a2320', Y: cheio ? '#fff1b8' : '#3a312b' };
  return [contornar(deMapa(MAPA_FRASCO, pal))];
}

// ---------- livro (caderno) ----------
const MAPA_LIVRO = ['..rrrrrrrrr.', '.rRRRRRRRRr.', '.rRgggggRRr.', '.rRgRRRgRRr.', '.rRgggggRRr.', '.rRRRRRRRRr.', '.rRRRRRRRRr.', '.rRRRRRRRRr.', '.rppppppppp.', '..rpppppppp.'];
function livro() {
  return [contornar(deMapa(MAPA_LIVRO, { r: '#7a2626', R: '#a83a3a', g: '#e0b94f', p: '#efe6d2' }))];
}

const FABRICAS = { fogueira, picareta, orbe, triforca, moeda, coracao, minerio, lagrima, caveira, ampulheta, frasco, livro };
const memo = new Map();

export function sprite(nome, opcoes = {}) {
  const { arg, ...resto } = opcoes;
  const chave = `${nome}|${arg ?? ''}`;
  if (!memo.has(chave)) memo.set(chave, FABRICAS[nome](arg));
  const classe = [`spr-${nome}`, resto.classe || ''].join(' ').trim();
  return svg(memo.get(chave), { ...resto, classe });
}

export const EMBLEMAS = { inicio: 'fogueira', dev: 'picareta', enem: 'orbe', manausprev: 'triforca', bb: 'moeda' };

// Traz as anotações do antigo caderno do Ayo Std para o cofre de cada pessoa (pasta "Caderno (Ayo Std)").
// Pode rodar de novo: notas já migradas (mesmo arquivo) são puladas. O banco do Ayo Std só é lido.
import { bancoAyoStd } from './db.js';
import * as cofre from './cofre.js';

const std = bancoAyoStd();
const nomes = new Map(std.prepare('SELECT id, nome FROM espacos').all().map((e) => [`e${e.id}`, e.nome]));
const trilhaNome = (s) => (!s ? '' : nomes.get(s) || { dev: 'Trilha Dev', enem: 'ENEM 2026', manausprev: 'Manaus Previdência', bb: 'Banco do Brasil' }[s] || s);
const limpar = (s) => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const aspas = (s) => `"${String(s || '').replace(/"/g, "'")}"`;

let criadas = 0, puladas = 0;
for (const u of std.prepare('SELECT id, dono FROM usuarios').all()) {
  const pessoa = { id: u.id, dono: !!u.dono };
  for (const n of std.prepare('SELECT * FROM caderno WHERE usuario_id = ? ORDER BY data, id').all(u.id)) {
    const titulo = limpar(n.titulo) || limpar(n.assunto) || `Anotação ${n.id}`;
    const base = `Caderno (Ayo Std)/${n.data} ${titulo}`;
    if (await cofre.existe(pessoa, `${base}.md`)) { puladas++; continue; }
    let embed = '';
    if (n.desenho) {
      const d = JSON.parse(n.desenho);
      const nomeDesenho = `${base}.sketch.json`;
      await cofre.gravarTexto(pessoa, nomeDesenho, JSON.stringify({ v: 1, fundo: 'pautado', altura: d.altura || 1400, imagens: [], tracos: d.tracos || [] }));
      embed = `\n\n![[${nomeDesenho.split('/').pop()}]]\n`;
    }
    const corpo = n.formato === 'txt' ? n.texto.split('\n').map((l) => (l ? `    ${l}` : '')).join('\n') : n.texto;
    const md = `---\ndata: ${n.data}\ntrilha: ${aspas(trilhaNome(n.trilha))}\nassunto: ${aspas(n.assunto)}\ntags: [caderno]\n---\n# ${titulo}\n\n${corpo}${embed}`;
    await cofre.gravarTexto(pessoa, `${base}.md`, md);
    criadas++;
  }
}
console.log(`Caderno migrado: ${criadas} anotações novas, ${puladas} já existiam.`);

// Ayo Sketchbook: app principal (explorador, editor, leitura, busca, tags, links, grafo, paleta).
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $('[data-app]');
  if (!app) return;
  const corpo = document.body;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const urlCaminho = (rel) => rel.split('/').map(encodeURIComponent).join('/');
  const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ehCelular = () => matchMedia('(max-width: 900px)').matches;

  async function api(url, dados, metodo = 'POST') {
    let r;
    try {
      r = await fetch(url, metodo === 'GET' ? { credentials: 'same-origin' } : {
        method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Ayo': '1' }, body: JSON.stringify(dados ?? {}),
      });
    } catch { throw Object.assign(new Error('Sem conexão com o servidor.'), { status: 0 }); }
    let j = {};
    try { j = await r.json(); } catch {}
    if (r.status === 401) { location.href = '/entrar'; }
    if (!r.ok) throw Object.assign(new Error(j.erro || `Erro ${r.status}.`), { status: r.status });
    return j;
  }
  const obter = (url) => api(url, null, 'GET');

  function avisar(texto, erro = false) {
    const el = $('#aviso');
    el.textContent = texto; el.classList.toggle('erro', erro); el.classList.add('mostrar');
    clearTimeout(avisar.t); avisar.t = setTimeout(() => el.classList.remove('mostrar'), erro ? 6000 : 2800);
  }

  // ---------- estado ----------
  const fonte = $('[data-fonte]');
  const leitura = $('[data-leitura]');
  const estado = $('[data-estado]');
  let arvore = [];
  let indice = { notas: [], arquivos: [], tags: [] };
  let abertas = new Set();
  let atual = null; // { tipo: 'nota'|'desenho'|'imagem'|'grafo', rel, hash }
  let sujo = false, salvando = false, conflito = false, timerSalvar = null, timerRender = null;
  let desenhoAberto = null;
  let prefs = {};

  const salvarPrefs = (() => { let t; return (p) => { Object.assign(prefs, p); clearTimeout(t); t = setTimeout(() => api('/api/preferencias', prefs).catch(() => {}), 800); }; })();

  function mostrarEstado(tipo, texto) { estado.dataset.tipo = tipo; estado.textContent = texto; }

  // ---------- árvore ----------
  const ICONES = { nota: '¶', desenho: '✎', imagem: '▣', pdf: '⎙' };
  function itemArvore(n) {
    if (n.tipo === 'pasta') {
      const aberta = abertas.has(n.caminho);
      return `<li class="pasta${aberta ? ' aberta' : ''}" data-caminho="${esc(n.caminho)}" data-tipo="pasta" role="treeitem" aria-expanded="${aberta}">
        <button type="button" class="item" draggable="true"><span class="tipo"></span><span class="nome">${esc(n.nome)}</span></button>
        ${aberta ? `<ul role="group">${n.filhos.map(itemArvore).join('')}</ul>` : ''}</li>`;
    }
    const nome = n.tipo === 'nota' ? n.nome.replace(/\.md$/i, '') : n.tipo === 'desenho' ? n.nome.replace(/\.sketch\.json$/i, '') : n.nome;
    return `<li data-caminho="${esc(n.caminho)}" data-tipo="${n.tipo}" role="treeitem">
      <button type="button" class="item${atual?.rel === n.caminho ? ' ativo' : ''}" draggable="true"><span class="tipo">${ICONES[n.tipo] || '·'}</span><span class="nome">${esc(nome)}</span></button></li>`;
  }
  function desenharArvore() {
    $('[data-arvore]').innerHTML = arvore.length ? arvore.map(itemArvore).join('') : '<li class="vazio">Cofre vazio. Crie uma nota.</li>';
  }
  async function recarregar() {
    const [a, i] = await Promise.all([obter('/api/arvore'), obter('/api/indice')]);
    arvore = a.arvore; indice = i;
    desenharArvore(); desenharTags();
  }

  $('[data-arvore]').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-caminho]');
    if (!li) return;
    if (li.dataset.tipo === 'pasta') {
      abertas.has(li.dataset.caminho) ? abertas.delete(li.dataset.caminho) : abertas.add(li.dataset.caminho);
      salvarPrefs({ abertas: [...abertas] });
      desenharArvore();
    } else abrir(li.dataset.caminho);
  });
  $('[data-arvore]').addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li[data-caminho]');
    if (!li) return;
    e.preventDefault();
    menuDoItem(li.dataset.caminho, li.dataset.tipo, e.clientX, e.clientY);
  });
  // arrastar arquivo para dentro de uma pasta (ou para a raiz)
  let arrastado = null;
  $('[data-arvore]').addEventListener('dragstart', (e) => { arrastado = e.target.closest('li[data-caminho]')?.dataset.caminho || null; });
  $('[data-arvore]').addEventListener('dragover', (e) => {
    if (!arrastado) return;
    e.preventDefault();
    $$('.arrastando-sobre').forEach((x) => x.classList.remove('arrastando-sobre'));
    e.target.closest('li[data-tipo="pasta"]')?.classList.add('arrastando-sobre');
  });
  $('[data-arvore]').addEventListener('drop', async (e) => {
    if (!arrastado) return;
    e.preventDefault();
    $$('.arrastando-sobre').forEach((x) => x.classList.remove('arrastando-sobre'));
    const pasta = e.target.closest('li[data-tipo="pasta"]')?.dataset.caminho || '';
    const nome = arrastado.split('/').pop();
    const para = pasta ? `${pasta}/${nome}` : nome;
    const de = arrastado;
    arrastado = null;
    if (para === de || para.startsWith(`${de}/`)) return;
    await moverArquivo(de, para);
  });

  // ---------- menus ----------
  const menu = $('[data-menu]');
  function abrirMenu(opcoes, x, y) {
    menu.innerHTML = opcoes.map((o, i) => `<li role="menuitem" tabindex="-1" data-i="${i}"${o.perigo ? ' class="perigo"' : ''}>${esc(o.rotulo)}</li>`).join('');
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
    menu.onclick = (e) => { const li = e.target.closest('li[data-i]'); if (!li) return; menu.hidden = true; opcoes[Number(li.dataset.i)].acao(); };
  }
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-menu-botao]')) menu.hidden = true; });

  const pastaDe = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
  function menuDoItem(rel, tipo, x, y) {
    const pasta = tipo === 'pasta' ? rel : pastaDe(rel);
    const opcoes = [];
    if (tipo !== 'pasta') opcoes.push({ rotulo: 'Abrir', acao: () => abrir(rel) });
    opcoes.push(
      { rotulo: 'Nova nota aqui', acao: () => novaNota(pasta) },
      { rotulo: 'Novo desenho aqui', acao: () => novoDesenho(pasta) },
      { rotulo: 'Nova pasta aqui', acao: () => novaPasta(pasta) },
      { rotulo: 'Renomear', acao: () => renomear(rel, tipo) },
      { rotulo: 'Mover para…', acao: () => moverPara(rel) },
    );
    if (tipo === 'nota') opcoes.push({ rotulo: 'Copiar [[link]]', acao: () => copiar(`[[${rel.replace(/\.md$/i, '').split('/').pop()}]]`) });
    if (tipo === 'desenho') opcoes.push({ rotulo: 'Copiar embed ![[ ]]', acao: () => copiar(`![[${rel.replace(/\.sketch\.json$/i, '.sketch.png').split('/').pop()}]]`) });
    opcoes.push({ rotulo: 'Apagar (vai para a lixeira)', perigo: true, acao: () => apagar(rel) });
    abrirMenu(opcoes, x, y);
  }
  async function copiar(t) { try { await navigator.clipboard.writeText(t); avisar('Copiado.'); } catch { avisar(t); } }

  // ---------- modal: busca rápida, paleta e perguntas ----------
  const modal = $('[data-modal]');
  const campoModal = $('[data-modal-campo]');
  const listaModal = $('[data-modal-lista]');
  const dicaModal = $('[data-modal-dica]');
  let itensModal = [], selModal = 0, aoEscolher = null, aoFiltrar = null;
  function abrirModal({ placeholder, dica = '', valor = '', filtrar, escolher }) {
    aoFiltrar = filtrar; aoEscolher = escolher;
    campoModal.placeholder = placeholder; campoModal.value = valor; dicaModal.textContent = dica;
    modal.hidden = false; atualizarModal(); campoModal.focus(); campoModal.select();
  }
  function fecharModal() { modal.hidden = true; aoEscolher = null; }
  function atualizarModal() {
    itensModal = aoFiltrar ? aoFiltrar(campoModal.value) : [];
    selModal = 0;
    listaModal.innerHTML = itensModal.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === 0}"><span>${esc(it.rotulo)}</span>${it.detalhe ? `<small>${esc(it.detalhe)}</small>` : ''}</li>`).join('');
  }
  function marcarModal(i) {
    selModal = Math.max(0, Math.min(itensModal.length - 1, i));
    $$('li', listaModal).forEach((li, j) => li.setAttribute('aria-selected', String(j === selModal)));
    $$('li', listaModal)[selModal]?.scrollIntoView({ block: 'nearest' });
  }
  campoModal.addEventListener('input', atualizarModal);
  campoModal.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); marcarModal(selModal + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcarModal(selModal - 1); }
    else if (e.key === 'Escape') fecharModal();
    else if (e.key === 'Enter') { e.preventDefault(); const f = aoEscolher; const it = itensModal[selModal]; fecharModal(); f?.(it, campoModal.value); }
  });
  listaModal.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (!li) return; const f = aoEscolher; const it = itensModal[Number(li.dataset.i)]; fecharModal(); f?.(it, campoModal.value); });
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharModal(); });

  function perguntar(placeholder, valor = '', dica = 'Enter confirma · Esc cancela') {
    return new Promise((resolve) => abrirModal({ placeholder, valor, dica, filtrar: () => [], escolher: (_it, texto) => resolve(texto.trim() || null) }));
  }

  // nota pelo nome: aproximação simples (todas as letras na ordem)
  function pontuar(alvo, q) {
    const a = semAcento(alvo); let pos = 0, pontos = 0;
    for (const ch of q) { const i = a.indexOf(ch, pos); if (i < 0) return -1; pontos += i === pos ? 2 : 1; pos = i + 1; }
    return pontos + (a.startsWith(q) ? 10 : 0) + (a.includes(q) ? 5 : 0);
  }
  function abrirRapido() {
    abrirModal({
      placeholder: 'Nome da nota ou do desenho…', dica: '↑↓ escolhe · Enter abre · se não existir, cria',
      filtrar: (texto) => {
        const q = semAcento(texto.trim());
        const todos = [...indice.notas.map((n) => ({ rotulo: n.nome, detalhe: n.rel, rel: n.rel })),
          ...indice.arquivos.filter((a) => a.tipo !== 'imagem' || !a.rel.toLowerCase().endsWith('.sketch.png')).map((a) => ({ rotulo: a.nome.replace(/\.sketch\.json$/i, ' ✎'), detalhe: a.rel, rel: a.rel }))];
        const lista = q ? todos.map((t) => ({ ...t, s: Math.max(pontuar(t.rotulo, q), pontuar(t.detalhe, q) - 3) })).filter((t) => t.s >= 0).sort((a, b) => b.s - a.s).slice(0, 40) : todos.slice(0, 40);
        if (texto.trim() && !lista.some((t) => semAcento(t.rotulo) === q)) lista.push({ rotulo: `Criar “${texto.trim()}”`, criar: texto.trim() });
        return lista;
      },
      escolher: (it) => { if (!it) return; it.criar ? criarNotaComNome(it.criar) : abrir(it.rel); },
    });
  }

  const COMANDOS = [
    ['Nova nota', 'Ctrl+N', () => novaNota(pastaAtual())],
    ['Novo desenho', '', () => novoDesenho(pastaAtual())],
    ['Nova pasta', '', () => novaPasta(pastaAtual())],
    ['Abrir nota do dia', '', () => diaria()],
    ['Abrir o grafo', '', () => navegar('/grafo')],
    ['Buscar em todo o cofre', 'Ctrl+Shift+F', () => mostrarAbaEsq('busca', true)],
    ['Alternar editar/ler', 'Ctrl+E', () => alternarModo()],
    ['Modo dividido', '', () => definirModo('dividir')],
    ['Renomear nota atual', 'F2', () => atual && renomear(atual.rel, atual.tipo)],
    ['Apagar nota atual', '', () => atual && apagar(atual.rel)],
    ['Inserir data de hoje', '', () => inserir(new Date().toLocaleDateString('pt-BR'))],
    ['Inserir tarefa', '', () => inserir('- [ ] ')],
    ['Inserir tabela', '', () => inserir('\n| Coluna | Coluna |\n| --- | --- |\n|  |  |\n')],
    ['Inserir callout', '', () => inserir('\n> [!note] Título\n> Texto\n')],
    ['Mostrar/ocultar barra esquerda', '', () => alternarLado('esquerda')],
    ['Mostrar/ocultar barra direita', '', () => alternarLado('direita')],
    ['Recolher todas as pastas', '', () => { abertas.clear(); salvarPrefs({ abertas: [] }); desenharArvore(); }],
    ['Sair', '', () => sair()],
  ];
  function paleta() {
    abrirModal({
      placeholder: 'Comando…', dica: 'Enter executa',
      filtrar: (t) => { const q = semAcento(t.trim()); return COMANDOS.filter(([n]) => !q || pontuar(n, q) >= 0).map(([n, atalho, f]) => ({ rotulo: n, detalhe: atalho, f })); },
      escolher: (it) => it?.f(),
    });
  }

  // ---------- criar / renomear / mover / apagar ----------
  const pastaAtual = () => (atual?.rel ? pastaDe(atual.rel) : '');
  const limparNome = (n) => n.replace(/[\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  async function criarNotaComNome(nome, pasta = '') {
    const n = limparNome(nome).replace(/\.md$/i, '');
    if (!n) return;
    const c = n.includes('/') ? n : (pasta ? `${pasta}/${n}` : n);
    try {
      const r = await api('/api/criar', { c: `${c}.md`, tipo: 'nota', conteudo: `# ${n.split('/').pop()}\n\n` });
      await recarregar(); await abrir(r.c, { modo: 'editar' });
    } catch (err) { avisar(err.message, true); }
  }
  async function novaNota(pasta) { const n = await perguntar('Nome da nova nota', 'Sem título'); if (n) await criarNotaComNome(n, pasta); }
  async function novaPasta(pasta) {
    const n = await perguntar('Nome da nova pasta');
    if (!n) return;
    const c = pasta ? `${pasta}/${limparNome(n)}` : limparNome(n);
    try { await api('/api/criar', { c, tipo: 'pasta' }); abertas.add(c); if (pasta) abertas.add(pasta); await recarregar(); } catch (err) { avisar(err.message, true); }
  }
  async function novoDesenho(pasta) {
    const n = await perguntar('Nome do desenho', `Desenho ${new Date().toLocaleDateString('sv-SE')}`);
    if (!n) return;
    try { const r = await api('/api/criar', { c: pasta ? `${pasta}/${limparNome(n)}` : limparNome(n), tipo: 'desenho' }); await recarregar(); await abrir(r.c); } catch (err) { avisar(err.message, true); }
  }
  async function moverArquivo(de, para) {
    try {
      await salvarAgora();
      const r = await api('/api/mover', { de, para });
      if (atual?.rel === de) atual.rel = para;
      await recarregar();
      if (atual?.rel === para) { history.replaceState(null, '', rotaDe(para)); mostrarCaminho(); }
      avisar(r.atualizadas ? `Movido. Links atualizados em ${r.atualizadas} ${r.atualizadas === 1 ? 'nota' : 'notas'}.` : 'Movido.');
    } catch (err) { avisar(err.message, true); }
  }
  async function renomear(rel, tipo) {
    const ext = tipo === 'nota' ? '.md' : tipo === 'desenho' ? '.sketch.json' : '';
    const base = rel.split('/').pop();
    const semExt = ext && base.toLowerCase().endsWith(ext) ? base.slice(0, -ext.length) : base;
    const novo = await perguntar('Novo nome', semExt);
    if (!novo || novo === semExt) return;
    const pasta = pastaDe(rel);
    await moverArquivo(rel, `${pasta ? `${pasta}/` : ''}${limparNome(novo)}${ext && !novo.toLowerCase().endsWith(ext) ? ext : ''}`);
  }
  async function moverPara(rel) {
    const pastas = [];
    const andar = (ns) => ns.forEach((n) => { if (n.tipo === 'pasta') { pastas.push(n.caminho); andar(n.filhos); } });
    andar(arvore);
    abrirModal({
      placeholder: 'Mover para a pasta…', dica: 'Escolha a pasta (ou digite um nome novo)',
      filtrar: (t) => { const q = semAcento(t.trim()); const l = [{ rotulo: '(raiz do cofre)', p: '' }, ...pastas.map((p) => ({ rotulo: p, p }))].filter((x) => !q || semAcento(x.rotulo).includes(q)); if (t.trim() && !pastas.includes(t.trim())) l.push({ rotulo: `Nova pasta “${t.trim()}”`, p: limparNome(t.trim()) }); return l; },
      escolher: (it) => { if (!it) return; const nome = rel.split('/').pop(); moverArquivo(rel, it.p ? `${it.p}/${nome}` : nome); },
    });
  }
  async function apagar(rel) {
    const ok = await perguntar(`Apagar “${rel.split('/').pop()}”? Digite SIM`, '', 'Vai para a pasta .lixeira do cofre');
    if (!ok || ok.toUpperCase() !== 'SIM') return;
    try {
      if (atual?.rel === rel) { sujo = false; await fecharAtual(); mostrarVazio(); history.pushState(null, '', '/'); }
      await api('/api/apagar', { c: rel }); await recarregar(); avisar('Apagado (está na .lixeira do cofre).');
    } catch (err) { avisar(err.message, true); }
  }
  async function diaria() { try { const r = await api('/api/diaria'); await recarregar(); await abrir(r.c); } catch (err) { avisar(err.message, true); } }

  // ---------- abrir / fechar ----------
  const rotaDe = (rel) => (rel.toLowerCase().endsWith('.sketch.json') ? `/d/${urlCaminho(rel)}` : `/n/${urlCaminho(rel)}`);
  function tipoDe(rel) {
    const r = rel.toLowerCase();
    if (r.endsWith('.sketch.json')) return 'desenho';
    if (r.endsWith('.md')) return 'nota';
    if (/\.(png|jpe?g|gif|webp)$/.test(r)) return 'imagem';
    if (r.endsWith('.pdf')) return 'pdf';
    return null;
  }
  function esconderAreas() {
    $('[data-vazio]').hidden = true; $('[data-editor]').hidden = true; $('[data-desenho-area]').hidden = true; $('[data-grafo-area]').hidden = true; $('[data-imagem-area]').hidden = true;
  }
  function mostrarVazio() { esconderAreas(); $('[data-barra]').hidden = true; $('[data-vazio]').hidden = false; atual = null; desenharArvore(); limparLateral(); document.title = 'Ayo Sketchbook'; }

  async function fecharAtual() {
    pararGrafo();
    if (desenhoAberto) { await desenhoAberto.fechar(); desenhoAberto = null; }
    if (atual?.tipo === 'nota') await salvarAgora();
  }

  async function abrir(rel, { modo = null, historia = true } = {}) {
    if (!rel) return;
    const tipo = tipoDe(rel);
    if (tipo === 'pdf') { window.open(`/arquivo/${urlCaminho(rel)}`, '_blank', 'noopener'); return; }
    await fecharAtual();
    if (historia) history.pushState(null, '', tipo === 'imagem' ? `/n/${urlCaminho(rel)}` : rotaDe(rel));
    // abre as pastas do caminho na árvore
    const partes = rel.split('/'); for (let i = 1; i < partes.length; i++) abertas.add(partes.slice(0, i).join('/'));
    esconderAreas();
    $('[data-barra]').hidden = false;
    if (ehCelular()) corpo.classList.remove('mostrar-esquerda');
    if (tipo === 'nota') {
      try {
        const n = await obter(`/api/nota?c=${encodeURIComponent(rel)}`);
        atual = { tipo, rel, hash: n.hash };
        sujo = false; conflito = false;
        fonte.value = n.texto;
        $('[data-editor]').hidden = false;
        $('.modos').hidden = false;
        if (modo) definirModo(modo, false);
        mostrarEstado('salvo', 'Salvo');
        await renderizar();
        carregarLinks();
        salvarPrefs({ ultima: rel, abertas: [...abertas] });
        if (app.dataset.modo !== 'ler' && (modo === 'editar' || new URLSearchParams(location.search).get('editar'))) { fonte.focus(); fonte.setSelectionRange(fonte.value.length, fonte.value.length); }
      } catch (err) { avisar(err.message, true); mostrarVazio(); return; }
    } else if (tipo === 'desenho') {
      atual = { tipo, rel };
      $('.modos').hidden = true;
      const area = $('[data-desenho-area]');
      area.hidden = false;
      desenhoAberto = window.AyoDesenho.abrir(area, rel, {
        api, avisar,
        aoSalvar: (s) => mostrarEstado(s === 'salvo' ? 'salvo' : s === 'erro' ? 'erro' : 'sujo', s === 'salvo' ? 'Salvo' : s === 'salvando' ? 'Salvando…' : s === 'erro' ? 'Não salvou' : 'Alterações não salvas'),
      });
      limparLateral(); carregarLinks();
      salvarPrefs({ ultima: rel, abertas: [...abertas] });
    } else if (tipo === 'imagem') {
      atual = { tipo, rel };
      $('.modos').hidden = true;
      const area = $('[data-imagem-area]');
      area.innerHTML = `<img src="/arquivo/${urlCaminho(rel)}" alt="${esc(rel.split('/').pop())}">`;
      area.hidden = false; mostrarEstado('', ''); limparLateral(); carregarLinks();
    }
    mostrarCaminho(); desenharArvore();
    document.title = `${rel.split('/').pop().replace(/\.(md|sketch\.json)$/i, '')} · Ayo Sketchbook`;
  }

  function mostrarCaminho() {
    if (!atual?.rel) return;
    const partes = atual.rel.split('/');
    const nome = partes.pop().replace(/\.(md|sketch\.json)$/i, '');
    $('[data-migalha]').innerHTML = `${partes.map((p) => `${esc(p)} / `).join('')}<b>${esc(nome)}</b>`;
  }

  // ---------- edição e salvamento ----------
  function marcarSujo() {
    if (conflito) return;
    sujo = true; mostrarEstado('sujo', 'Alterações não salvas');
    clearTimeout(timerSalvar); timerSalvar = setTimeout(salvar, 900);
    clearTimeout(timerRender); timerRender = setTimeout(renderizar, 350);
  }
  async function salvar() {
    if (!sujo || !atual || atual.tipo !== 'nota' || conflito) return;
    if (salvando) { clearTimeout(timerSalvar); timerSalvar = setTimeout(salvar, 400); return; }
    salvando = true; sujo = false;
    const rel = atual.rel;
    mostrarEstado('sujo', 'Salvando…');
    try {
      const r = await api('/api/nota', { c: rel, texto: fonte.value, hash: atual.hash });
      if (atual?.rel === rel) { atual.hash = r.hash; if (!sujo) mostrarEstado('salvo', 'Salvo'); }
      atualizarIndiceDepois();
    } catch (err) {
      if (err.status === 409) { conflito = true; mostrarConflito(); }
      else { sujo = true; mostrarEstado('erro', 'Não salvou: tentando de novo'); clearTimeout(timerSalvar); timerSalvar = setTimeout(salvar, 5000); }
    } finally { salvando = false; }
  }
  async function salvarAgora() { clearTimeout(timerSalvar); if (sujo) await salvar(); }
  const atualizarIndiceDepois = (() => { let t; return () => { clearTimeout(t); t = setTimeout(async () => { try { indice = await obter('/api/indice'); desenharTags(); carregarLinks(); } catch {} }, 1500); }; })();

  function mostrarConflito() {
    mostrarEstado('erro', 'Conflito');
    abrirMenu([
      { rotulo: 'A nota mudou fora daqui (Obsidian ou outra aba). Recarregar a versão do arquivo', acao: async () => { conflito = false; sujo = false; await abrir(atual.rel, { historia: false }); } },
      { rotulo: 'Manter o que escrevi aqui e sobrescrever o arquivo', perigo: true, acao: async () => { conflito = false; atual.hash = undefined; sujo = true; await salvar(); } },
    ], innerWidth / 2 - 180, 120);
  }

  fonte.addEventListener('input', () => { marcarSujo(); autocompletar(); });
  addEventListener('beforeunload', (e) => { if (sujo || salvando || desenhoAberto?.sujo) { salvarAgora(); desenhoAberto?.salvarAgora(); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { salvarAgora(); desenhoAberto?.salvarAgora(); } });

  function inserir(texto, envolverAntes = null, envolverDepois = null) {
    if (!atual || atual.tipo !== 'nota') return;
    if (app.dataset.modo === 'ler') definirModo('dividir');
    const { selectionStart: a, selectionEnd: b, value: v } = fonte;
    const sel = v.slice(a, b);
    const novo = envolverAntes ? `${envolverAntes}${sel}${envolverDepois}` : texto;
    fonte.setRangeText(novo, a, b, 'end');
    if (envolverAntes && !sel) fonte.selectionStart = fonte.selectionEnd = a + envolverAntes.length;
    fonte.focus(); marcarSujo();
  }

  fonte.addEventListener('keydown', (e) => {
    const auto = $('[data-auto]');
    if (!auto.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) { teclaAuto(e); return; }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); inserir('', '**', '**'); return; }
    if (ctrl && e.key.toLowerCase() === 'i') { e.preventDefault(); inserir('', '*', '*'); return; }
    if (ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); inserir('', '[[', ']]'); return; }
    if (ctrl && e.key === 'Enter') { e.preventDefault(); alternarTarefaNaLinha(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, value: v } = fonte;
      const ini = v.lastIndexOf('\n', a - 1) + 1;
      if (e.shiftKey) { if (v.slice(ini, ini + 2) === '  ') { fonte.setRangeText('', ini, ini + 2, 'preserve'); fonte.selectionStart = fonte.selectionEnd = Math.max(ini, a - 2); } }
      else fonte.setRangeText('  ', ini, ini, 'end'), fonte.selectionStart = fonte.selectionEnd = a + 2;
      marcarSujo(); return;
    }
    // Enter continua listas, tarefas e citações
    if (e.key === 'Enter' && !e.shiftKey) {
      const { selectionStart: a, value: v } = fonte;
      const ini = v.lastIndexOf('\n', a - 1) + 1;
      const linha = v.slice(ini, a);
      const m = /^(\s*)((?:[-*+] \[[ xX]\] )|(?:[-*+] )|(?:(\d+)[.)] )|(?:> ))(.*)$/.exec(linha);
      if (!m) return;
      e.preventDefault();
      if (!m[4].trim()) { fonte.setRangeText('', ini, a, 'end'); marcarSujo(); return; } // linha vazia encerra a lista
      let marcador = m[2];
      if (/\[[ xX]\]/.test(marcador)) marcador = marcador.replace(/\[[ xX]\]/, '[ ]');
      if (m[3]) marcador = marcador.replace(m[3], String(Number(m[3]) + 1));
      fonte.setRangeText(`\n${m[1]}${marcador}`, a, a, 'end'); marcarSujo();
    }
  });
  function alternarTarefaNaLinha() {
    const { selectionStart: a, value: v } = fonte;
    const ini = v.lastIndexOf('\n', a - 1) + 1;
    const fim = v.indexOf('\n', a) < 0 ? v.length : v.indexOf('\n', a);
    const linha = v.slice(ini, fim);
    let nova;
    if (/^\s*[-*+] \[ \]/.test(linha)) nova = linha.replace('[ ]', '[x]');
    else if (/^\s*[-*+] \[[xX]\]/.test(linha)) nova = linha.replace(/\[[xX]\]/, '[ ]');
    else if (/^\s*[-*+] /.test(linha)) nova = linha.replace(/^(\s*[-*+] )/, '$1[ ] ');
    else nova = `- [ ] ${linha}`;
    fonte.setRangeText(nova, ini, fim, 'end'); marcarSujo();
  }

  // colar/arrastar imagem: vira anexo e entra como ![[embed]]
  async function enviarAnexo(arq) {
    mostrarEstado('sujo', 'Enviando imagem…');
    const r = await fetch(`/api/anexo?nome=${encodeURIComponent(arq.name || '')}`, { method: 'POST', headers: { 'Content-Type': arq.type, 'X-Ayo': '1' }, body: arq });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || 'Falha no envio.');
    inserir(`![[${j.c.split('/').pop()}]]\n`);
    indice = await obter('/api/indice');
  }
  fonte.addEventListener('paste', async (e) => {
    const arq = [...(e.clipboardData?.files || [])].find((f) => /^image\/|pdf/.test(f.type));
    if (!arq) return;
    e.preventDefault();
    try { await enviarAnexo(arq); } catch (err) { avisar(err.message, true); }
  });
  fonte.addEventListener('drop', async (e) => {
    const arq = [...(e.dataTransfer?.files || [])].find((f) => /^image\/|pdf/.test(f.type));
    if (!arq) return;
    e.preventDefault();
    try { await enviarAnexo(arq); } catch (err) { avisar(err.message, true); }
  });

  // ---------- autocompletar [[link]] ----------
  const auto = $('[data-auto]');
  let itensAuto = [], selAuto = 0, inicioAuto = -1;
  function autocompletar() {
    const { selectionStart: a, value: v } = fonte;
    const ini = v.lastIndexOf('[[', a);
    const fecha = v.lastIndexOf(']]', a);
    if (ini < 0 || fecha > ini || a - ini > 80 || v.slice(ini, a).includes('\n')) { auto.hidden = true; return; }
    const q = semAcento(v.slice(ini + 2, a));
    inicioAuto = ini + 2;
    itensAuto = [...indice.notas, ...indice.arquivos].map((n) => ({ nome: n.tipo === 'nota' ? n.nome : n.rel.split('/').pop(), rel: n.rel }))
      .map((n) => ({ ...n, s: q ? pontuar(n.nome, q) : 0 })).filter((n) => n.s >= 0).sort((x, y) => y.s - x.s).slice(0, 12);
    if (!itensAuto.length) { auto.hidden = true; return; }
    selAuto = 0;
    auto.innerHTML = itensAuto.map((n, i) => `<li role="option" data-i="${i}" aria-selected="${i === 0}">${esc(n.nome)}<small>${esc(n.rel)}</small></li>`).join('');
    const r = fonte.getBoundingClientRect();
    auto.style.left = `${Math.min(r.left + 40, innerWidth - 380)}px`;
    auto.style.top = `${Math.min(r.top + 60, innerHeight - 320)}px`;
    auto.hidden = false;
  }
  function escolherAuto(i) {
    const n = itensAuto[i];
    if (!n) return;
    const { selectionStart: a, value: v } = fonte;
    const jaFecha = v.slice(a, a + 2) === ']]';
    fonte.setRangeText(`${n.nome}${jaFecha ? '' : ']]'}`, inicioAuto, a, 'end');
    if (jaFecha) fonte.selectionStart = fonte.selectionEnd = fonte.selectionStart + 2;
    auto.hidden = true; marcarSujo();
  }
  function teclaAuto(e) {
    e.preventDefault();
    if (e.key === 'Escape') { auto.hidden = true; return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      selAuto = Math.max(0, Math.min(itensAuto.length - 1, selAuto + (e.key === 'ArrowDown' ? 1 : -1)));
      $$('li', auto).forEach((li, j) => li.setAttribute('aria-selected', String(j === selAuto)));
      return;
    }
    escolherAuto(selAuto);
  }
  auto.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); escolherAuto(Number(li.dataset.i)); } });
  fonte.addEventListener('blur', () => setTimeout(() => { auto.hidden = true; }, 150));

  // ---------- leitura ----------
  async function renderizar() {
    if (!atual || atual.tipo !== 'nota') return;
    try {
      const r = await api('/api/render', { c: atual.rel, texto: fonte.value });
      const props = Object.entries(r.props || {});
      leitura.innerHTML = (props.length ? `<dl class="propriedades">${props.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(', ') : v)}</dd>`).join('')}</dl>` : '') + r.html;
      $('[data-sumario]').innerHTML = r.toc.length ? r.toc.map((t) => `<li class="n${t.nivel}"><a href="#${esc(t.id)}" data-ancora="${esc(t.id)}">${esc(t.texto)}</a></li>`).join('') : '<li class="vazio">Sem títulos.</li>';
      $('[data-props]').innerHTML = props.length ? props.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(', ') : v)}</dd>`).join('') : '<p class="vazio">Sem propriedades. Adicione no topo da nota, entre linhas ---.</p>';
      const saidas = [...new Map($$('a[data-nota]', leitura).map((a) => [a.dataset.nota, a.textContent])).entries()];
      $('[data-saidas]').innerHTML = saidas.length ? saidas.map(([rel, t]) => `<li><a href="${rotaDe(rel)}" data-abrir="${esc(rel)}"><b>${esc(t)}</b><small>${esc(rel)}</small></a></li>`).join('') : '<li class="vazio">Nenhum link nesta nota.</li>';
    } catch (err) { avisar(err.message, true); }
  }
  async function carregarLinks() {
    if (!atual?.rel) return;
    try {
      const r = await obter(`/api/backlinks?c=${encodeURIComponent(atual.rel)}`);
      $('[data-backlinks]').innerHTML = r.backlinks.length ? r.backlinks.map((b) => `<li><a href="${rotaDe(b.rel)}" data-abrir="${esc(b.rel)}"><b>${esc(b.nome)}</b><small>${esc(b.trecho)}</small></a></li>`).join('') : '<li class="vazio">Nenhuma nota aponta para cá.</li>';
    } catch {}
  }
  function limparLateral() { $('[data-sumario]').innerHTML = ''; $('[data-props]').innerHTML = ''; $('[data-saidas]').innerHTML = ''; $('[data-backlinks]').innerHTML = ''; }

  leitura.addEventListener('click', async (e) => {
    const a = e.target.closest('a');
    if (a?.dataset.nota) { e.preventDefault(); return abrir(a.dataset.nota); }
    if (a?.dataset.criar) { e.preventDefault(); return criarNotaComNome(a.dataset.criar, pastaAtual()); }
    if (a?.dataset.tag) { e.preventDefault(); return buscarTag(a.dataset.tag); }
    if (a && a.getAttribute('href')?.startsWith('/d/')) { e.preventDefault(); return abrir(decodeURIComponent(a.getAttribute('href').slice(3))); }
  });
  leitura.addEventListener('change', async (e) => {
    const cb = e.target.closest('input.cb[data-linha]');
    if (!cb) return;
    await salvarAgora();
    try {
      const r = await api('/api/tarefa', { c: atual.rel, linha: Number(cb.dataset.linha), hash: cb.dataset.hash, marcado: cb.checked });
      const linhas = fonte.value.split('\n');
      const n = Number(cb.dataset.linha);
      linhas[n] = linhas[n].replace(/\[[ xX]\]/, cb.checked ? '[x]' : '[ ]');
      fonte.value = linhas.join('\n');
      atual.hash = r.hash;
      cb.dataset.hash = r.hashLinha;
      cb.closest('li')?.classList.toggle('feito', cb.checked);
    } catch (err) { cb.checked = !cb.checked; avisar(err.status === 409 ? 'A nota mudou. Recarregando…' : err.message, true); if (err.status === 409) abrir(atual.rel, { historia: false }); }
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-abrir]');
    if (a) { e.preventDefault(); abrir(a.dataset.abrir); return; }
    const anc = e.target.closest('[data-ancora]');
    if (anc) { e.preventDefault(); document.getElementById(anc.dataset.ancora)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  // ---------- modos ----------
  function definirModo(m, guardar = true) {
    app.dataset.modo = m;
    $$('[data-modo-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modoBtn === m)));
    if (guardar) salvarPrefs({ modo: m });
    if (m !== 'editar') renderizar();
  }
  function alternarModo() { definirModo(app.dataset.modo === 'ler' ? 'editar' : 'ler'); if (app.dataset.modo === 'editar') fonte.focus(); }
  $$('[data-modo-btn]').forEach((b) => b.addEventListener('click', () => definirModo(b.dataset.modoBtn)));
  definirModo(app.dataset.modo || 'dividir', false);

  // ---------- busca e tags ----------
  function mostrarAbaEsq(nome, focar = false) {
    if (corpo.classList.contains('sem-esquerda')) alternarLado('esquerda');
    if (ehCelular()) corpo.classList.add('mostrar-esquerda');
    $$('[data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
    $$('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== nome; });
    if (focar && nome === 'busca') $('[data-busca]').focus();
  }
  $$('[data-aba]').forEach((b) => b.addEventListener('click', () => mostrarAbaEsq(b.dataset.aba, true)));
  $$('[data-aba-dir]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-aba-dir]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-painel-dir]').forEach((p) => { p.hidden = p.dataset.painelDir !== b.dataset.abaDir; });
  }));
  let timerBusca;
  $('[data-busca]').addEventListener('input', (e) => { clearTimeout(timerBusca); timerBusca = setTimeout(() => buscar(e.target.value), 250); });
  async function buscar(q) {
    const lista = $('[data-resultados]');
    if (!q.trim()) { lista.innerHTML = ''; return; }
    try {
      const r = await obter(`/api/busca?q=${encodeURIComponent(q)}`);
      lista.innerHTML = r.resultados.length ? r.resultados.map((x) => `<li><a href="${rotaDe(x.rel)}" data-abrir="${esc(x.rel)}"><b>${esc(x.nome)}</b>${x.trechos.map((t) => `<small>…${esc(t.antes)}<mark>${esc(t.achado)}</mark>${esc(t.depois)}…</small>`).join('')}</a></li>`).join('') : '<li class="vazio">Nada encontrado.</li>';
    } catch (err) { avisar(err.message, true); }
  }
  function buscarTag(tag) { mostrarAbaEsq('busca'); $('[data-busca]').value = `tag:${tag}`; buscar(`tag:${tag}`); }
  function desenharTags() {
    $('[data-tags]').innerHTML = indice.tags.length ? indice.tags.map((t) => `<li><a href="#" data-tag-lista="${esc(t.tag)}"><span>#${esc(t.tag)}</span><small>${t.n}</small></a></li>`).join('') : '<li class="vazio">Nenhuma tag ainda. Escreva #algo numa nota.</li>';
  }
  $('[data-tags]').addEventListener('click', (e) => { const a = e.target.closest('[data-tag-lista]'); if (a) { e.preventDefault(); buscarTag(a.dataset.tagLista); } });

  // ---------- grafo ----------
  let pararGrafoFn = null;
  function pararGrafo() { pararGrafoFn?.(); pararGrafoFn = null; }
  async function abrirGrafo(historia = true) {
    await fecharAtual();
    if (historia) history.pushState(null, '', '/grafo');
    esconderAreas();
    $('[data-barra]').hidden = false; $('.modos').hidden = true;
    $('[data-migalha]').innerHTML = '<b>Grafo do cofre</b>'; mostrarEstado('', '');
    atual = { tipo: 'grafo' }; desenharArvore(); limparLateral();
    const areaG = $('[data-grafo-area]'); areaG.hidden = false;
    const cv = $('[data-grafo]');
    const ctx = cv.getContext('2d');
    const { nos, arestas } = await obter('/api/grafo');
    const pixel = corpo.classList.contains('tema-pixel');
    const css = getComputedStyle(corpo);
    const cor = (v) => css.getPropertyValue(v).trim();
    const mapa = new Map(nos.map((n, i) => [n.id, Object.assign(n, { x: Math.cos(i) * 200 + Math.random() * 40, y: Math.sin(i) * 200 + Math.random() * 40, vx: 0, vy: 0, grau: 0 })]));
    const ligs = arestas.map(([a, b]) => [mapa.get(a), mapa.get(b)]).filter(([a, b]) => a && b);
    ligs.forEach(([a, b]) => { a.grau++; b.grau++; });
    let zoom = 1, ox = 0, oy = 0, arrastoNo = null, arrastoTela = null, ativo = true, quente = 1;
    function tamanho() { const r = cv.getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
    tamanho();
    const aoRedim = () => tamanho(); addEventListener('resize', aoRedim);
    const raio = (n) => (n.fantasma ? 3 : 4 + Math.min(10, Math.sqrt(n.grau) * 2.2));
    function passo() {
      if (quente > 0.02) {
        const lista = [...mapa.values()];
        for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
          const a = lista[i], b = lista[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy || 0.01;
          if (d2 > 160000) continue; const f = 900 / d2; const d = Math.sqrt(d2); dx /= d; dy /= d;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
        for (const [a, b] of ligs) { const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 90) * 0.012; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
        for (const n of lista) { n.vx -= n.x * 0.002; n.vy -= n.y * 0.002; if (n !== arrastoNo) { n.x += n.vx * quente; n.y += n.vy * quente; } n.vx *= 0.6; n.vy *= 0.6; }
        quente *= 0.995;
      }
      const w = cv.clientWidth, h = cv.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.save(); ctx.translate(w / 2 + ox, h / 2 + oy); ctx.scale(zoom, zoom);
      ctx.strokeStyle = cor('--linha-forte'); ctx.lineWidth = 1 / zoom;
      for (const [a, b] of ligs) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      for (const n of mapa.values()) {
        const r = raio(n);
        ctx.fillStyle = n.fantasma ? cor('--cinza') : n.id === prefs.ultima ? cor('--ouro') : cor('--acento');
        if (pixel) ctx.fillRect(Math.round(n.x - r), Math.round(n.y - r), r * 2, r * 2); else { ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill(); }
        if (zoom > 0.6 || n.grau > 2) { ctx.fillStyle = n.fantasma ? cor('--cinza') : cor('--texto'); ctx.font = `${pixel ? 16 : 11}px ${pixel ? 'VT323' : 'system-ui'}`; ctx.textAlign = 'center'; ctx.fillText(n.nome, n.x, n.y + r + (pixel ? 14 : 12)); }
      }
      ctx.restore();
      if (ativo) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
    const noEm = (x, y) => { const r = cv.getBoundingClientRect(); const gx = (x - r.left - r.width / 2 - ox) / zoom, gy = (y - r.top - r.height / 2 - oy) / zoom; return [...mapa.values()].find((n) => (n.x - gx) ** 2 + (n.y - gy) ** 2 <= (raio(n) + 4) ** 2) || null; };
    let moveu = false;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); moveu = false; arrastoNo = noEm(e.clientX, e.clientY); arrastoTela = arrastoNo ? null : { x: e.clientX - ox, y: e.clientY - oy }; };
    cv.onpointermove = (e) => {
      if (arrastoNo) { moveu = true; const r = cv.getBoundingClientRect(); arrastoNo.x = (e.clientX - r.left - r.width / 2 - ox) / zoom; arrastoNo.y = (e.clientY - r.top - r.height / 2 - oy) / zoom; quente = Math.max(quente, 0.3); }
      else if (arrastoTela) { moveu = true; ox = e.clientX - arrastoTela.x; oy = e.clientY - arrastoTela.y; }
      else cv.style.cursor = noEm(e.clientX, e.clientY) ? 'pointer' : 'grab';
    };
    cv.onpointerup = (e) => { const n = arrastoNo; arrastoNo = null; arrastoTela = null; if (n && !moveu) { if (n.fantasma) criarNotaComNome(n.nome); else abrir(n.id); } };
    cv.onwheel = (e) => { e.preventDefault(); zoom = Math.max(0.2, Math.min(4, zoom * (e.deltaY < 0 ? 1.12 : 0.89))); };
    pararGrafoFn = () => { ativo = false; removeEventListener('resize', aoRedim); };
  }

  // ---------- laterais e comandos ----------
  function alternarLado(lado) {
    if (ehCelular()) { corpo.classList.toggle(lado === 'esquerda' ? 'mostrar-esquerda' : 'mostrar-direita'); return; }
    const classe = lado === 'esquerda' ? 'sem-esquerda' : 'sem-direita';
    corpo.classList.toggle(classe);
    salvarPrefs({ [lado]: !corpo.classList.contains(classe) });
  }
  async function sair() { await salvarAgora(); try { await api('/api/sair'); } catch {} location.href = '/entrar'; }
  const acoes = {
    'alternar-esquerda': () => alternarLado('esquerda'), 'alternar-direita': () => alternarLado('direita'),
    'abrir-rapido': abrirRapido, 'nova-nota': () => novaNota(pastaAtual()), 'nova-pasta': () => novaPasta(pastaAtual()),
    'novo-desenho': () => novoDesenho(pastaAtual()), diaria, grafo: () => abrirGrafo(),
    recolher: () => { abertas.clear(); salvarPrefs({ abertas: [] }); desenharArvore(); }, sair,
    mais: (b) => { const r = b.getBoundingClientRect(); if (atual?.rel) menuDoItem(atual.rel, atual.tipo, r.left - 160, r.bottom + 4); },
  };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b && acoes[b.dataset.cmd]) { e.preventDefault(); acoes[b.dataset.cmd](b); } });

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!modal.hidden) return;
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); abrirRapido(); }
    else if (ctrl && e.key.toLowerCase() === 'p') { e.preventDefault(); paleta(); }
    else if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); novaNota(pastaAtual()); }
    else if (ctrl && e.key.toLowerCase() === 'e' && atual?.tipo === 'nota') { e.preventDefault(); alternarModo(); }
    else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); salvarAgora(); desenhoAberto?.salvarAgora(); }
    else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); mostrarAbaEsq('busca', true); }
    else if (e.key === 'F2' && atual?.rel) { e.preventDefault(); renomear(atual.rel, atual.tipo); }
  });

  // ---------- rotas (/n/…, /d/…, /grafo) ----------
  function abrirPelaRota(historia = false) {
    const p = location.pathname;
    if (p === '/grafo') return abrirGrafo(historia);
    const m = /^\/(n|d)\/(.+)$/.exec(p);
    if (m) { let rel; try { rel = m[2].split('/').map(decodeURIComponent).join('/'); } catch { rel = null; } if (rel) return abrir(rel, { historia }); }
    if (prefs.ultima) return abrir(prefs.ultima, { historia: false }).catch(() => mostrarVazio());
    mostrarVazio();
  }
  addEventListener('popstate', () => abrirPelaRota(false));

  (async () => {
    try {
      prefs = await obter('/api/preferencias');
      abertas = new Set(prefs.abertas || []);
      await recarregar();
      abrirPelaRota(false);
    } catch (err) { avisar(err.message, true); }
  })();
})();

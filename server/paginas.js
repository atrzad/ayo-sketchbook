import { esc } from './markdown.js';
import { sprite } from './sprites.js';

function casca({ titulo, tema = 'pixel', corpo, classe = '', scripts = [] }) {
  const px = tema === 'pixel';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="${px ? 'dark' : 'light dark'}">
<title>${esc(titulo ? `${titulo} · Ayo Sketchbook` : 'Ayo Sketchbook')}</title>
<link rel="icon" href="/icone.svg" type="image/svg+xml">
${px ? '<link rel="stylesheet" href="/css/fontes.css">' : ''}
<link rel="stylesheet" href="/css/sketchbook.css">
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
</head>
<body class="${px ? 'tema-pixel' : 'tema-normal'} ${esc(classe)}">
${corpo}
<div id="aviso" role="status" aria-live="polite"></div>
</body>
</html>`;
}

export function paginaEntrar({ ayoStd }) {
  return casca({
    titulo: 'Entrar',
    classe: 'tela-entrar',
    scripts: ['/js/entrar.js'],
    corpo: `<main class="entrar">
      <div class="entrar-marca">${sprite('livro', { escala: 8 })}</div>
      <h1 class="titulo-gotico">Ayo Sketchbook</h1>
      <p class="sub">Notas, links e caneta</p>
      <form class="caixa form-entrar" novalidate>
        <p>Entre com a mesma conta do Ayo Std.</p>
        <label for="usuario">@usuário ou e-mail</label>
        <input id="usuario" name="usuario" autocomplete="username" required autofocus>
        <label for="senha">Senha</label>
        <input id="senha" name="senha" type="password" autocomplete="current-password" required>
        <p class="erro" data-erro hidden></p>
        <button class="btn btn-ouro" type="submit">Abrir o sketchbook</button>
        <p class="ajuda">Não tem conta? Ela é criada no <a href="${esc(ayoStd)}">Ayo Std</a>, por convite.</p>
      </form>
    </main>`,
  });
}

export function paginaApp({ usuario, ayoStd, prefs }) {
  const px = usuario.tema === 'pixel';
  const botao = (acao, rotulo, icone, extra = '') => `<button type="button" class="ico" data-cmd="${acao}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}"${extra}>${icone}</button>`;
  return casca({
    titulo: '',
    tema: usuario.tema,
    classe: `app-pg${prefs.esquerda === false ? ' sem-esquerda' : ''}${prefs.direita === false ? ' sem-direita' : ''}`,
    scripts: ['/js/desenho.js', '/js/app.js'],
    corpo: `
<header class="topo">
  ${botao('alternar-esquerda', 'Mostrar/ocultar a barra da esquerda', '☰')}
  <a class="marca" href="/">${px ? sprite('livro', { escala: 2 }) : ''}<span class="marca-nome">Ayo</span><span class="marca-sub">Sketchbook</span></a>
  <button type="button" class="busca-rapida" data-cmd="abrir-rapido">Abrir nota… <kbd>Ctrl O</kbd></button>
  <nav class="topo-acoes">
    <a class="lnk" href="${esc(ayoStd)}" title="Voltar ao Ayo Std">Ayo Std ↗</a>
    <span class="quem">@${esc(usuario.arroba)}</span>
    <button type="button" class="btn btn-pequeno" data-cmd="sair">Sair</button>
    ${botao('alternar-direita', 'Mostrar/ocultar a barra da direita', '◧')}
  </nav>
</header>
<div class="app" data-app data-usuario="${esc(usuario.arroba)}" data-modo="${esc(prefs.modo || 'dividir')}" data-ultima="${esc(prefs.ultima || '')}">
  <aside class="lado lado-esq" aria-label="Arquivos, busca e tags">
    <div class="abas-lado" role="tablist">
      <button type="button" role="tab" data-aba="arquivos" aria-selected="true">Arquivos</button>
      <button type="button" role="tab" data-aba="busca" aria-selected="false">Busca</button>
      <button type="button" role="tab" data-aba="tags" aria-selected="false">Tags</button>
    </div>
    <div class="ferr-lado">
      ${botao('nova-nota', 'Nova nota (Ctrl+N)', '＋')}
      ${botao('nova-pasta', 'Nova pasta', '▤')}
      ${botao('novo-desenho', 'Novo desenho', '✎')}
      ${botao('diaria', 'Nota do dia', '☀')}
      ${botao('grafo', 'Grafo', '⋈')}
      ${botao('recolher', 'Recolher pastas', '⇤')}
    </div>
    <div class="painel-lado" data-painel="arquivos"><ul class="arvore" data-arvore role="tree"></ul></div>
    <div class="painel-lado" data-painel="busca" hidden>
      <input type="search" class="campo-busca" data-busca placeholder="Buscar no cofre (tag:nome para tags)" aria-label="Buscar no cofre">
      <ul class="resultados" data-resultados></ul>
    </div>
    <div class="painel-lado" data-painel="tags" hidden><ul class="lista-tags" data-tags></ul></div>
  </aside>

  <main class="centro" data-centro>
    <div class="barra-nota" data-barra hidden>
      <nav class="caminho" data-migalha aria-label="Caminho"></nav>
      <span class="estado" data-estado role="status"></span>
      <div class="modos" role="group" aria-label="Modo de visualização">
        <button type="button" data-modo-btn="editar" title="Editar (Ctrl+E alterna)">Editar</button>
        <button type="button" data-modo-btn="dividir" title="Editar e ler lado a lado">Dividir</button>
        <button type="button" data-modo-btn="ler" title="Ler">Ler</button>
      </div>
      ${botao('mais', 'Mais ações', '⋯', ' data-menu-botao')}
    </div>
    <div class="vazio-centro" data-vazio>
      ${px ? sprite('livro', { escala: 6 }) : ''}
      <h1 class="titulo-gotico">Ayo Sketchbook</h1>
      <p>Abra uma nota na esquerda, aperte <kbd>Ctrl O</kbd> para procurar pelo nome ou comece uma nova.</p>
      <div class="acoes-vazio">
        <button type="button" class="btn btn-ouro" data-cmd="nova-nota">Nova nota</button>
        <button type="button" class="btn" data-cmd="novo-desenho">Novo desenho</button>
        <button type="button" class="btn" data-cmd="diaria">Nota do dia</button>
      </div>
    </div>
    <div class="editor" data-editor hidden>
      <textarea class="fonte" data-fonte spellcheck="true" aria-label="Texto da nota em Markdown"></textarea>
      <article class="leitura nota" data-leitura aria-label="Nota renderizada"></article>
    </div>
    <div class="desenho-area" data-desenho-area hidden></div>
    <div class="grafo-area" data-grafo-area hidden><canvas data-grafo aria-label="Grafo das notas"></canvas><p class="ajuda">Arraste para mover, use a roda do mouse ou pinça para aproximar, clique numa nota para abrir.</p></div>
    <div class="imagem-area" data-imagem-area hidden></div>
  </main>

  <aside class="lado lado-dir" aria-label="Links, sumário e propriedades">
    <div class="abas-lado" role="tablist">
      <button type="button" role="tab" data-aba-dir="links" aria-selected="true">Links</button>
      <button type="button" role="tab" data-aba-dir="sumario" aria-selected="false">Sumário</button>
      <button type="button" role="tab" data-aba-dir="props" aria-selected="false">Propriedades</button>
    </div>
    <div class="painel-lado" data-painel-dir="links"><h3>Links para esta nota</h3><ul class="backlinks" data-backlinks><li class="vazio">Abra uma nota.</li></ul><h3>Links que saem</h3><ul class="backlinks" data-saidas></ul></div>
    <div class="painel-lado" data-painel-dir="sumario" hidden><ol class="sumario" data-sumario></ol></div>
    <div class="painel-lado" data-painel-dir="props" hidden><dl class="props" data-props></dl></div>
  </aside>
</div>

<div class="modal" data-modal hidden>
  <div class="modal-caixa caixa" role="dialog" aria-modal="true" aria-label="Busca rápida">
    <input class="modal-campo" data-modal-campo autocomplete="off" spellcheck="false">
    <ul class="modal-lista" data-modal-lista role="listbox"></ul>
    <p class="modal-dica" data-modal-dica></p>
  </div>
</div>
<ul class="menu-flutuante caixa" data-menu hidden role="menu"></ul>
<ul class="autocompletar caixa" data-auto hidden role="listbox"></ul>`,
  });
}

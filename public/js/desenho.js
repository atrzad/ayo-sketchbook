// Ayo Sketchbook: editor de desenho (estilo Samsung Notes).
// window.AyoDesenho.abrir(area, rel, {api, avisar, aoSalvar}) monta a folha; devolve {fechar, salvarAgora, sujo}.
(() => {
  const LARGURA = 1000;
  const PAGINA = 1400;
  const LINHA = 44;
  const TINTAS = ['#1d1d1f', '#1f4fbf', '#c0392b', '#2e7d32', '#7b3fb5', '#b8860b', '#e2722b', '#ffffff'];
  const MARCAS = ['#ffd54f', '#a5e887', '#ff9ec4', '#8fd3ff'];

  function abrir(area, rel, { api, avisar, aoSalvar }) {
    let hash = null;
    let desenho = { v: 1, fundo: 'pautado', altura: PAGINA, imagens: [], tracos: [] };
    let escala = 1;
    let ferramenta = 'caneta';
    const cor = { caneta: TINTAS[0], lapis: '#5b5b5b', marca: MARCAS[0] };
    let espessura = 3.5;
    let soCaneta = false;
    try { soCaneta = localStorage.getItem('ayo-so-caneta') === 'sim'; } catch {}
    let sujo = false;
    let salvando = false;
    let timer = null;
    let fechado = false;
    const imgs = new Map(); // caminho -> HTMLImageElement carregado

    area.innerHTML = `
      <div class="dz-barra" role="toolbar" aria-label="Ferramentas de desenho">
        <div class="dz-grupo" data-g="ferramenta">
          <button type="button" data-f="caneta" aria-pressed="true">Caneta</button>
          <button type="button" data-f="lapis" aria-pressed="false">Lápis</button>
          <button type="button" data-f="marca" aria-pressed="false">Marca-texto</button>
          <button type="button" data-f="borracha" aria-pressed="false">Borracha</button>
          <button type="button" data-f="mover" aria-pressed="false" title="Mover imagens">Mover</button>
        </div>
        <div class="dz-grupo" data-g="cores"></div>
        <div class="dz-grupo" data-g="espessura">
          <button type="button" data-e="2" aria-pressed="false">Fino</button>
          <button type="button" data-e="3.5" aria-pressed="true">Médio</button>
          <button type="button" data-e="7" aria-pressed="false">Grosso</button>
        </div>
        <div class="dz-grupo" data-g="fundo">
          <button type="button" data-fundo="pautado">Pautado</button><button type="button" data-fundo="quadriculado">Quadric.</button>
          <button type="button" data-fundo="pontilhado">Pontos</button><button type="button" data-fundo="liso">Liso</button>
        </div>
        <div class="dz-grupo">
          <button type="button" data-a="desfazer" title="Ctrl+Z">↶</button><button type="button" data-a="refazer" title="Ctrl+Shift+Z">↷</button>
          <button type="button" data-a="pagina">+ Página</button><button type="button" data-a="imagem">+ Imagem</button>
          <button type="button" data-a="png">PNG</button><button type="button" data-a="limpar">Limpar</button>
        </div>
        <label class="dz-grupo"><input type="checkbox" data-so-caneta${soCaneta ? ' checked' : ''}> Só caneta</label>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-arquivo hidden>
      </div>
      <div class="dz-folha pautado" data-folha><canvas data-canvas aria-label="Folha de desenho"></canvas></div>`;
    const $ = (s) => area.querySelector(s);
    const $$ = (s) => [...area.querySelectorAll(s)];
    const folha = $('[data-folha]');
    const canvas = $('[data-canvas]');
    const ctx = canvas.getContext('2d');

    function pintarCores() {
      const lista = ferramenta === 'marca' ? MARCAS : ferramenta === 'lapis' ? ['#5b5b5b', '#1d1d1f', '#8a6238'] : TINTAS;
      const g = $('[data-g="cores"]');
      g.innerHTML = lista.map((c) => `<button type="button" class="dz-cor" data-cor="${c}" aria-label="Cor ${c}" aria-pressed="${c === cor[ferramenta] ? 'true' : 'false'}"></button>`).join('');
      g.querySelectorAll('.dz-cor').forEach((b) => { b.style.background = b.dataset.cor; });
      g.hidden = ferramenta === 'borracha' || ferramenta === 'mover';
    }

    function ajustar() {
      const largura = folha.clientWidth || LARGURA;
      escala = largura / LARGURA;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.style.width = `${largura}px`;
      canvas.style.height = `${desenho.altura * escala}px`;
      canvas.width = Math.round(largura * dpr);
      canvas.height = Math.round(desenho.altura * escala * dpr);
      folha.style.setProperty('--linha-folha', `${LINHA * escala}px`);
      ctx.setTransform(dpr * escala, 0, 0, dpr * escala, 0, 0);
      redesenhar();
    }

    const largura = (t, p) => (t.f === 'marca' ? t.w : t.f === 'lapis' ? t.w * (0.5 + 0.8 * p) : t.w * (0.35 + 1.3 * p));
    function estilo(c, t) {
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = t.c; c.fillStyle = t.c;
      c.globalAlpha = t.f === 'marca' ? 0.4 : t.f === 'lapis' ? 0.75 : 1;
      c.globalCompositeOperation = t.f === 'marca' ? 'multiply' : 'source-over';
    }
    function trecho(c, t, i) {
      const p = t.p;
      const x0 = p[i - 3], y0 = p[i - 2], x1 = p[i], y1 = p[i + 1];
      const xa = i >= 6 ? (p[i - 6] + x0) / 2 : x0, ya = i >= 6 ? (p[i - 5] + y0) / 2 : y0;
      c.lineWidth = largura(t, (p[i - 1] + p[i + 2]) / 2);
      c.beginPath(); c.moveTo(xa, ya); c.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); c.stroke();
    }
    function desenharTraco(c, t) {
      c.save(); estilo(c, t);
      const p = t.p;
      if (p.length === 3) { c.beginPath(); c.arc(p[0], p[1], largura(t, p[2]) / 2, 0, Math.PI * 2); c.fill(); }
      else if (t.f === 'marca') { c.lineWidth = t.w; c.beginPath(); c.moveTo(p[0], p[1]); for (let i = 3; i < p.length; i += 3) c.lineTo(p[i], p[i + 1]); c.stroke(); }
      else {
        for (let i = 3; i < p.length; i += 3) trecho(c, t, i);
        const n = p.length;
        c.lineWidth = largura(t, p[n - 1]); c.beginPath(); c.moveTo((p[n - 6] + p[n - 3]) / 2, (p[n - 5] + p[n - 2]) / 2); c.lineTo(p[n - 3], p[n - 2]); c.stroke();
      }
      c.restore();
    }
    function desenharImagens(c) {
      for (const im of desenho.imagens) {
        const el = imgs.get(im.c);
        if (el?.complete && el.naturalWidth) c.drawImage(el, im.x, im.y, im.w, im.h);
      }
    }
    let selecionada = null;
    function redesenhar() {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
      desenharImagens(ctx);
      desenho.tracos.forEach((t) => desenharTraco(ctx, t));
      if (selecionada) { ctx.save(); ctx.strokeStyle = '#e2722b'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeRect(selecionada.x, selecionada.y, selecionada.w, selecionada.h); ctx.restore(); }
    }
    function carregarImagem(c) {
      if (imgs.has(c)) return;
      const el = new Image();
      el.onload = () => redesenhar();
      el.src = `/arquivo/${c.split('/').map(encodeURIComponent).join('/')}`;
      imgs.set(c, el);
    }

    // ---------- desfazer ----------
    const desfazer = [], refazer = [];
    const foto = () => ({ tracos: desenho.tracos.slice(), imagens: desenho.imagens.map((i) => ({ ...i })), altura: desenho.altura });
    function registrar() { desfazer.push(foto()); if (desfazer.length > 150) desfazer.shift(); refazer.length = 0; }
    function aplicar(f) { desenho.tracos = f.tracos; desenho.imagens = f.imagens; desenho.altura = f.altura; ajustar(); mudou(); }

    // ---------- salvar (JSON + prévia PNG para o Obsidian) ----------
    function mudou(atraso = 1800) { sujo = true; aoSalvar?.('sujo'); clearTimeout(timer); timer = setTimeout(salvar, atraso); }
    function gerarPNG() {
      const ultimo = desenho.tracos.reduce((m, t) => { for (let i = 1; i < t.p.length; i += 3) m = Math.max(m, t.p[i]); return m; }, 0);
      const fimImg = desenho.imagens.reduce((m, im) => Math.max(m, im.y + im.h), 0);
      const altura = Math.min(desenho.altura, Math.max(300, Math.ceil(Math.max(ultimo, fimImg) + 60)));
      const off = document.createElement('canvas');
      off.width = LARGURA; off.height = altura;
      const c = off.getContext('2d');
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, LARGURA, altura);
      try { desenharImagens(c); } catch {}
      desenho.tracos.forEach((t) => desenharTraco(c, t));
      try { return off.toDataURL('image/png'); } catch { return null; }
    }
    async function salvar() {
      if (!sujo || fechado && !sujo) return;
      if (salvando) { clearTimeout(timer); timer = setTimeout(salvar, 500); return; }
      salvando = true; sujo = false; aoSalvar?.('salvando');
      try {
        const r = await api('/api/desenho', { c: rel, desenho, hash, png: gerarPNG() });
        hash = r.hash;
        if (!sujo) aoSalvar?.('salvo');
      } catch (err) {
        if (err.status === 409) { aoSalvar?.('erro'); avisar('Este desenho mudou em outra aba. Recarregue para continuar.', true); }
        else { sujo = true; aoSalvar?.('erro'); clearTimeout(timer); timer = setTimeout(salvar, 5000); }
      } finally { salvando = false; }
    }

    // ---------- caneta ----------
    let atual = null, ponteiro = null, apagando = false, apagou = false, rolagem = null, canetaVista = false, arrasto = null;
    function ponto(e) {
      const r = canvas.getBoundingClientRect();
      return [Math.round(((e.clientX - r.left) / escala) * 10) / 10, Math.round(((e.clientY - r.top) / escala) * 10) / 10,
        e.pointerType === 'pen' ? Math.round(Math.max(0.05, e.pressure || 0.5) * 100) / 100 : 0.5];
    }
    function apagarEm(x, y) {
      const raio = 14 / Math.max(escala, 0.4);
      const antes = desenho.tracos.length;
      const restam = desenho.tracos.filter((t) => {
        for (let i = 0; i < t.p.length; i += 3) { const dx = t.p[i] - x, dy = t.p[i + 1] - y; if (dx * dx + dy * dy <= (raio + largura(t, t.p[i + 2]) / 2) ** 2) return false; }
        return true;
      });
      if (restam.length !== antes) { if (!apagou) { registrar(); apagou = true; } desenho.tracos = restam; redesenhar(); }
    }
    const imagemEm = (x, y) => [...desenho.imagens].reverse().find((im) => x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h) || null;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen' && !canetaVista) {
        canetaVista = true;
        if (!soCaneta) { soCaneta = true; $('[data-so-caneta]').checked = true; try { localStorage.setItem('ayo-so-caneta', 'sim'); } catch {} avisar('Caneta detectada: só ela desenha, o dedo rola a página.'); }
      }
      if (e.pointerType === 'touch' && (soCaneta || ponteiro !== null)) { rolagem = { id: e.pointerId, y: e.clientY }; return; }
      if (ponteiro !== null || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 5)) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      ponteiro = e.pointerId;
      const [x, y, p] = ponto(e);
      if (ferramenta === 'mover') {
        const im = imagemEm(x, y);
        selecionada = im;
        if (im) { registrar(); arrasto = { im, dx: x - im.x, dy: y - im.y }; }
        redesenhar();
        return;
      }
      apagando = ferramenta === 'borracha' || e.button === 5 || (e.buttons & 32) === 32;
      if (apagando) { apagou = false; apagarEm(x, y); return; }
      atual = { f: ferramenta, c: cor[ferramenta], w: ferramenta === 'marca' ? 22 : ferramenta === 'lapis' ? Math.max(1.2, espessura * 0.6) : espessura, p: [x, y, p] };
      ctx.save(); estilo(ctx, atual); ctx.beginPath(); ctx.arc(x, y, largura(atual, p) / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (rolagem && e.pointerId === rolagem.id) { area.scrollBy(0, rolagem.y - e.clientY); rolagem.y = e.clientY; return; }
      if (e.pointerId !== ponteiro) return;
      if (arrasto) { const [x, y] = ponto(e); arrasto.im.x = Math.round(x - arrasto.dx); arrasto.im.y = Math.round(y - arrasto.dy); redesenhar(); return; }
      const lista = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (lista.length ? lista : [e])) {
        const [x, y, p] = ponto(ev);
        if (apagando) { apagarEm(x, y); continue; }
        if (!atual) continue;
        const q = atual.p, n = q.length;
        if (Math.abs(q[n - 3] - x) + Math.abs(q[n - 2] - y) < 0.8) continue;
        q.push(x, y, p);
        ctx.save(); estilo(ctx, atual);
        if (atual.f === 'marca') { ctx.lineWidth = atual.w; ctx.beginPath(); ctx.moveTo(q[n - 3], q[n - 2]); ctx.lineTo(x, y); ctx.stroke(); } else trecho(ctx, atual, q.length - 3);
        ctx.restore();
      }
    });
    function fim(e) {
      if (rolagem && e.pointerId === rolagem.id) { rolagem = null; return; }
      if (e.pointerId !== ponteiro) return;
      ponteiro = null;
      if (arrasto) { arrasto = null; mudou(); return; }
      if (apagando) { apagando = false; if (apagou) { redesenhar(); mudou(); } return; }
      if (atual) { registrar(); desenho.tracos = desenho.tracos.concat([atual]); atual = null; redesenhar(); mudou(); }
    }
    canvas.addEventListener('pointerup', fim);
    canvas.addEventListener('pointercancel', fim);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---------- barra ----------
    area.querySelector('.dz-barra').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.f) {
        ferramenta = b.dataset.f;
        $$('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        folha.classList.toggle('apagando', ferramenta === 'borracha');
        folha.classList.toggle('selecionando', ferramenta === 'mover');
        if (ferramenta !== 'mover') { selecionada = null; redesenhar(); }
        pintarCores();
      } else if (b.dataset.cor) {
        cor[ferramenta] = b.dataset.cor; pintarCores();
      } else if (b.dataset.e) {
        espessura = Number(b.dataset.e); $$('[data-e]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      } else if (b.dataset.fundo) {
        registrar(); desenho.fundo = b.dataset.fundo; aplicarFundo(); mudou(800);
      } else if (b.dataset.a === 'desfazer' && desfazer.length) { refazer.push(foto()); aplicar(desfazer.pop()); }
      else if (b.dataset.a === 'refazer' && refazer.length) { desfazer.push(foto()); aplicar(refazer.pop()); }
      else if (b.dataset.a === 'pagina') {
        if (desenho.altura >= PAGINA * 30) return avisar('Limite de 30 páginas.', true);
        registrar(); desenho.altura += PAGINA; ajustar(); mudou(800);
      } else if (b.dataset.a === 'imagem') $('[data-arquivo]').click();
      else if (b.dataset.a === 'png') {
        const url = gerarPNG();
        if (!url) return avisar('Não deu para gerar a imagem.', true);
        const a = document.createElement('a'); a.href = url; a.download = rel.split('/').pop().replace(/\.sketch\.json$/i, '.png'); a.click();
      } else if (b.dataset.a === 'limpar') {
        if (!b.classList.contains('confirmar')) { b.classList.add('confirmar'); b.textContent = 'Confirmar?'; setTimeout(() => { b.classList.remove('confirmar'); b.textContent = 'Limpar'; }, 4000); return; }
        b.classList.remove('confirmar'); b.textContent = 'Limpar';
        registrar(); desenho.tracos = []; desenho.imagens = []; redesenhar(); mudou(800);
      }
    });
    $('[data-so-caneta]').addEventListener('change', (e) => { soCaneta = e.target.checked; try { localStorage.setItem('ayo-so-caneta', soCaneta ? 'sim' : 'nao'); } catch {} });

    // imagem para anotar por cima: sobe como anexo do cofre e entra na folha
    $('[data-arquivo]').addEventListener('change', async (e) => {
      const arq = e.target.files[0];
      e.target.value = '';
      if (!arq) return;
      try {
        const r = await fetch(`/api/anexo?nome=${encodeURIComponent(arq.name)}`, { method: 'POST', headers: { 'Content-Type': arq.type, 'X-Ayo': '1' }, body: arq });
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || 'Falha no envio.');
        const el = new Image();
        el.onload = () => {
          const w = Math.min(900, el.naturalWidth);
          const h = Math.round((el.naturalHeight / el.naturalWidth) * w);
          const topo = Math.max(20, Math.round(area.scrollTop / escala) + 20);
          registrar();
          desenho.imagens.push({ c: j.c, x: 50, y: topo, w, h });
          if (topo + h > desenho.altura) desenho.altura = Math.ceil((topo + h) / PAGINA) * PAGINA;
          imgs.set(j.c, el);
          ajustar(); mudou(500);
          avisar('Imagem inserida. Use “Mover” para posicionar.');
        };
        el.src = `/arquivo/${j.c.split('/').map(encodeURIComponent).join('/')}`;
      } catch (err) { avisar(err.message, true); }
    });

    function aplicarFundo() {
      folha.classList.remove('pautado', 'quadriculado', 'pontilhado', 'liso');
      folha.classList.add(desenho.fundo || 'pautado');
      $$('[data-fundo]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.fundo === desenho.fundo)));
    }

    const teclas = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      e.preventDefault();
      area.querySelector(`[data-a="${e.shiftKey ? 'refazer' : 'desfazer'}"]`).click();
    };
    document.addEventListener('keydown', teclas);
    const aoRedimensionar = () => ajustar();
    window.addEventListener('resize', aoRedimensionar);

    (async () => {
      try {
        const r = await fetch(`/api/desenho?c=${encodeURIComponent(rel)}`, { credentials: 'same-origin' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || 'Não deu para abrir o desenho.');
        hash = j.hash;
        desenho = { v: 1, fundo: j.desenho.fundo || 'pautado', altura: j.desenho.altura || PAGINA, imagens: j.desenho.imagens || [], tracos: j.desenho.tracos || [] };
        desenho.imagens.forEach((im) => carregarImagem(im.c));
        aplicarFundo(); pintarCores(); ajustar(); aoSalvar?.('salvo');
      } catch (err) { avisar(err.message, true); }
    })();

    return {
      get sujo() { return sujo || salvando; },
      salvarAgora: () => { clearTimeout(timer); return salvar(); },
      fechar: async () => {
        clearTimeout(timer);
        if (sujo) await salvar();
        fechado = true;
        document.removeEventListener('keydown', teclas);
        window.removeEventListener('resize', aoRedimensionar);
        area.innerHTML = '';
      },
    };
  }

  window.AyoDesenho = { abrir };
})();

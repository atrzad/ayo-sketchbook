(() => {
  const form = document.querySelector('.form-entrar');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = form.querySelector('[data-erro]');
    const botao = form.querySelector('button[type="submit"]');
    erro.hidden = true; botao.disabled = true;
    try {
      const r = await fetch('/api/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ayo': '1' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não deu para entrar.');
      location.href = '/';
    } catch (err) { erro.textContent = err.message; erro.hidden = false; botao.disabled = false; }
  });
})();

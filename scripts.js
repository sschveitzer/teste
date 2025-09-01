// Utilitários
const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
const money = v => (new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})).format(v||0);

// Estado e preferências (persistência simples em localStorage)
const S = {
  hide: false,
  dark: true,
  cats: [],
  recs: [],
  tx: []
};

function loadPrefs(){
  try {
    const p = JSON.parse(localStorage.getItem('prefs') || '{}');
    S.hide = !!p.hide;
    S.dark = p.dark !== false; // default true
  } catch {}
  document.body.classList.toggle('dark', S.dark);
  document.body.classList.toggle('hide-values', S.hide);
  const d = qs('#cfgDark'); if (d) d.checked = S.dark;
  const h = qs('#cfgHide'); if (h) h.checked = S.hide;
}

async function savePrefs(){
  localStorage.setItem('prefs', JSON.stringify({ hide:S.hide, dark:S.dark }));
}

// Tabs simples (inclusive para #config que não está nas tabs visuais)
function setTab(name){
  qsa('section').forEach(s => s.classList.remove('active'));
  const sec = qs('#'+name);
  if (sec) sec.classList.add('active');
  // marca tab ativa se existir
  qsa('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  if (name === 'config') wireConfigPanel();
}

// Renderizações
function renderKPIs(){
  qs('#kpiReceitas').textContent = money(0);
  qs('#kpiDespesas').textContent = money(0);
  qs('#kpiSaldo').textContent = money(0);
}

function renderRecentes(){
  const ul = qs('#listaRecentes'); if (!ul) return;
  ul.innerHTML = '';
  // placeholder
  const li = document.createElement('li'); li.className='item';
  li.innerHTML = '<div class="left"><strong>Nenhum lançamento recente</strong></div>';
  ul.appendChild(li);
}

function renderLancamentos(){
  const ul = qs('#listaLanc'); if (!ul) return;
  ul.innerHTML = '';
  // placeholder
  const li = document.createElement('li'); li.className='item';
  li.innerHTML = '<div><div class="chip">Exemplo</div><div class="money">R$ 0,00</div></div>';
  ul.appendChild(li);
}

function renderCategorias(){
  const ul = qs('#listaCats'); if (!ul) return;
  ul.innerHTML = '';
  if (!S.cats.length){
    const li = document.createElement('li'); li.className='item';
    li.innerHTML = '<div class="left"><strong>Nenhuma categoria</strong><div class="muted">Adicione uma no campo acima.</div></div>';
    ul.appendChild(li);
    return;
  }
  S.cats.slice().sort((a,b)=>a.localeCompare(b)).forEach(nome => {
    const li = document.createElement('li'); li.className='item';
    const left = document.createElement('div'); left.className='left';
    const strong = document.createElement('strong'); strong.textContent = nome; left.appendChild(strong);

    const right = document.createElement('div');
    const btn = document.createElement('button'); btn.className='icon del'; btn.title='Excluir';
    btn.innerHTML = '<i class="ph ph-trash"></i>';
    btn.addEventListener('click', () => {
      if (!confirm('Excluir categoria?')) return;
      S.cats = S.cats.filter(c => c !== nome);
      localStorage.setItem('cats', JSON.stringify(S.cats));
      renderCategorias();
    });
    right.appendChild(btn);

    li.appendChild(left); li.appendChild(right);
    ul.appendChild(li);
  });
}

function renderRecorrentes(){
  const ul = qs('#listaRecorrentes'); if (!ul) return;
  ul.innerHTML = '';
  if (!S.recs.length){
    const li = document.createElement('li'); li.className='item';
    li.innerHTML = '<div class="left"><strong>Nenhuma recorrência</strong><div class="muted">Crie um lançamento e marque “Repetir”.</div></div>';
    ul.appendChild(li);
    return;
  }
  S.recs.forEach(r => {
    const li = document.createElement('li'); li.className='item';
    li.innerHTML = `<div class="left"><strong>${r.descricao||'(sem descrição)'}</strong><div class="muted">${r.tipo||''} • ${r.categoria||''}</div></div>`;
    ul.appendChild(li);
  });
}

function render(){
  document.body.classList.toggle('hide-values', S.hide);
  renderKPIs();
  renderRecentes();
  renderLancamentos();
  renderCategorias();
  renderRecorrentes();
}

// Config: fios e ações
function wireConfigPanel(){
  const d = qs('#cfgDark'), h = qs('#cfgHide');
  if (d) d.checked = S.dark;
  if (h) h.checked = S.hide;
}

// Inicialização
window.onload = async () => {
  // Carregar estado
  try { S.cats = JSON.parse(localStorage.getItem('cats')||'[]') } catch {}
  try { S.recs = JSON.parse(localStorage.getItem('recs')||'[]') } catch {}
  loadPrefs();

  // Tabs (Dashboard, Lançamentos, Relatórios)
  qsa('.tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  // Engrenagem abre Config
  const btnConfigTop = qs('#btnConfig');
  if (btnConfigTop) btnConfigTop.addEventListener('click', () => setTab('config'));

  // Aparência: delegação (sobrevive a re-renders)
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t) return;
    if (t.matches('#cfgDark')) {
      S.dark = !!t.checked;
      document.body.classList.toggle('dark', S.dark);
      await savePrefs();
    }
    if (t.matches('#cfgHide')) {
      S.hide = !!t.checked;
      render();
      await savePrefs();
    }
  });

  // Categorias: adicionar
  const addBtn = qs('#addCat');
  const inputCat = qs('#newCatName');
  if (addBtn && inputCat){
    addBtn.addEventListener('click', () => {
      const name = (inputCat.value||'').trim();
      if (!name) return;
      if (!S.cats.includes(name)) {
        S.cats.push(name);
        localStorage.setItem('cats', JSON.stringify(S.cats));
        inputCat.value = '';
        renderCategorias();
      }
    });
    inputCat.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn.click();
    });
  }

  // START
  render();
};

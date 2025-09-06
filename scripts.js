
// ===== Helpers =====
const qs  = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);

(function(){
  // Prefer the client provided by the page
  const supabaseClient = (typeof window !== 'undefined' && (window.supabaseClient || window.supabase)) || null;

  // ===== Global state =====
  let S = {
    tx: [],
    cats: [],
    month: new Date().toISOString().slice(0,7), // YYYY-MM
    hide: false,
    dark: false,
    useCycleForReports: true,
    editingId: null,
    ccDueDay: null,
    ccClosingDay: null
  };
  window.S = S; // expose for debugging

  // ===== Utils =====
  const br = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
  const fmtMoney = (v) => br.format(Number(v||0));
  const nowYMD = () => new Date().toISOString().slice(0,10);
  const toYMD = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s||""));
  const gid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const parseMoneyMasked = (s) => {
    if (!s) return 0;
    // strip non-digits except comma/dot
    s = String(s).replace(/\./g, '').replace(',', '.');
    const n = Number(s.replace(/[^\d.]/g, ''));
    return isFinite(n) ? n : 0;
  };

  // ===== Persistence (Supabase optional) =====
  async function fetchTx() {
    if (!supabaseClient) return S.tx || [];
    const { data, error } = await supabaseClient.from('transactions').select('*').order('data', { ascending: false });
    if (error) { console.warn('fetchTx error', error); return S.tx || []; }
    return data || [];
  }
  async function fetchCats() {
    if (!supabaseClient) return S.cats || [];
    const { data, error } = await supabaseClient.from('categories').select('*').order('nome');
    if (error) { console.warn('fetchCats error', error); return S.cats || []; }
    return data || [];
  }
  async function saveTx(t) {
    if (!supabaseClient) {
      // local fallback (in-memory only for this session)
      const idx = (S.tx||[]).findIndex(x => x.id === t.id);
      if (idx >= 0) S.tx[idx] = t; else S.tx.unshift(t);
      return { data: t };
    }
    if (S.editingId) {
      const { data, error } = await supabaseClient.from('transactions').update(t).eq('id', t.id).select();
      if (error) throw error;
      return { data };
    } else {
      const { data, error } = await supabaseClient.from('transactions').insert(t).select();
      if (error) throw error;
      return { data };
    }
  }
  async function deleteTx(id) {
    if (!supabaseClient) {
      S.tx = (S.tx||[]).filter(x => x.id !== id);
      return { data: { id } };
    }
    return await supabaseClient.from('transactions').delete().eq('id', id);
  }

  // ===== Prefs (localStorage) =====
  function loadPrefs(){
    try{
      const raw = localStorage.getItem('prefs');
      if (!raw) return;
      const p = JSON.parse(raw);
      Object.assign(S, {
        hide: !!p.hide,
        dark: !!p.dark,
        useCycleForReports: p.useCycleForReports !== false,
        ccDueDay: p.ccDueDay ?? null,
        ccClosingDay: p.ccClosingDay ?? null,
      });
      document.body.classList.toggle('dark', S.dark);
    }catch(e){ console.warn('loadPrefs', e); }
  }
  async function savePrefs(){
    try{
      const p = {
        hide: !!S.hide,
        dark: !!S.dark,
        useCycleForReports: !!S.useCycleForReports,
        ccDueDay: S.ccDueDay ?? null,
        ccClosingDay: S.ccClosingDay ?? null,
      };
      localStorage.setItem('prefs', JSON.stringify(p));
    }catch(e){ console.warn('savePrefs', e); }
  }

  // ===== Modal & mask =====
  let modalTipo = 'Despesa';
  function syncTipoTabs(){
    qsa('#tipoTabs button').forEach(b => {
      const on = b.dataset.type === modalTipo;
      b.classList.toggle('active', on);
    });
    const lbl = qs('#modalTitle');
    if (lbl) lbl.textContent = modalTipo;
  }

  function toggleModal(show){
    const modal = qs('#modalLanc');
    if (!modal) return;
    modal.classList.toggle('open', !!show);
    if (show){
      window.resetValorInput && window.resetValorInput();
      qs('#mCategoria') && (qs('#mCategoria').selectedIndex = 0);
      if (qs('#mData')) qs('#mData').value = nowYMD();
      if (qs('#mDesc')) qs('#mDesc').value = '';
      if (qs('#mObs')) qs('#mObs').value = '';
      setTimeout(()=> qs('#mValorBig')?.focus(), 10);
      S.editingId = null;
      modalTipo = 'Despesa';
      syncTipoTabs();
    }
  }
  window.toggleModal = toggleModal;

  // Mask for #mValorBig
  (function enhanceModalUX(){
    const valorInput = document.getElementById('mValorBig');
    let rawCents = 0;
    const fmt = () => { if (valorInput) valorInput.value = rawCents ? br.format(rawCents/100) : ''; };
    window.resetValorInput = function(){
      rawCents = 0;
      if (valorInput) valorInput.value = '';
    };
    if (!valorInput) return;
    valorInput.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'deleteContentBackward') {
        rawCents = Math.floor(rawCents/10);
        fmt(); return;
      }
      const d = String(e.data || '').replace(/\D/g,'');
      if (!d) return;
      rawCents = Math.min(9999999999, rawCents*10 + Number(d));
      fmt();
      e.preventDefault();
    });
    valorInput.addEventListener('focus', () => {
      if (!valorInput.value) fmt();
      setTimeout(()=>{
        const len = valorInput.value.length;
        valorInput.setSelectionRange(len,len);
      },0);
    });
  })();

  // ===== Add / Update =====
  async function addOrUpdate(keepOpen=false){
    const valor = parseMoneyMasked(qs('#mValorBig')?.value);
    const t = {
      id: S.editingId || gid(),
      tipo: modalTipo,
      categoria: qs('#mCategoria')?.value || '',
      data: isIsoDate(qs('#mData')?.value) ? qs('#mData').value : nowYMD(),
      descricao: (qs('#mDesc')?.value || '').trim(),
      valor: isFinite(valor) ? valor : 0,
      obs: (qs('#mObs')?.value || '').trim()
    };
    if (!t.categoria) return alert('Selecione categoria');
    if (!t.descricao) return alert('Descrição obrigatória');
    if (!(t.valor > 0)) return alert('Informe o valor');

    await saveTx(t);
    await loadAll();
    if (window.resetValorInput) window.resetValorInput();
    if (!keepOpen) return toggleModal(false);
    return;
  }
  try { window.addOrUpdate = addOrUpdate; } catch(e){}

  // ===== Delete =====
  async function delTx(id){
    try { window.delTx = delTx; } catch(e){}
    try {
      if (!id) return;
      if (!confirm('Excluir lançamento?')) return;
      const resp = await deleteTx(id);
      const err = resp?.error || resp?.data?.error;
      if (err) return alert('Não foi possível excluir: ' + (err.message || err));
      await loadAll();
    } catch(e){
      alert('Falha ao excluir: ' + (e?.message || e));
    }
  }

  // ===== Render =====
  function itemTx(x, readOnly=false){
    const li = document.createElement('li');
    li.className = 'item';
    const v = isFinite(Number(x.valor)) ? Number(x.valor) : 0;
    const actions = readOnly ? "" : `
      <button class="icon edit" title="Editar"><i class="ph ph-pencil-simple"></i></button>
      <button class="icon del" title="Excluir"><i class="ph ph-trash"></i></button>`;
    li.innerHTML = `
      <div class="left">
        <div class="tag">${x.tipo||'-'}</div>
        <div>
          <div><strong>${x.descricao || "-"}</strong></div>
          <div class="muted" style="font-size:12px">${x.categoria || "-"} • ${x.data || "-"}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <div class="${S.hide ? "blurred" : ""}" style="font-weight:700">${fmtMoney(v)}</div>${actions}
      </div>`;
    if (!readOnly){
      const btnEdit = li.querySelector('.edit');
      const btnDel  = li.querySelector('.del');
      if (btnEdit) btnEdit.onclick = () => {/* open edit not implemented here */};
      if (btnDel)  btnDel.onclick  = () => delTx(x.id);
    }
    return li;
  }

  function renderRecentes(){
    const ul = qs('#listaRecentes');
    if (!ul) return;
    const list = (S.tx||[]).filter(x=>x.tipo==='Despesa').sort((a,b)=>String(b.data||'').localeCompare(String(a.data||''))).slice(0,8);
    ul.innerHTML = '';
    list.forEach(x => ul.append(itemTx(x, true)));
  }

  function renderLancamentos(){
    const ul = qs('#listaLanc');
    const sumEl = qs('#lancSummary');
    if (sumEl){
      sumEl.innerHTML = '';
      const pill = (txt, cls='')=>{ const s=document.createElement('span'); s.className=`pill ${cls}`; s.textContent=txt; return s; };
      const list = (S.tx||[]).slice();
      const fmt = (n)=>fmtMoney(n);
      const totDesp = list.filter(x=>x.tipo==='Despesa').reduce((a,b)=>a+(Number(b.valor)||0),0);
      const totRec  = list.filter(x=>x.tipo==='Receita').reduce((a,b)=>a+(Number(b.valor)||0),0);
      const saldo   = totRec - totDesp;
      sumEl.append(
        pill(`Itens: ${list.length}`),
        pill(`Receitas: ${fmt(totRec)}`, 'ok'),
        pill(`Despesas: ${fmt(totDesp)}`, 'warn'),
        pill(`Saldo: ${fmt(saldo)}`)
      );
    }
    if (!ul) return;
    ul.innerHTML = '';
    const list = (S.tx||[]).slice().sort((a,b)=>String(b.data||'').localeCompare(String(a.data||''))).reverse();
    list.forEach(x => ul.append(itemTx(x, false)));
  }

  function render(){
    document.body.classList.toggle('dark', !!S.dark);
    // toggles if exist
    const hideToggle = qs('#toggleHide') || qs('#cfgHide');
    if (hideToggle) hideToggle.checked = !!S.hide;
    const darkToggle = qs('#toggleDark') || qs('#cfgDark');
    if (darkToggle) darkToggle.checked = !!S.dark;
    const cycleToggle = qs('#toggleCycle') || qs('#useCycleForReports');
    if (cycleToggle) cycleToggle.checked = !!S.useCycleForReports;
    renderRecentes();
    renderLancamentos();
  }

  // ===== Billing config (localStorage) =====
  function wireBillingConfig(){
    const inpDue = qs('#ccDueDay');
    const inpClose = qs('#ccClosingDay');
    if (inpDue)  inpDue.value  = S.ccDueDay ?? '';
    if (inpClose) inpClose.value = S.ccClosingDay ?? '';
    const btn = qs('#saveCardPrefs');
    if (btn && !btn._wired){
      btn._wired = true;
      btn.addEventListener('click', async ()=>{
        const d = Number((qs('#ccDueDay')?.value||'').trim());
        const c = Number((qs('#ccClosingDay')?.value||'').trim());
        S.ccDueDay = (Number.isFinite(d) && d>=1 && d<=31) ? d : null;
        S.ccClosingDay = (Number.isFinite(c) && c>=1 && c<=31) ? c : null;
        await savePrefs();
        alert('Fatura salva com sucesso!');
      });
    }
  }

  // ===== Init / bindings =====
  window.addEventListener('load', async () => {
    loadPrefs();

    // Bind modal buttons
    const fab = qs('#fab'); if (fab) fab.onclick = () => toggleModal(true);
    const btnNovo = qs('#btnNovo'); if (btnNovo) btnNovo.onclick = () => toggleModal(true);
    const btnClose = qs('#closeModal'); if (btnClose) btnClose.onclick = (e) => { e?.preventDefault?.(); window.resetValorInput && window.resetValorInput(); toggleModal(false); };
    const btnCancelar = qs('#cancelar'); if (btnCancelar) btnCancelar.onclick = (e) => { e?.preventDefault?.(); window.resetValorInput && window.resetValorInput(); toggleModal(false); };
    const btnSalvar = qs('#salvar'); if (btnSalvar) btnSalvar.onclick = (e) => { e?.preventDefault?.(); addOrUpdate(false); };
    const btnSalvarENovo = qs('#salvarENovo'); if (btnSalvarENovo) btnSalvarENovo.onclick = async (e) => { e?.preventDefault?.(); await addOrUpdate(true); window.resetValorInput && window.resetValorInput(); const v = qs('#mValorBig'); if (v) v.focus(); };

    // Tipo tabs
    qsa('#tipoTabs button').forEach(b => {
      b.addEventListener('click', () => {
        modalTipo = b.dataset.type;
        syncTipoTabs();
      });
    });

    // Load data and render
    await loadAll();
    wireBillingConfig();
  });

  async function loadAll(){
    S.tx = await fetchTx();
    S.cats = await fetchCats();
    render();
  }

})(); // IIFE

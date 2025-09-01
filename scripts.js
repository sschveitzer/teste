window.onload = function () {
  // Usa o supabase já criado no dashboard.html
  const supabaseClient = window.supabaseClient || supabase;

  // Estado global
  let S = {
    month: nowYMD().slice(0, 7),
    hide: false,
    dark: false,
    editingId: null,
    tx: [],
    cats: []
  };

  // ========= HELPERS =========
  function gid() {
    return crypto.randomUUID();
  }
  function nowYMD() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }
  function isIsoDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }
  function fmtMoney(v) {
    const n = Number(v);
    return isFinite(n)
      ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "R$ 0,00";
  }
  function parseMoneyMasked(str) {
    if (!str) return 0;
    return Number(str.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "")) || 0;
  }
  const qs = s => document.querySelector(s);
  const qsa = s => [...document.querySelectorAll(s)];

  // ========= LOAD DATA =========
  async function loadAll() {
    // Transações
    const { data: tx, error: txError } = await supabaseClient
      .from("transactions")
      .select("*");
    if (txError) {
      console.error("Erro ao carregar transações:", txError);
      S.tx = [];
    } else {
      S.tx = tx;
    }

    // Categorias
    const { data: cats, error: catsError } = await supabaseClient
      .from("categories")
      .select("*");
    if (catsError) {
      console.error("Erro ao carregar categorias:", catsError);
      S.cats = [];
    } else {
      S.cats = cats;
    }

    // Preferências
    const { data: prefs, error: prefsError } = await supabaseClient
      .from("preferences")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (prefsError) {
      console.error("Erro ao carregar preferências:", prefsError);
    }
    if (prefs) {
      S.month = prefs.month;
      S.hide = prefs.hide;
      S.dark = prefs.dark;
    }

    render();
  }

  // ========= SAVE =========
  async function saveTx(t) {
    return await supabaseClient.from("transactions").upsert([t]);
  }
  async function deleteTx(id) {
    return await supabaseClient.from("transactions").delete().eq("id", id);
  }
  async function saveCat(c) {
    return await supabaseClient.from("categories").upsert([c]);
  }
  async function deleteCat(nome) {
    return await supabaseClient.from("categories").delete().eq("nome", nome);
  }
  async function savePrefs() {
    await supabaseClient.from("preferences").upsert([
      { id: 1, month: S.month, hide: S.hide, dark: S.dark }
    ]);
  }
  // ========= UI =========
  function setTab(name) {
    qsa(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    qsa("section").forEach(s => s.classList.toggle("active", s.id === name));
  }

  function toggleModal(show, titleOverride) {
    const m = qs("#modalLanc");
    m.style.display = show ? "flex" : "none";
    if (show) {
      qs("#mData").value = nowYMD();
      rebuildCatSelect();
      qs("#mDesc").value = "";
      qs("#mObs").value = "";
      qs("#mValorBig").value = "";
      modalTipo = "Despesa";
      syncTipoTabs();
      qs("#modalTitle").textContent = titleOverride || "Nova Despesa";
      setTimeout(() => qs("#mValorBig").focus(), 0);
    } else {
      S.editingId = null;
    }
  }

  let modalTipo = "Despesa";
  function syncTipoTabs() {
    qsa("#tipoTabs button").forEach(b =>
      b.classList.toggle("active", b.dataset.type === modalTipo)
    );
    if (!S.editingId) {
      qs("#modalTitle").textContent = "Nova " + modalTipo;
    }
  }

  function rebuildCatSelect(selected) {
    const sel = qs("#mCategoria");
    sel.innerHTML = '<option value="">Selecione…</option>';
    S.cats.forEach(c => {
      const o = document.createElement("option");
      o.value = c.nome;
      o.textContent = c.nome;
      if (c.nome === selected) o.selected = true;
      sel.append(o);
    });
  }

  // ========= TRANSAÇÕES =========
  async function addOrUpdate() {
    const valor = parseMoneyMasked(qs("#mValorBig").value);
    const t = {
      id: S.editingId || gid(),
      tipo: modalTipo,
      categoria: qs("#mCategoria").value,
      data: isIsoDate(qs("#mData").value) ? qs("#mData").value : nowYMD(),
      descricao: (qs("#mDesc").value || "").trim(),
      valor: isFinite(valor) ? valor : 0,
      obs: (qs("#mObs").value || "").trim()
    };
    if (!t.categoria) return alert("Selecione categoria");
    if (!t.descricao) return alert("Descrição obrigatória");
    if (!(t.valor > 0)) return alert("Informe o valor");

    await saveTx(t);
    loadAll();
    toggleModal(false);
  }

  async function delTx(id) {
    if (confirm("Excluir lançamento?")) {
      await deleteTx(id);
      loadAll();
    }
  }

  function itemTx(x, readOnly = false) {
    const li = document.createElement("li");
    li.className = "item";
    const v = isFinite(Number(x.valor)) ? Number(x.valor) : 0;
    const actions = readOnly
      ? ""
      : `
        <button class="icon edit" title="Editar"><i class="ph ph-pencil-simple"></i></button>
        <button class="icon del" title="Excluir"><i class="ph ph-trash"></i></button>`;
    li.innerHTML = `
      <div class="left">
        <div class="tag">${x.tipo}</div>
        <div>
          <div><strong>${x.descricao || "-"}</strong></div>
          <div class="muted" style="font-size:12px">${x.categoria} • ${x.data}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <div class="${S.hide ? "blurred" : ""}" style="font-weight:700">${fmtMoney(v)}</div>${actions}
      </div>`;
    if (!readOnly) {
      li.querySelector(".edit").onclick = () => openEdit(x.id);
      li.querySelector(".del").onclick = () => delTx(x.id);
    }
    return li;
  }

  function renderRecentes() {
    const ul = qs("#listaRecentes");
    const list = [...S.tx].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10);
    ul.innerHTML = "";
    list.forEach(x => ul.append(itemTx(x, true)));
  }

  function renderLancamentos() {
    const ul = qs("#listaLanc");
    const list = [...S.tx].sort((a, b) => b.data.localeCompare(a.data));
    ul.innerHTML = "";
    list.forEach(x => ul.append(itemTx(x, false)));
  }

  function openEdit(id) {
    const x = S.tx.find(t => t.id === id);
    if (!x) return;
    S.editingId = id;
    modalTipo = x.tipo;
    syncTipoTabs();
    rebuildCatSelect(x.categoria);
    qs("#mData").value = isIsoDate(x.data) ? x.data : nowYMD();
    qs("#mDesc").value = x.descricao || "";
    qs("#mValorBig").value = fmtMoney(Number(x.valor) || 0);
    qs("#mObs").value = x.obs || "";
    qs("#modalTitle").textContent = "Editar lançamento";
    qs("#modalLanc").style.display = "flex";
    setTimeout(() => qs("#mValorBig").focus(), 0);
  }

  // ========= CATEGORIAS =========
  function renderCategorias() {
    const ul = qs("#listaCats");
    ul.innerHTML = "";
    S.cats.forEach(c => {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `
        <div class="left"><strong>${c.nome}</strong></div>
        <div><button class="icon del" title="Excluir"><i class="ph ph-trash"></i></button></div>`;
      li.querySelector(".del").onclick = async () => {
        if (confirm("Excluir categoria?")) {
          await deleteCat(c.nome);
          loadAll();
        }
      };
      ul.append(li);
    });
  }

  // ========= RELATÓRIOS =========
  function updateKpis() {
    const txMonth = S.tx.filter(x => x.data.startsWith(S.month));
    const receitas = txMonth
      .filter(x => x.tipo === "Receita")
      .reduce((a, b) => a + Number(b.valor), 0);
    const despesas = txMonth
      .filter(x => x.tipo === "Despesa")
      .reduce((a, b) => a + Number(b.valor), 0);
    const saldo = receitas - despesas;

    const kpiReceitas = qs("#kpiReceitas");
    const kpiDespesas = qs("#kpiDespesas");
    const kpiSaldo = qs("#kpiSaldo");

    kpiReceitas.textContent = fmtMoney(receitas);
    kpiDespesas.textContent = fmtMoney(despesas);
    kpiSaldo.textContent = fmtMoney(saldo);

    // aplica blur se hide = true
    [kpiReceitas, kpiDespesas, kpiSaldo].forEach(el => {
      el.classList.toggle("blurred", S.hide);
    });
  }
  let chartSaldo, chartPie, chartFluxo;
  function renderCharts() {
    if (chartSaldo) chartSaldo.destroy();
    const ctxSaldo = qs("#chartSaldo");
    if (ctxSaldo) {
      const months = [];
      const saldoData = [];
      const d = new Date();
      for (let i = 11; i >= 0; i--) {
        const cur = new Date(d.getFullYear(), d.getMonth() - i, 1);
        const ym = cur.toISOString().slice(0, 7);
        const txs = S.tx.filter(x => x.data.startsWith(ym));
        const receitas = txs
          .filter(x => x.tipo === "Receita")
          .reduce((a, b) => a + Number(b.valor), 0);
        const despesas = txs
          .filter(x => x.tipo === "Despesa")
          .reduce((a, b) => a + Number(b.valor), 0);
        months.push(
          cur.toLocaleDateString("pt-BR", { month: "short" })
        );
        saldoData.push(receitas - despesas);
      }
      chartSaldo = new Chart(ctxSaldo, {
        type: "line",
        data: { labels: months, datasets: [{ label: "Saldo", data: saldoData }] }
      });
    }

    if (chartPie) chartPie.destroy();
    const ctxPie = qs("#chartPie");
    if (ctxPie) {
      const txMonth = S.tx.filter(x => x.data.startsWith(S.month));
      const porCat = {};
      txMonth
        .filter(x => x.tipo === "Despesa")
        .forEach(x => {
          porCat[x.categoria] = (porCat[x.categoria] || 0) + Number(x.valor);
        });
      chartPie = new Chart(ctxPie, {
        type: "pie",
        data: { labels: Object.keys(porCat), datasets: [{ data: Object.values(porCat) }] }
      });
    }

    if (chartFluxo) chartFluxo.destroy();
    const ctxFluxo = qs("#chartFluxo");
    if (ctxFluxo) {
      const porMes = {};
      S.tx.forEach(x => {
        const ym = x.data.slice(0, 7);
        porMes[ym] =
          (porMes[ym] || 0) +
          Number(x.valor) * (x.tipo === "Despesa" ? -1 : 1);
      });
      const labels = Object.keys(porMes).sort();
      chartFluxo = new Chart(ctxFluxo, {
        type: "bar",
        data: {
          labels,
          datasets: [{ label: "Fluxo", data: labels.map(l => porMes[l]) }]
        }
      });
    }
  }

  // ========= SELECTOR DE MESES =========
  function buildMonthSelect() {
    const sel = qs("#monthSelect");
    sel.innerHTML = "";
    const mesesDisponiveis = [...new Set(S.tx.map(x => x.data.slice(0, 7)))];
    mesesDisponiveis.sort((a, b) => b.localeCompare(a));
    mesesDisponiveis.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      const [ano, mes] = m.split("-");
      opt.textContent = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric"
      });
      if (m === S.month) opt.selected = true;
      sel.append(opt);
    });
    sel.onchange = () => {
      S.month = sel.value;
      savePrefs();
      render();
    };
  }

  // ========= RENDER PRINCIPAL =========
  function render() {
    document.body.classList.toggle("dark", S.dark);
    qs("#toggleHide").checked = S.hide;
    renderRecentes();
    renderLancamentos();
    renderCategorias();
    buildMonthSelect();
    updateKpis();
    renderCharts();
  }

  // ========= EVENTOS =========
  qsa(".tab").forEach(btn =>
    btn.addEventListener("click", () => setTab(btn.dataset.tab))
  );
  qs("#fab").onclick = () => toggleModal(true);
  qs("#btnNovo").onclick = () => toggleModal(true);
  qs("#closeModal").onclick = () => toggleModal(false);
  qs("#cancelar").onclick = () => toggleModal(false);
  qs("#salvar").onclick = addOrUpdate;
  qsa("#tipoTabs button").forEach(b =>
    b.addEventListener("click", () => {
      modalTipo = b.dataset.type;
      syncTipoTabs();
    })
  );

  qs("#addCat").onclick = async () => {
    const nome = qs("#newCatName").value.trim();
    if (!nome) return;
    await saveCat({ nome });
    qs("#newCatName").value = "";
    loadAll();
  };

  qs("#toggleDark").onclick = async () => {
    S.dark = !S.dark;
    document.body.classList.toggle("dark", S.dark);
    await savePrefs();
  };
  qs("#toggleHide").onchange = async e => {
    S.hide = e.target.checked;
    render();
    await savePrefs();
  };
// ====== UX additions: currency mask, keyboard and focus handling ======
  (function enhanceModalUX(){
    const modal = document.getElementById('modalLanc');
    const dialog = modal ? modal.querySelector('.content') : null;
    const valorInput = document.getElementById('mValorBig');
    const formError = document.getElementById('formError');
    const btnSalvar = document.getElementById('salvar');
    const btnCancelar = document.getElementById('cancelar');

    // currency mask with raw cents
    let rawCents = 0;
    const br = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
    const setAmount = () => { if (valorInput) valorInput.value = rawCents ? br.format(rawCents/100) : ''; };

    if (valorInput) {
      valorInput.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'deleteContentBackward') {
          rawCents = Math.floor(rawCents/10);
          setAmount();
          e.preventDefault();
        }
      });
      valorInput.addEventListener('input', (e) => {
        const d = (e.data ?? '').replace(/\D/g,'');
        if (d) {
          rawCents = Math.min(9999999999, rawCents*10 + Number(d));
          setAmount();
        } else if (!e.data && !valorInput.value) {
          rawCents = 0;
        }
        // keep caret at end
        requestAnimationFrame(() => {
          const len = valorInput.value.length;
          valorInput.setSelectionRange(len,len);
        });
      });
      valorInput.addEventListener('focus', () => {
        if (!valorInput.value) setAmount();
        requestAnimationFrame(() => {
          const len = valorInput.value.length;
          valorInput.setSelectionRange(len,len);
        });
      });
    }

    // validate before save
    function validateModal(){
      if (!formError) return true;
      formError.hidden = true; formError.textContent = '';
      const problems = [];
      if (rawCents <= 0 && parseMoneyMasked(valorInput.value) <= 0) problems.push('Informe um valor maior que zero.');
      if (!document.getElementById('mCategoria').value) problems.push('Selecione uma categoria.');
      if (!document.getElementById('mData').value) problems.push('Informe a data.');
      if (problems.length){
        formError.textContent = problems.join(' ');
        formError.hidden = false;
        return false;
      }
      return true;
    }

    // Enter to save, Esc to cancel (not inside textarea)
    if (dialog){
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          if (validateModal()) btnSalvar?.click();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          btnCancelar?.click();
        }
      });

      // focus trap
      dialog.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusables = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const list = Array.from(focusables).filter(el => !el.disabled);
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }

    // expose getter if needed by other code
    window.__getValorCentavos = () => rawCents;
  })();

  // ========= START =========
  loadAll();
};

window.onload = function () {
  // Usa o supabase já criado no dashboard.html
  const supabaseClient = window.supabaseClient || supabase;

  // ========= ESTADO GLOBAL =========
  let S = {
    month: nowYMD().slice(0, 7),
    hide: false,
    dark: false,
    editingId: null,
    tx: [],
    cats: [],
    recs: [] // recorrências
  };

  // ========= HELPERS GERAIS =========
  function gid() {
    return crypto.randomUUID();
  }
  function nowYMD() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }
  function toYMD(d) {
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
  function addDays(ymd, days) {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return toYMD(dt);
  }
  function lastDayOfMonth(y, m) {
    return new Date(y, m, 0).getDate(); // m = 1..12
  }
  function incMonthly(ymd, diaMes, ajusteFimMes = true) {
    const [y, m] = ymd.split("-").map(Number);
    let yy = y, mm = m + 1;
    if (mm > 12) { mm = 1; yy += 1; }
    const ld = lastDayOfMonth(yy, mm);
    const day = ajusteFimMes ? Math.min(diaMes, ld) : diaMes;
    return toYMD(new Date(yy, mm - 1, day));
  }
  function incWeekly(ymd) {
    return addDays(ymd, 7);
  }
  function incYearly(ymd, diaMes, mes, ajusteFimMes = true) {
    const [y] = ymd.split("-").map(Number);
    const yy = y + 1;
    const ld = lastDayOfMonth(yy, mes);
    const day = ajusteFimMes ? Math.min(diaMes, ld) : diaMes;
    return toYMD(new Date(yy, mes - 1, day));
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
      S.tx = tx || [];
    }

    // Categorias
    const { data: cats, error: catsError } = await supabaseClient
      .from("categories")
      .select("*");
    if (catsError) {
      console.error("Erro ao carregar categorias:", catsError);
      S.cats = [];
    } else {
      S.cats = cats || [];
    }

    // Preferências (month, hide, dark)
    const { data: prefs, error: prefsError } = await supabaseClient
      .from("preferences")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (prefsError) {
      console.error("Erro ao carregar preferências:", prefsError);
    }
    if (prefs) {
      S.month = prefs.month ?? S.month;
      S.hide = !!prefs.hide;
      S.dark = !!prefs.dark;
    
    
      // ENSURE_S_MONTH: garante mês atual como default se não houver salvo
      if (!S.month) {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, "0");
        S.month = `${y}-${m}`;
      }
// ENSURE_S_MONTH: garante mês atual como default se não houver salvo
    if (!S.month) {
      const today = new Date();
      const y = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      S.month = `${y}-${mm}`;
    }
}
        try {
      const dNow = new Date();
      const cur = new Date(dNow.getTime() - dNow.getTimezoneOffset() * 60000).toISOString().slice(0,7);
      S.month = cur;
    } catch(e){}


    // Recorrências
    const { data: recs, error: recErr } = await supabaseClient
      .from("recurrences")
      .select("*");
    if (recErr) {
      console.error("Erro ao carregar recorrências:", recErr);
      S.recs = [];
    } else {
      S.recs = recs || [];
    }

    // Materializa recorrências vencidas
    await applyRecurrences();

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

  // Atualiza categoria nas transações (rename)
  async function updateTxCategory(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    await supabaseClient.from("transactions").update({ categoria: newName }).eq("categoria", oldName);
  }

  // ========= RECORRÊNCIAS =========
  async function saveRec(r) {
    return await supabaseClient.from("recurrences").upsert([r]).select().single();
  }
  async function deleteRec(id) {
    return await supabaseClient.from("recurrences").delete().eq("id", id);
  }
  async function toggleRecAtivo(id, ativo) {
    return await supabaseClient.from("recurrences").update({ ativo }).eq("id", id);
  }

  async function materializeOne(rec, occDate) {
    const t = {
      id: gid(),
      tipo: rec.tipo,
      categoria: rec.categoria,
      data: occDate,
      descricao: rec.descricao,
      valor: Number(rec.valor) || 0,
      obs: rec.obs ? (rec.obs + " (recorrente)") : "Recorrente",
      recurrence_id: rec.id,
      occurrence_date: occDate
    };
    await saveTx(t);
  }

  async function applyRecurrences() {
    if (!Array.isArray(S.recs) || !S.recs.length) return;
    const today = nowYMD();

    for (const r of S.recs) {
      if (!r.ativo) continue;
      if (r.fim_em && r.fim_em < today) continue;

      let next = r.proxima_data || today;
      let changed = false;

      while (next <= today) {
        if (r.fim_em && next > r.fim_em) break;
        await materializeOne(r, next);
        changed = true;

        if (r.periodicidade === "Mensal") {
          next = incMonthly(next, r.dia_mes || 1, r.ajuste_fim_mes ?? true);
        } else if (r.periodicidade === "Semanal") {
          next = incWeekly(next);
        } else if (r.periodicidade === "Anual") {
          next = incYearly(next, r.dia_mes || 1, r.mes || 1, r.ajuste_fim_mes ?? true);
        } else {
          break;
        }
      }

      if (changed) {
        await saveRec({ ...r, proxima_data: next });
      }
    }

    // Recarrega transações após gerar
    const { data: tx } = await supabaseClient.from("transactions").select("*");
    S.tx = tx || [];
  }

  // ========= UI BÁSICA =========
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

      // Reset de recorrência
      const chk = qs("#mRepetir");
      const box = qs("#recurrenceFields");
      if (chk && box) {
        chk.checked = false;
        box.style.display = "none";
      }
      const inpIni = qs("#mInicio");
      const inpFim = qs("#mFim");
      const inpDM = qs("#mDiaMes");
      const selDW = qs("#mDiaSemana");
      const selM = qs("#mMes");
      const selPer = qs("#mPeriodicidade");
      const chkAdj = qs("#mAjusteFimMes");
      if (inpIni) inpIni.value = nowYMD();
      if (inpFim) inpFim.value = "";
      if (inpDM) inpDM.value = new Date().getDate();
      if (selDW) selDW.value = String(new Date().getDay() || 1);
      if (selM) selM.value = String(new Date().getMonth() + 1);
      if (selPer) selPer.value = "Mensal";
      if (chkAdj) chkAdj.checked = true;

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
    if (!sel) return;
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

    const chkRepetir = qs("#mRepetir");
    if (S.editingId || !chkRepetir?.checked) {
      await saveTx(t);
      await loadAll();
      return toggleModal(false);
    }

    // Criar recorrência
    const selPer = qs("#mPeriodicidade");
    const per = selPer.value;
    const diaMes = Number(qs("#mDiaMes").value) || new Date().getDate();
    const dow = Number(qs("#mDiaSemana").value || 1);
    const mes = Number(qs("#mMes").value || (new Date().getMonth() + 1));
    const inicio = isIsoDate(qs("#mInicio").value) ? qs("#mInicio").value : nowYMD();
    const fim = isIsoDate(qs("#mFim").value) ? qs("#mFim").value : null;
    const ajuste = !!qs("#mAjusteFimMes").checked;

    // define próxima data inicial baseada no "início"
    let proxima = inicio;
    if (per === "Mensal") {
      const ld = lastDayOfMonth(Number(inicio.slice(0,4)), Number(inicio.slice(5,7)));
      const day = (ajuste ? Math.min(diaMes, ld) : diaMes);
      const candidate = toYMD(new Date(Number(inicio.slice(0,4)), Number(inicio.slice(5,7)) - 1, day));
      proxima = (candidate < inicio) ? incMonthly(candidate, diaMes, ajuste) : candidate;
    } else if (per === "Semanal") {
      proxima = incWeekly(inicio);
    } else if (per === "Anual") {
      const ld = lastDayOfMonth(Number(inicio.slice(0,4)), mes);
      const day = (ajuste ? Math.min(diaMes, ld) : diaMes);
      const candidate = toYMD(new Date(Number(inicio.slice(0,4)), mes - 1, day));
      proxima = (candidate < inicio) ? incYearly(candidate, diaMes, mes, ajuste) : candidate;
    }

    const rec = {
      tipo: t.tipo,
      categoria: t.categoria,
      descricao: t.descricao,
      valor: t.valor,
      obs: t.obs,
      periodicidade: per,
      proxima_data: proxima,
      fim_em: fim,
      ativo: true,
      ajuste_fim_mes: ajuste,
      dia_mes: diaMes,
      dia_semana: dow,
      mes: mes
    };

    const { data: saved, error } = await saveRec(rec);
    if (error) {
      console.error(error);
      return alert("Erro ao salvar recorrência.");
    }

    // Se o lançamento original é para a mesma data da próxima ocorrência, já materializa a primeira
    if (t.data === rec.proxima_data) {
      await materializeOne(saved, rec.proxima_data);
      if (per === "Mensal") rec.proxima_data = incMonthly(rec.proxima_data, diaMes, ajuste);
      else if (per === "Semanal") rec.proxima_data = incWeekly(rec.proxima_data);
      else if (per === "Anual") rec.proxima_data = incYearly(rec.proxima_data, diaMes, mes, ajuste);
      await saveRec({ ...saved, proxima_data: rec.proxima_data });
    }

    await loadAll();
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
      const btnEdit = li.querySelector(".edit");
      const btnDel  = li.querySelector(".del");
      if (btnEdit) btnEdit.onclick = () => openEdit(x.id);
      if (btnDel)  btnDel.onclick  = () => delTx(x.id);
    }
    return li;
  }

  function renderRecentes() {
  const ul = qs("#listaRecentes");
  if (!ul) return;
  const list = [...S.tx]
    .filter(x => x.tipo === "Despesa")
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, 4);
  ul.innerHTML = "";
  if (!ul.classList.contains("lanc-grid")) ul.classList.add("lanc-grid");
  list.forEach(x => ul.append(itemTx(x, true)));
}

  function renderLancamentos() {
    const ul = qs("#listaLanc");
    if (!ul) return;
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

    // Edição: esconde blocos de recorrência (edita só esta instância)
    const chk = qs("#mRepetir");
    const box = qs("#recurrenceFields");
    if (chk && box) {
      chk.checked = false;
      box.style.display = "none";
    }

    qs("#modalLanc").style.display = "flex";
    setTimeout(() => qs("#mValorBig").focus(), 0);
  }

  // ========= CATEGORIAS =========
  function renderCategorias() {
    const ul = qs("#listaCats");
    if (!ul) return;
    ul.classList.add("cats-grid");
    ul.innerHTML = "";

    const list = Array.isArray(S.cats) ? [...S.cats].sort((a,b)=> (a.nome||"").localeCompare(b.nome||"")) : [];
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "item";
      const left = document.createElement("div");
      left.className = "left";
      const strong = document.createElement("strong");
      strong.textContent = "Nenhuma categoria";
      const muted = document.createElement("div");
      muted.className = "muted";
      muted.style.fontSize = "12px";
      muted.textContent = "Use o campo acima para criar.";
      left.appendChild(strong);
      left.appendChild(muted);
      li.appendChild(left);
      ul.appendChild(li);
      return;
    }

    list.forEach(c => {
      const li = document.createElement("li");
      li.className = "item";

      const left = document.createElement("div");
      left.className = "left";
      const titleWrap = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = c.nome;
      titleWrap.appendChild(strong);
      const subtitle = document.createElement("div");
      subtitle.className = "muted";
      subtitle.style.fontSize = "12px";
      subtitle.textContent = "Categoria";
      left.appendChild(titleWrap);
      left.appendChild(subtitle);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "6px";
      right.style.alignItems = "center";

      const btnEdit = document.createElement("button");
      btnEdit.className = "icon edit";
      btnEdit.title = "Renomear";
      const iEdit = document.createElement("i");
      iEdit.className = "ph ph-pencil-simple";
      btnEdit.appendChild(iEdit);

      const btnDel = document.createElement("button");
      btnDel.className = "icon del";
      btnDel.title = "Excluir";
      const iDel = document.createElement("i");
      iDel.className = "ph ph-trash";
      btnDel.appendChild(iDel);

      btnEdit.onclick = async () => {
        const novo = (prompt("Novo nome da categoria:", c.nome) || "").trim();
        if (!novo || novo === c.nome) return;
        await saveCat({ nome: novo });
        if (typeof updateTxCategory === "function") {
          await updateTxCategory(c.nome, novo);
        }
        await deleteCat(c.nome);
        await loadAll();
      };

      btnDel.onclick = async () => {
        if (confirm("Excluir categoria? Transações existentes manterão o nome antigo.")) {
          await deleteCat(c.nome);
          await loadAll();
        }
      };

      right.appendChild(btnEdit);
      right.appendChild(btnDel);

      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
    });
  }

  // ========= RELATÓRIOS / KPIs / GRÁFICOS EXISTENTES =========
  function updateKpis() {
    const txMonth = S.tx.filter(x => x.data && x.data.startsWith(S.month));
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
    const kpiSplit = qs("#kpiSplit");
    const kpiSplitHint = qs("#kpiSplitHint");

    if (kpiReceitas) kpiReceitas.textContent = fmtMoney(receitas);
    if (kpiDespesas) kpiDespesas.textContent = fmtMoney(despesas);
    if (kpiSaldo) kpiSaldo.textContent = fmtMoney(saldo);

    if (kpiSplit) kpiSplit.textContent = fmtMoney(despesas / 2);
    if (kpiSplitHint) kpiSplitHint.textContent = "½ de despesas";

        [kpiReceitas, kpiDespesas, kpiSaldo, kpiSplit].forEach(el => {
      if (el) el.classList.toggle("blurred", S.hide);
    });

    // Percentual de Despesas sobre Receitas (chip #kpiDespesasPct)
    const kpiDespesasPct = qs("#kpiDespesasPct");
    let pctDespesas = "—";
    if (receitas > 0) {
      const d = (despesas / receitas) * 100;
      pctDespesas = d.toFixed(1).replace(".", ",") + "%";
    }
    if (kpiDespesasPct) {
      kpiDespesasPct.textContent = pctDespesas;
      kpiDespesasPct.classList.toggle("blurred", S.hide);
    }
  }

  let chartSaldo, chartPie, chartFluxo;
  function renderCharts() {
    // Saldo acumulado (12 meses)
    if (chartSaldo) chartSaldo.destroy();
    const ctxSaldo = qs("#chartSaldo");
    if (ctxSaldo && window.Chart) {
      const months = [];
      const saldoData = [];
      const d = new Date();
      for (let i = 11; i >= 0; i--) {
        const cur = new Date(d.getFullYear(), d.getMonth() - i, 1);
        const ym = cur.toISOString().slice(0, 7);
        const txs = S.tx.filter(x => x.data && x.data.startsWith(ym));
        const receitas = txs
          .filter(x => x.tipo === "Receita")
          .reduce((a, b) => a + Number(b.valor), 0);
        const despesas = txs
          .filter(x => x.tipo === "Despesa")
          .reduce((a, b) => a + Number(b.valor), 0);
        months.push(cur.toLocaleDateString("pt-BR", { month: "short" }));
        saldoData.push(receitas - despesas);
      }
      chartSaldo = new Chart(ctxSaldo, {
        type: "line",
        data: { labels: months, datasets: [{ label: "Saldo", data: saldoData }] }
      });
    }

    // Pizza por categoria (mês atual)
    if (chartPie) chartPie.destroy();
    const ctxPie = qs("#chartPie");
    if (ctxPie && window.Chart) {
      const txMonth = S.tx.filter(x => x.data && x.data.startsWith(S.month));
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

    // Fluxo por mês
    if (chartFluxo) chartFluxo.destroy();
    const ctxFluxo = qs("#chartFluxo");
    if (ctxFluxo && window.Chart) {
      const porMes = {};
      S.tx.forEach(x => {
        if (!x.data) return;
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
    if (!sel) return;
    sel.innerHTML = "";
    const mesesDisponiveis = [...new Set(S.tx.filter(x=>x.data).map(x => x.data.slice(0, 7)))];
    mesesDisponiveis.sort((a, b) => b.localeCompare(a));
    
    /* ENSURE_CURRENT_MONTH_OPTION */ 
    (function(){
      const dNow = new Date();
      const cur = new Date(dNow.getTime() - dNow.getTimezoneOffset() * 60000).toISOString().slice(0,7);
      if (!mesesDisponiveis.includes(cur)) mesesDisponiveis.unshift(cur);
      // Remove duplicatas novamente por segurança mantendo ordem
      const seen = new Set(); 
      for (let i = 0; i < mesesDisponiveis.length; i++) {
        if (seen.has(mesesDisponiveis[i])) { mesesDisponiveis.splice(i,1); i--; } else { seen.add(mesesDisponiveis[i]); }
      }
    })();
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

  // ========= NOVOS INSIGHTS / ANÁLISES =========
  // Helpers de série temporal
  function monthsBack(n) {
    const out = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(dt.toISOString().slice(0,7));
    }
    return out;
  }
  function monthDays(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  function netByMonth(ym) {
    const txs = S.tx.filter(x => x.data && x.data.startsWith(ym));
    const rec = txs.filter(x=>x.tipo==="Receita").reduce((a,b)=>a+Number(b.valor),0);
    const des = txs.filter(x=>x.tipo==="Despesa").reduce((a,b)=>a+Number(b.valor),0);
    return rec - des;
  }

  // Top 5 categorias (12 meses) — preenche #tblTop (já existe na página)
  function renderTopCategorias12m(limit=5){
    const cutoff = new Date();
    const from = new Date(cutoff.getFullYear(), cutoff.getMonth()-11, 1);
    const sum = {};
    S.tx.forEach(x=>{
      if (!x.data || x.tipo!=="Despesa") return;
      const dt = new Date(x.data);
      if (dt >= from && dt <= cutoff) {
        sum[x.categoria] = (sum[x.categoria]||0) + (Number(x.valor)||0);
      }
    });
    const rows = Object.entries(sum)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,limit);

    const tbody = document.querySelector('#tblTop tbody');
    if (tbody){
      tbody.innerHTML = '';
      rows.forEach(([cat, total])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${cat||'-'}</td><td>${fmtMoney(total)}</td>`;
        tbody.appendChild(tr);
      });
    }
  }

  // Média de gastos por categoria (janela de 6 meses) — preenche #tblMediaCats
  function renderMediaPorCategoria(windowMonths=6){
    const months = monthsBack(windowMonths);
    const byCatMonth = {};
    months.forEach(m=>{
      S.tx.filter(x=>x.data && x.data.startsWith(m) && x.tipo==="Despesa")
        .forEach(x=>{
          const k = x.categoria || '(sem categoria)';
          byCatMonth[k] = byCatMonth[k] || {};
          byCatMonth[k][m] = (byCatMonth[k][m]||0) + (Number(x.valor)||0);
        });
    });
    const medias = Object.entries(byCatMonth).map(([cat, map])=>{
      const tot = months.reduce((a,m)=>a+(map[m]||0),0);
      return [cat, tot/windowMonths];
    }).sort((a,b)=>b[1]-a[1]);

    const tbody = document.querySelector('#tblMediaCats tbody');
    if (tbody){
      tbody.innerHTML = '';
      medias.forEach(([cat, avg])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${cat}</td><td>${fmtMoney(avg)}</td>`;
        tbody.appendChild(tr);
      });
    }
  }

  // Tendência do saldo (projeção até o fim do mês) — mostra em #kpiForecastFinal
  function renderTendenciaSaldo(){
    const ym = S.month;
    const [y,m] = ym.split('-').map(Number);
    const today = new Date();
    const isCurrentMonth = (today.getFullYear()===y && (today.getMonth()+1)===m);

    const txs = S.tx.filter(x=>x.data && x.data.startsWith(ym));
    const receitas = txs.filter(x=>x.tipo==="Receita").reduce((a,b)=>a+Number(b.valor),0);
    const despesas = txs.filter(x=>x.tipo==="Despesa").reduce((a,b)=>a+Number(b.valor),0);
    const saldoAtual = receitas - despesas;

    let proj = saldoAtual;
    if (isCurrentMonth){
      const dia = today.getDate();
      const diasMes = monthDays(ym);
      const mediaDiaria = saldoAtual / Math.max(1, dia);
      proj = mediaDiaria * diasMes;
    }
    const el = document.getElementById('kpiForecastFinal');
    if (el){
      el.textContent = fmtMoney(proj);
      el.style.color = proj >= 0 ? "var(--ok)" : "var(--warn)";
    }
  }

  // Previsão simples com média móvel de 3 meses (gráfico)
  let chartForecast;
  function renderForecastChart(){
    if (chartForecast) chartForecast.destroy();
    const ctx = document.getElementById('chartForecast');
    if (!ctx || !window.Chart) return;

    const months = monthsBack(12);
    const serie = months.map(netByMonth);
    const ma = serie.map((_,i)=>{
      const a = Math.max(0,i-2);
      const slice = serie.slice(a,i+1);
      return slice.reduce((x,y)=>x+y,0)/slice.length;
    });

    chartForecast = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months.map(m=>{
          const [Y,M]=m.split('-');
          return new Date(Y, M-1, 1).toLocaleDateString('pt-BR',{month:'short'});
        }),
        datasets: [
          { label:'Saldo mensal', data: serie },
          { label:'Média móvel (3m)', data: ma }
        ]
      }
    });
  }

  // Heatmap de gastos por dia do mês
  function renderHeatmap(){
    const wrap = document.getElementById('heatmap');
    if (!wrap) return;
    const ym = S.month;
    const days = monthDays(ym);
    const gastosPorDia = Array.from({length: days}, ()=>0);

    S.tx.forEach(x=>{
      if (!x.data || x.tipo!=="Despesa") return;
      if (!x.data.startsWith(ym)) return;
      const d = Number(x.data.slice(8,10));
      gastosPorDia[d-1] += Number(x.valor)||0;
    });

    const max = Math.max(...gastosPorDia, 0);
    wrap.innerHTML = '';

    // Cabeçalho com iniciais (S T Q Q S S D)
    ['S','T','Q','Q','S','S','D'].forEach(lbl=>{
      const h = document.createElement('div');
      h.className = 'cell';
      h.textContent = lbl;
      h.style.fontWeight = '700';
      wrap.appendChild(h);
    });

    // Células
    for (let d=1; d<=days; d++){
      const v = gastosPorDia[d-1];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.textContent = d;
      if (v>0){
        const intensity = max ? v/max : 0;
        const bg = `hsl(0, 85%, ${90 - 50*intensity}%)`; // tons de vermelho
        cell.style.background = bg;
        cell.setAttribute('data-val', String(v));
        cell.title = `Despesas em ${String(d).padStart(2,'0')}/${ym.slice(5,7)}: ${fmtMoney(v)}`;
      }
      wrap.appendChild(cell);
    }

    // Legenda
    const legend = document.createElement('div');
    legend.className = 'legend';
    const sw1 = document.createElement('span'); sw1.className='swatch'; sw1.style.background='hsl(0,85%,90%)';
    const sw2 = document.createElement('span'); sw2.className='swatch'; sw2.style.background='hsl(0,85%,65%)';
    const sw3 = document.createElement('span'); sw3.className='swatch'; sw3.style.background='hsl(0,85%,40%)';
    legend.append('Menor', sw1, sw2, sw3, 'Maior');
    wrap.appendChild(legend);
  }

  // ========= RENDER PRINCIPAL =========
  function render() {
    document.body.classList.toggle("dark", S.dark);

    // sincroniza estado dos toggles (suporta ids antigos e novos)
    const hideToggle = qs("#toggleHide") || qs("#cfgHide");
    if (hideToggle) hideToggle.checked = S.hide;
    const darkToggle = qs("#toggleDark") || qs("#cfgDark");
    if (darkToggle) darkToggle.checked = S.dark;

    renderRecentes();
    renderLancamentos();
    renderCategorias();
    buildMonthSelect();
    updateKpis();
    renderCharts();

    // Novos insights
    renderTopCategorias12m(5);
    renderMediaPorCategoria(6);
    renderTendenciaSaldo();
    renderForecastChart();
    renderHeatmap();
  }

  // ========= EVENTOS =========
  qsa(".tab").forEach(btn =>
    btn.addEventListener("click", () => setTab(btn.dataset.tab))
  );

  const fab = qs("#fab");
  if (fab) fab.onclick = () => toggleModal(true);

  const btnNovo = qs("#btnNovo");
  if (btnNovo) btnNovo.onclick = () => toggleModal(true);

  const btnClose = qs("#closeModal");
  if (btnClose) btnClose.onclick = () => toggleModal(false);

  const btnCancelar = qs("#cancelar");
  if (btnCancelar) btnCancelar.onclick = () => toggleModal(false);

  const btnSalvar = qs("#salvar");
  if (btnSalvar) btnSalvar.onclick = addOrUpdate;

  qsa("#tipoTabs button").forEach(b =>
    b.addEventListener("click", () => {
      modalTipo = b.dataset.type;
      syncTipoTabs();
    })
  );

  const btnAddCat = qs("#addCat");
  if (btnAddCat) btnAddCat.onclick = async () => {
    const nome = (qs("#newCatName").value || "").trim();
    if (!nome) return;
    if (S.cats.some(c => (c.nome||"").toLowerCase() === nome.toLowerCase())) {
      alert("Essa categoria já existe.");
      return;
    }
    await saveCat({ nome });
    qs("#newCatName").value = "";
    loadAll();
  };

  // Suporta #toggleDark (novo) e #cfgDark (antigo)
  const btnDark = qs("#toggleDark") || qs("#cfgDark");
  if (btnDark) {
    btnDark.addEventListener('change', async () => {
      S.dark = !!btnDark.checked;
      document.body.classList.toggle("dark", S.dark);
      await savePrefs();
    });
    // clique também alterna (para botões sem checkbox)
    btnDark.addEventListener('click', async (e) => {
      if (btnDark.tagName === 'BUTTON') {
        S.dark = !S.dark;
        document.body.classList.toggle("dark", S.dark);
        await savePrefs();
      }
    });
  }

  // Suporta #toggleHide (novo) e #cfgHide (antigo)
  const toggleHide = qs("#toggleHide") || qs("#cfgHide");
  if (toggleHide) toggleHide.onchange = async e => {
    S.hide = !!e.target.checked;
    render();
    await savePrefs();
  };

  // Ícone de Config na topbar (abre a aba Config)
  function wireBtnConfig(){
    const btn = document.getElementById('btnConfig');
    if (btn && !btn.__wired){
      btn.__wired = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setTab('config');
      });
    }
  }
  wireBtnConfig();
  document.addEventListener('click', (e) => {
    const target = e.target && e.target.closest ? e.target.closest('#btnConfig') : null;
    if (target){
      e.preventDefault();
      setTab('config');
    }
  });

  // Recorrência: mostrar/ocultar campos conforme checkbox/periodicidade
  const chkRepetir = qs("#mRepetir");
  const recurrenceBox = qs("#recurrenceFields");
  const selPer = qs("#mPeriodicidade");
  const fldDM = qs("#fieldDiaMes");
  const fldDW = qs("#fieldDiaSemana");
  const fldM = qs("#fieldMes");
  function syncRecurrenceFields() {
    if (!chkRepetir || !recurrenceBox) return;
    const on = chkRepetir.checked;
    recurrenceBox.style.display = on ? "block" : "none";
    if (!on) return;
    const per = selPer?.value || "Mensal";
    if (fldDM) fldDM.style.display = (per === "Mensal" || per === "Anual") ? "block" : "none";
    if (fldDW) fldDW.style.display = (per === "Semanal") ? "block" : "none";
    if (fldM)  fldM.style.display  = (per === "Anual") ? "block" : "none";
  }
  if (chkRepetir) chkRepetir.addEventListener("change", syncRecurrenceFields);
  if (selPer) selPer.addEventListener("change", syncRecurrenceFields);

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

    // Enter para salvar, Esc para cancelar (fora do textarea)
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

      // Trap de foco + Tab
      dialog.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusables = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
          .filter(el => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      });
    }
  })();

  // Start!
  loadAll();
};

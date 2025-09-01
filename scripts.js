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
    recs: [] // NOVO: recorrências
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

  // Renomeia uma categoria e atualiza transações relacionadas
  async function renameCategoryFlow(oldName) {
    const newName = prompt("Novo nome da categoria:", oldName);
    if (!newName || newName.trim() === "" || newName === oldName) return;

    const trimmed = newName.trim();

    // Cria/atualiza a categoria com novo nome
    await saveCat({ nome: trimmed });

    // Atualiza transações que usam a categoria antiga
    await supabaseClient.from("transactions").update({ categoria: trimmed }).eq("categoria", oldName);

    // Remove a categoria antiga
    await deleteCat(oldName);

    await loadAll();
  }

  async function savePrefs() {
    await supabaseClient.from("preferences").upsert([
      { id: 1, month: S.month, hide: S.hide, dark: S.dark }
    ]);
  }

  // Recorrências
  async function saveRec(r) {
    return await supabaseClient.from("recurrences").upsert([r]).select().single();
  }
  async function deleteRec(id) {
    return await supabaseClient.from("recurrences").delete().eq("id", id);
  }
  async function toggleRecAtivo(id, ativo) {
    return await supabaseClient.from("recurrences").update({ ativo }).eq("id", id);
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
      // se início já passou no mês, usamos o próximo mês
      const ld = lastDayOfMonth(Number(inicio.slice(0,4)), Number(inicio.slice(5,7)));
      const day = (ajuste ? Math.min(diaMes, ld) : diaMes);
      const candidate = toYMD(new Date(Number(inicio.slice(0,4)), Number(inicio.slice(5,7)) - 1, day));
      proxima = (candidate < inicio) ? incMonthly(candidate, diaMes, ajuste) : candidate;
    } else if (per === "Semanal") {
      // próxima semana a partir do início
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
      li.querySelector(".edit").onclick = () => openEdit(x.id);
      li.querySelector(".del").onclick = () => delTx(x.id);
    }
    return li;
  }

  function renderRecentes() {
    const ul = qs("#listaRecentes");
    if (!ul) return;
    const list = [...S.tx].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10);
    ul.innerHTML = "";
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

    // Edição: esconde blocos de recorrência, pois estamos apenas editando essa instância
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
  ul.innerHTML = "";
  S.cats.forEach(c => {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `<div class="left"><strong>${c.nome}</strong></div>
      <div><button class="icon del" title="Excluir"><i class="ph ph-trash"></i></button></div>`;
    const btnDel = li.querySelector(".del");
    if (btnDel) btnDel.onclick = async () => {
      if (confirm("Excluir categoria?")) {
        await deleteCat(c.nome);
        loadAll();
      }
    };
    ul.append(li);
  });


      };
      ul.append(li);
    });
  }


    cats.forEach(c => {
      const txs = S.tx.filter(x => x.categoria === c.nome);
      const qtd = txs.length;
      const totalDesp = txs
        .filter(x => x.tipo === "Despesa")
        .reduce((a,b) => a + Number(b.valor), 0);
      const totalRec = txs
        .filter(x => x.tipo === "Receita")
        .reduce((a,b) => a + Number(b.valor), 0);

      const li = document.createElement("li");
      li.className = "item";
      li.setAttribute("data-cat", c.nome);
      li.innerHTML = `
        <div class="chip">Categoria</div>
        <div class="titulo">${c.nome}</div>
        <div class="subinfo">${qtd} lançamento${qtd===1?'':'s'}</div>
        <div class="valor">${fmtMoney(totalDesp)} <span class="muted">(despesas)</span></div>
        ${ totalRec > 0 ? `<div class="valor" style="margin-top:4px">${fmtMoney(totalRec)} <span class="muted">(receitas)</span></div>` : ''}
        <div class="right">
          <button class="btn-acao edit" title="Renomear"><i class="ph ph-pencil-simple"></i></button>
          <button class="btn-acao del" title="Excluir"><i class="ph ph-trash"></i></button>
        </div>
      `;

      const btnEdit = li.querySelector(".edit");
      if (btnEdit) btnEdit.onclick = () => renameCategoryFlow(c.nome);
      const btnDel = li.querySelector(".del");
      if (btnDel) btnDel.onclick = async () => {
        if (confirm("Excluir categoria? Isso não altera lançamentos já existentes.")) {
          await deleteCat(c.nome);
          loadAll();
        }
      };

      ul.append(li);
    });
  }
  // ========= RELATÓRIOS / KPIs / GRÁFICOS =========
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

    if (kpiReceitas) kpiReceitas.textContent = fmtMoney(receitas);
    if (kpiDespesas) kpiDespesas.textContent = fmtMoney(despesas);
    if (kpiSaldo) kpiSaldo.textContent = fmtMoney(saldo);

    [kpiReceitas, kpiDespesas, kpiSaldo].forEach(el => {
      if (el) el.classList.toggle("blurred", S.hide);
    });
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

  // ========= RECORRÊNCIAS =========
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

  function renderRecorrentes() {
    const ul = qs("#listaRecorrentes");
    if (!ul) return;
    ul.innerHTML = "";

    if (!S.recs.length) {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `<div class="left"><strong>Nenhuma recorrência</strong><div class="muted">Crie um lançamento e marque “Repetir”.</div></div>`;
      ul.append(li);
      return;
    }

    const list = [...S.recs].sort((a, b) =>
      (a.proxima_data || "").localeCompare(b.proxima_data || "")
    );

    list.forEach(r => {
      const li = document.createElement("li");
      li.className = "item";
      const status = r.ativo ? '<span class="tag">Ativo</span>' : '<span class="tag">Pausado</span>';
      const prox = r.proxima_data ? `• próxima: ${r.proxima_data}` : '';
      li.innerHTML = `
        <div class="left">
          <div class="tag">${r.periodicidade}</div>
          <div>
            <div><strong>${r.descricao}</strong> ${status}</div>
            <div class="muted" style="font-size:12px">${r.categoria} • ${fmtMoney(r.valor)} ${prox}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="icon toggle" title="${r.ativo ? 'Pausar' : 'Ativar'}"><i class="ph ${r.ativo ? 'ph-pause' : 'ph-play'}"></i></button>
          <button class="icon del" title="Excluir"><i class="ph ph-trash"></i></button>
        </div>
      `;
      li.querySelector(".toggle").onclick = async () => {
        await toggleRecAtivo(r.id, !r.ativo);
        await loadAll();
      };
      li.querySelector(".del").onclick = async () => {
        if (confirm("Excluir recorrência?")) {
          await deleteRec(r.id);
          await loadAll();
        }
      };
      ul.append(li);
    });
  }

  // ========= RENDER PRINCIPAL =========
  function render() {
    document.body.classList.toggle("dark", S.dark);
    const hideToggle = qs("#toggleHide");
    if (hideToggle) hideToggle.checked = S.hide;

    renderRecentes();
    renderLancamentos();
    renderCategorias();
    buildMonthSelect();
    updateKpis();
    renderCharts();
    renderRecorrentes();
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
    const nome = qs("#newCatName").value.trim();
    if (!nome) return;
    await saveCat({ nome });
    qs("#newCatName").value = "";
    loadAll();
  };

  const btnDark = qs("#toggleDark");
  if (btnDark) btnDark.onclick = async () => {
    S.dark = !S.dark;
    document.body.classList.toggle("dark", S.dark);
    await savePrefs();
  };

  const toggleHide = qs("#toggleHide");
  if (toggleHide) toggleHide.onchange = async e => {
    S.hide = e.target.checked;
    render();
    await savePrefs();
  };

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

// Delegation for Config checkboxes
document.addEventListener('change', async (e) => {
  if (!e.target) return;
  if (e.target.matches('#cfgDark')) {
    S.dark = !!e.target.checked;
    document.body.classList.toggle('dark', S.dark);
    await savePrefs();
  }
  if (e.target.matches('#cfgHide')) {
    S.hide = !!e.target.checked;
    render();
    await savePrefs();
  }
});

// Config button
const btnConfig = document.getElementById('btnConfig');
if (btnConfig) btnConfig.addEventListener('click', () => setTab('config'));

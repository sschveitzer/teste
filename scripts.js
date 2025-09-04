window.onload = function () {
  // Usa o supabase já criado no dashboard.html
  const supabaseClient = window.supabaseClient || supabase;

  // ========= ESTADO GLOBAL =========
  let S = {
    tx: [],
    cats: [],
    recs: [], // recorrências
    metas: { total: 0, porCat: {} },

    // Preferências de fatura
    ccDueDay: null,
    ccClosingDay: null
  };

  // ... (código anterior permanece igual)

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

      S.ccDueDay     = prefs.ccDueDay ?? null;
      S.ccClosingDay = prefs.ccClosingDay ?? null;
    }

    // ENSURE_S_MONTH: garante mês atual como default se não houver salvo
    if (!S.month) {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      S.month = `${y}-${m}`;
    }

    try {
      const dNow = new Date();
      const cur = new Date(dNow.getTime() - dNow.getTimezoneOffset() * 60000).toISOString().slice(0,7);
      S.month = cur;
    } catch(e){}

    // ... (restante do código continua igual)
  }

  // ... (restante do arquivo permanece igual)
};

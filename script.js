// Калькулятор листовой продукции (для менеджера)
// Добавлено: автопересчёт + кнопка "Копировать расчёт"

const TARIFFS = {
  paperKg: {
    mel_115: 150,
    mel_130: 165,
    mel_150: 180,
    mel_170: 200,
    mel_200: 235,
    mel_250: 290,
    mel_300: 340,

    ofs_80: 105,
    ofs_120: 140,

    color_80: 140,
    color_160: 240,

    design_250: 450,
    design_300: 520,

    kraft_90: 160,
    kraft_120: 210
    // selfadh: вручную
  },

  formats: {
    A3: { w: 297, h: 420 },
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 },
    A6: { w: 105, h: 148 },
    DL: { w: 99, h: 210 }
  },

  paperGsm: {
    mel_115: 115,
    mel_130: 130,
    mel_150: 150,
    mel_170: 170,
    mel_200: 200,
    mel_250: 250,
    mel_300: 300,
    ofs_80: 80,
    ofs_120: 120,
    color_80: 80,
    color_160: 160,
    design_250: 250,
    design_300: 300,
    kraft_90: 90,
    kraft_120: 120,
    selfadh: 80
  },

  digital: {
    click4: 6.0,
    click1: 2.2,
    setup: 0,
    minJob: 0
  },

  offset: {
    setup4: 1200,
    setup1: 600,
    sheet4: 1.15,
    sheet1: 0.55,
    wasteSheets: 200
  },

  finishing: {
    lam: {
      gloss: 18,
      matt: 22,
      softtouch: 35
    },
    uv: {
      solid: 28,
      spot: 55
    },
    folds: 0.6,
    rounding: 0.8,
    diecut: 3.5,
    plotter: 4.5
  }
};

const $ = (id) => document.getElementById(id);

function fmtNum(v, d = 2) {
  const n = Number(v);
  if (!isFinite(n)) return (0).toFixed(d);
  return n.toFixed(d);
}

function rub(v) {
  const n = Number(v);
  if (!isFinite(n)) return "0 ₽";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
}

function m2ForFormat(fmtKey) {
  const f = TARIFFS.formats[fmtKey];
  const areaMm2 = f.w * f.h;
  return areaMm2 / 1_000_000;
}

function paperCost(qty, fmtKey, paperKey, selfadhPricePerKg = 0) {
  const gsm = TARIFFS.paperGsm[paperKey] || 0;
  const area = m2ForFormat(fmtKey);
  const kgPerSheet = (area * gsm) / 1000; // gsm -> кг/м²
  const totalKg = kgPerSheet * qty;

  const pricePerKg = (paperKey === "selfadh")
    ? (Number(selfadhPricePerKg) || 0)
    : (TARIFFS.paperKg[paperKey] || 0);

  return {
    kgPerSheet,
    totalKg,
    pricePerKg,
    total: totalKg * pricePerKg
  };
}

function finishingCost(qty, fmtKey, lamType, lamSides, uvType, uvSides, folds, rounding, diecut, plotter) {
  const area = m2ForFormat(fmtKey);
  let total = 0;
  const parts = [];

  if (lamType !== "none") {
    const cost = (TARIFFS.finishing.lam[lamType] || 0) * area * qty * Number(lamSides || 1);
    total += cost;
    parts.push({ name: `Ламинация (${lamType}) × ${lamSides} ст.`, val: cost });
  }

  if (uvType !== "none") {
    const cost = (TARIFFS.finishing.uv[uvType] || 0) * area * qty * Number(uvSides || 1);
    total += cost;
    parts.push({ name: `УФ-лак (${uvType}) × ${uvSides} ст.`, val: cost });
  }

  if (Number(folds) > 0) {
    const cost = Number(folds) * qty * TARIFFS.finishing.folds;
    total += cost;
    parts.push({ name: `Сгибы (${folds} на шт)`, val: cost });
  }

  if (Number(rounding) > 0) {
    const cost = Number(rounding) * qty * TARIFFS.finishing.rounding;
    total += cost;
    parts.push({ name: `Кругление (${rounding} на шт)`, val: cost });
  }

  if (Number(diecut) > 0) {
    const cost = Number(diecut) * qty * TARIFFS.finishing.diecut;
    total += cost;
    parts.push({ name: `Вырубка (${diecut} на шт)`, val: cost });
  }

  if (Number(plotter) > 0) {
    const cost = Number(plotter) * qty * TARIFFS.finishing.plotter;
    total += cost;
    parts.push({ name: `Плоттер (${plotter} на шт)`, val: cost });
  }

  return { total, parts };
}

function digitalCost(qty, cFace, cBack) {
  const is4 = (Number(cFace) === 4) || (Number(cBack) === 4);
  const is1 = (!is4) && ((Number(cFace) === 1) || (Number(cBack) === 1));
  const click = is4 ? TARIFFS.digital.click4 : (is1 ? TARIFFS.digital.click1 : 0);
  const total = qty * click + TARIFFS.digital.setup;
  return { total, click };
}

function offsetCost(qty, cFace, cBack) {
  const waste = TARIFFS.offset.wasteSheets;
  const sheets = qty + waste;

  function sideCost(c) {
    if (Number(c) === 4) return { setup: TARIFFS.offset.setup4, run: TARIFFS.offset.sheet4 };
    if (Number(c) === 1) return { setup: TARIFFS.offset.setup1, run: TARIFFS.offset.sheet1 };
    return { setup: 0, run: 0 };
  }

  const face = sideCost(cFace);
  const back = sideCost(cBack);

  const setup = face.setup + back.setup;
  const run = sheets * (face.run + back.run);

  return { total: setup + run, sheets, setup, run };
}

// ВАЖНО: 13% всегда, маржа отдельно
// Цена = Себестоимость × 1.13 × (1 + Маржа/100)
function applyTaxAndMargin(cost, marginPct) {
  const c = Number(cost) || 0;
  const m = Number(marginPct) || 0;
  return c * 1.13 * (1 + m / 100);
}

function buildResultHtml(title, baseCost, finalCost, perUnit, extra) {
  return `
    <div class="kv"><span>${title}</span><b>${rub(finalCost)}</b></div>
    <div class="kv"><span>Себестоимость</span><b>${rub(baseCost)}</b></div>
    <div class="kv"><span>Цена за 1 шт</span><b>${rub(perUnit)}</b></div>
    ${extra || ""}
  `;
}

let lastCalc = null; // сохраняем последнюю математику для копирования

function calcAll() {
  const qty = Math.max(1, Number($("qty").value) || 1);
  const fmtKey = $("format").value;
  const paperKey = $("paper").value;

  const cFace = Number($("cFace").value);
  const cBack = Number($("cBack").value);

  const marginPct = Number($("marginPct").value) || 0;

  const lamType = $("lamType").value;
  const lamSides = Number($("lamSides").value) || 1;

  const uvType = $("uvType").value;
  const uvSides = Number($("uvSides").value) || 1;

  const folds = Number($("folds").value) || 0;
  const rounding = Number($("rounding").value) || 0;
  const diecut = Number($("diecut").value) || 0;
  const plotter = Number($("plotter").value) || 0;

  const selfadhPricePerKg = Number($("selfadhPricePerKg").value) || 0;

  const paper = paperCost(qty, fmtKey, paperKey, selfadhPricePerKg);
  const fin = finishingCost(qty, fmtKey, lamType, lamSides, uvType, uvSides, folds, rounding, diecut, plotter);

  const dig = digitalCost(qty, cFace, cBack);
  const digitalBase = paper.total + fin.total + dig.total;
  const digitalFinal = applyTaxAndMargin(digitalBase, marginPct);
  const perUnitDigitalFinal = digitalFinal / qty;

  const off = offsetCost(qty, cFace, cBack);
  const offsetBase = paper.total + fin.total + off.total;
  const offsetFinal = applyTaxAndMargin(offsetBase, marginPct);
  const perUnitOffsetFinal = offsetFinal / qty;

  return {
    qty, fmtKey, paperKey, cFace, cBack,
    marginPct,
    lamType, lamSides, uvType, uvSides,
    folds, rounding, diecut, plotter,
    selfadhPricePerKg,

    paper, fin,

    dig, digitalBase, digitalFinal, perUnitDigitalFinal,
    off, offsetBase, offsetFinal, perUnitOffsetFinal
  };
}

function render(res) {
  $("digitalBox").classList.remove("muted");
  $("offsetBox").classList.remove("muted");
  $("breakdown").classList.remove("muted");

  $("digitalBox").innerHTML = buildResultHtml(
    "Итоговая цена (цифра)",
    res.digitalBase,
    res.digitalFinal,
    res.perUnitDigitalFinal,
    `<div class="kv"><span>Клик, ₽/шт</span><b>${fmtNum(res.dig.click, 2)}</b></div>`
  );

  $("offsetBox").innerHTML = buildResultHtml(
    "Итоговая цена (офсет)",
    res.offsetBase,
    res.offsetFinal,
    res.perUnitOffsetFinal,
    `
      <div class="kv"><span>Листов (с отходами)</span><b>${fmtNum(res.off.sheets, 0)}</b></div>
      <div class="kv"><span>Приладка</span><b>${rub(res.off.setup)}</b></div>
      <div class="kv"><span>Прогон</span><b>${rub(res.off.run)}</b></div>
    `
  );

  const finLines = res.fin.parts
    .map(p => `<div class="kv"><span>${p.name}</span><b>${rub(p.val)}</b></div>`)
    .join("");

  $("breakdown").innerHTML = `
    <div class="kv"><span>Тираж</span><b>${fmtNum(res.qty,0)} шт</b></div>
    <div class="kv"><span>Формат</span><b>${res.fmtKey}</b></div>
    <div class="kv"><span>Бумага</span><b>${res.paperKey}</b></div>
    <div class="kv"><span>Бумага: вес</span><b>${fmtNum(res.paper.totalKg,3)} кг</b></div>
    <div class="kv"><span>Бумага: цена</span><b>${rub(res.paper.total)}</b></div>
    <div class="kv"><span>Постпечатка</span><b>${rub(res.fin.total)}</b></div>
    ${finLines || `<div class="kv"><span>Постпечатка</span><b>—</b></div>`}
    <div class="kv"><span>Маржа</span><b>${fmtNum(res.marginPct,0)}%</b></div>
    <div class="kv"><span>Формула</span><b>×1.13 ×(1+Маржа/100)</b></div>
  `;
}

function showToast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(() => t.classList.add("hidden"), 1800);
}

function safeRecalc() {
  try {
    $("err").textContent = "";
    const res = calcAll();
    lastCalc = res;
    render(res);
  } catch (e) {
    console.error(e);
    $("err").textContent = "Ошибка расчёта. Проверьте введённые значения.";
  }
}

// Debounce для автопересчёта, чтобы не дёргать рендер на каждый символ
let debounceTimer = null;
function scheduleRecalc() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(safeRecalc, 120);
}

function paperLabel(key) {
  const map = {
    mel_115:"Мелованная 115", mel_130:"Мелованная 130", mel_150:"Мелованная 150",
    mel_170:"Мелованная 170", mel_200:"Мелованная 200", mel_250:"Мелованная 250", mel_300:"Мелованная 300",
    ofs_80:"Офсетная 80", ofs_120:"Офсетная 120",
    color_80:"Цветная 80", color_160:"Цветная 160",
    design_250:"Дизайнерская 250", design_300:"Дизайнерская 300",
    kraft_90:"Крафт 90", kraft_120:"Крафт 120",
    selfadh:"Самоклейка"
  };
  return map[key] || key;
}

function lamLabel(key) {
  const map = { none:"Нет", gloss:"Глянец", matt:"Мат", softtouch:"Софт-тач" };
  return map[key] || key;
}
function uvLabel(key) {
  const map = { none:"Нет", solid:"Сплошной", spot:"Выборочный" };
  return map[key] || key;
}

function buildCopyText(res) {
  const lines = [];
  lines.push("Расчёт листовой продукции");
  lines.push(`Тираж: ${res.qty} шт`);
  lines.push(`Формат: ${res.fmtKey}`);
  lines.push(`Бумага: ${paperLabel(res.paperKey)}${res.paperKey === "selfadh" ? ` (₽/кг: ${fmtNum(res.selfadhPricePerKg,0)})` : ""}`);
  lines.push(`Цветность: ${res.cFace}+${res.cBack}`);
  lines.push("");

  lines.push("Цифра:");
  lines.push(`  Итог: ${rub(res.digitalFinal)}`);
  lines.push(`  ₽/шт: ${rub(res.perUnitDigitalFinal)}`);

  lines.push("Офсет:");
  lines.push(`  Итог: ${rub(res.offsetFinal)}`);
  lines.push(`  ₽/шт: ${rub(res.perUnitOffsetFinal)}`);
  lines.push("");

  lines.push("Постпечатка:");
  lines.push(`  Ламинация: ${lamLabel(res.lamType)} (${res.lamType !== "none" ? `${res.lamSides} ст.` : ""})`.trim());
  lines.push(`  УФ-лак: ${uvLabel(res.uvType)} (${res.uvType !== "none" ? `${res.uvSides} ст.` : ""})`.trim());
  if (res.folds) lines.push(`  Сгибы: ${res.folds} на шт`);
  if (res.rounding) lines.push(`  Кругление: ${res.rounding} на шт`);
  if (res.diecut) lines.push(`  Вырубка: ${res.diecut} на шт`);
  if (res.plotter) lines.push(`  Плоттер: ${res.plotter} на шт`);
  if (!res.fin.parts.length) lines.push("  —");

  lines.push("");
  lines.push(`Маржа: ${fmtNum(res.marginPct,0)}%`);
  lines.push("Формула: Цена = Себестоимость × 1.13 × (1 + Маржа/100)");
  return lines.join("\n");
}

async function copyCalc() {
  if (!lastCalc) {
    safeRecalc();
  }
  if (!lastCalc) return;

  const text = buildCopyText(lastCalc);
  try {
    await navigator.clipboard.writeText(text);
    showToast("Скопировано ✅ Можно вставлять в чат");
  } catch (e) {
    // fallback для старых браузеров
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Скопировано ✅ Можно вставлять в чат");
    } catch (err) {
      console.error(err);
      $("err").textContent = "Не получилось скопировать. Скопируйте вручную из детализации.";
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function bind() {
  const ids = [
    "qty","format","paper","selfadhPricePerKg",
    "cFace","cBack","marginPct",
    "lamType","lamSides","uvType","uvSides",
    "folds","rounding","diecut","plotter"
  ];

  // Автопересчёт при любом изменении
  ids.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      $("err").textContent = "";
      scheduleRecalc();
    });
    el.addEventListener("change", () => {
      $("err").textContent = "";
      scheduleRecalc();
    });
  });

  $("paper").addEventListener("change", () => {
    const isSelf = $("paper").value === "selfadh";
    $("selfadhWrap").classList.toggle("hidden", !isSelf);
  });

  $("btnCalc").addEventListener("click", safeRecalc);
  $("btnCopy").addEventListener("click", copyCalc);

  // init selfadh visibility + first calc
  $("selfadhWrap").classList.toggle("hidden", $("paper").value !== "selfadh");
  safeRecalc();
}

bind();

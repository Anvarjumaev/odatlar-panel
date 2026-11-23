(() => {
  "use strict";

  const tg = window.Telegram && window.Telegram.WebApp;
  const state = { data: null, changes: new Map() };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[char]));
  }

  function decodePayload(encoded) {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function parseDate(iso) { return new Date(`${iso}T00:00:00Z`); }

  function formatDate(iso) {
    return parseDate(iso).toLocaleDateString("uz-UZ", {
      day: "numeric", month: "long", timeZone: "UTC",
    });
  }

  function dateAt(index) {
    const day = parseDate(state.data.s);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  }

  function dayIndex(iso) {
    return Math.round((parseDate(iso) - parseDate(state.data.s)) / 86400000);
  }

  function todayIndex() {
    return Math.min(state.data.D - 1, dayIndex(state.data.t));
  }

  function baseDone(row, index) {
    return Math.floor(Number(row[2]) / (2 ** index)) % 2 === 1;
  }

  function done(row, index) {
    const key = `${row[0]}:${dateAt(index)}`;
    return state.changes.has(key) ? Boolean(state.changes.get(key).val) : baseDone(row, index);
  }

  function isEditable(index) {
    const today = todayIndex();
    return index === today || (Number(state.data.ey) === 1 && index === today - 1);
  }

  function allDone(rows, index) { return rows.length > 0 && rows.every((row) => baseDone(row, index)); }

  function chainStats(rows) {
    const elapsed = Math.max(0, Math.min(Number(state.data.D), todayIndex() + 1));
    let current = 0;
    for (let index = elapsed - 1; index >= 0 && allDone(rows, index); index -= 1) current += 1;
    let longest = 0;
    let run = 0;
    for (let index = 0; index < elapsed; index += 1) {
      run = allDone(rows, index) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return { elapsed, current, longest };
  }

  function applyTheme() {
    if (!tg) return;
    const params = tg.themeParams || {};
    const root = document.documentElement;
    const mappings = {
      "--tg-theme-bg-color": params.bg_color,
      "--tg-theme-secondary-bg-color": params.secondary_bg_color,
      "--tg-theme-text-color": params.text_color,
      "--tg-theme-hint-color": params.hint_color,
      "--tg-theme-button-color": params.button_color,
      "--tg-theme-button-text-color": params.button_text_color,
    };
    Object.entries(mappings).forEach(([key, value]) => { if (value) root.style.setProperty(key, value); });
    if (tg.setHeaderColor && params.bg_color) tg.setHeaderColor(params.bg_color);
    if (tg.setBackgroundColor && params.bg_color) tg.setBackgroundColor(params.bg_color);
    if (tg.setBottomBarColor && params.bg_color) tg.setBottomBarColor(params.bg_color);
  }

  function setupTelegram() {
    if (!tg) return;
    tg.ready();
    tg.expand();
    applyTheme();
    if (tg.onEvent) tg.onEvent("themeChanged", applyTheme);
    if (tg.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(() => tg.close());
    }
    if (tg.requestFullscreen) $("fullscreenButton").hidden = false;
    if (tg.MainButton) {
      tg.MainButton.setText("Saqlash");
      tg.MainButton.onClick(saveChanges);
    }
  }

  function renderWake() {
    const card = $("wakeCard");
    const title = $("wakeTitle");
    const subtitle = $("wakeSubtitle");
    card.classList.remove("is-done", "is-late");
    if (todayIndex() < 0) {
      title.textContent = "Zanjir ertaga boshlanadi";
      subtitle.textContent = `${formatDate(state.data.s)} · Bugun tayyorgarlik kuni`;
      return;
    }
    if (Number(state.data.wt) === 1) {
      card.classList.add("is-done");
      title.textContent = "Vaqtida turdingiz!";
      subtitle.textContent = `Rasm qabul qilindi · ${state.data.w}`;
    } else if (Number(state.data.wt) === 2) {
      card.classList.add("is-late");
      title.textContent = "Bugun kechroq turildi";
      subtitle.textContent = `Ertaga yana urinib ko‘ring · ${state.data.w}`;
    } else {
      title.textContent = "Bugungi rasmni kutyapmiz";
      subtitle.textContent = `${state.data.w} oralig‘ida rasm yuboring`;
    }
  }

  function renderHabit(row, rowIndex, elapsed, readOnly = false) {
    const name = escapeHtml(row[1]);
    const count = Array.from({ length: elapsed }, (_, index) => done(row, index)).filter(Boolean).length;
    const cells = [];
    for (let index = 0; index < Number(state.data.D); index += 1) {
      const iso = dateAt(index);
      const date = parseDate(iso);
      const label = date.toLocaleDateString("uz-UZ", { weekday: "short", timeZone: "UTC" }).slice(0, 2);
      const number = date.getUTCDate();
      const value = done(row, index);
      const key = `${row[0]}:${iso}`;
      const changed = state.changes.has(key);
      const locked = readOnly || !isEditable(index);
      cells.push(`
        <div class="day-column">
          <div class="day-label">${escapeHtml(label)}<span class="day-number">${number}</span></div>
          <button class="habit-cell ${value ? "done" : ""} ${index === todayIndex() ? "today" : ""} ${locked ? "locked" : ""} ${changed ? "changed" : ""}"
                  ${readOnly ? "" : `data-row="${rowIndex}"`} data-index="${index}" type="button" ${locked ? "disabled" : ""}
                  aria-label="${name}, ${iso}, ${value ? "bajarildi" : "bajarilmadi"}">${value ? "✓" : ""}</button>
        </div>`);
    }
    return `
      <article class="habit-card" style="animation-delay:${rowIndex * 35}ms">
        <div class="habit-header"><span class="habit-name">${name}</span><span class="habit-count">${readOnly ? "Rasm orqali" : `${count}/${elapsed}`}</span></div>
        <div class="days-scroll"><div class="days" style="--days:${state.data.D}">${cells.join("")}</div></div>
      </article>`;
  }

  function render() {
    if (!state.data) {
      $("dashboard").hidden = true;
      $("emptyState").hidden = false;
      $("saveButton").hidden = true;
      return;
    }
    $("dashboard").hidden = false;
    $("emptyState").hidden = true;
    const wakeRow = state.data.h.find((row) => Number(row[0]) === 0);
    const rows = state.data.h.filter((row) => Number(row[0]) !== 0);
    const { elapsed, current, longest } = chainStats(rows);
    const total = rows.length * elapsed;
    const completed = rows.reduce((sum, row) => sum + Array.from({ length: elapsed }, (_, index) => baseDone(row, index)).filter(Boolean).length, 0);
    const percent = total ? Math.round((completed / total) * 100) : 0;

    $("greeting").textContent = state.data.n ? `Salom, ${state.data.n}` : "Bugungi reja";
    $("heroTitle").textContent = elapsed === 0 ? "Boshlanish ertaga" : `${elapsed}-kunni davom ettiring`;
    $("heroSubtitle").textContent = elapsed === 0
      ? `Boshlanish sanasi: ${formatDate(state.data.s)}`
      : (percent === 100 ? "Bugungi barcha odatlar bajarildi — ajoyib!" : "Har bir belgi — oldinga yana bir qadam.");
    $("progressValue").textContent = `${percent}%`;
    $("progressRing").style.setProperty("--progress", `${percent}%`);
    $("streakValue").textContent = current;
    $("longestValue").textContent = longest;
    $("dayValue").textContent = `${elapsed}/${state.data.D}`;
    $("editHint").textContent = elapsed === 0 ? "Ertaga" : (Number(state.data.ey) ? "Bugun + kecha" : "Bugun");
    renderWake();
    const wakeMarkup = wakeRow ? renderHabit(wakeRow, 0, elapsed, true) : "";
    const habitMarkup = rows.map((row, index) => renderHabit(row, index, elapsed)).join("");
    $("habitList").innerHTML = wakeMarkup + (habitMarkup || `<div class="empty-state card"><h2>Odatlar yo‘q</h2><p class="muted">Avval bot orqali odat qo‘shing.</p></div>`);
    $("saveButton").hidden = Boolean(tg);
    if (tg && tg.MainButton) {
      if (state.changes.size) tg.MainButton.enable(); else tg.MainButton.disable();
      tg.MainButton.show();
    }
  }

  function toggle(rowIndex, index) {
    const row = state.data.h.filter((item) => Number(item[0]) !== 0)[rowIndex];
    if (!row || !isEditable(index)) return;
    const day = dateAt(index);
    const key = `${row[0]}:${day}`;
    const next = !done(row, index);
    if (next === baseDone(row, index)) state.changes.delete(key);
    else state.changes.set(key, { id: Number(row[0]), day, val: next ? 1 : 0 });
    render();
  }

  function saveChanges() {
    if (!state.data || !state.changes.size) return;
    const payload = JSON.stringify({ c: Array.from(state.changes.values()).map((item) => [item.id, item.day, item.val]) });
    if (tg && tg.sendData) {
      tg.sendData(payload);
    } else {
      window.alert("Telegram ichida ochilganda o‘zgarishlar botga yuboriladi.");
    }
  }

  function load() {
    const encoded = new URLSearchParams(window.location.search).get("d");
    try { state.data = encoded ? decodePayload(encoded) : null; } catch (error) { console.error(error); state.data = null; }
    setupTelegram();
    render();
    $("habitList").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-row]");
      if (button) toggle(Number(button.dataset.row), Number(button.dataset.index));
    });
    $("saveButton").addEventListener("click", saveChanges);
    $("fullscreenButton").addEventListener("click", () => { if (tg && tg.requestFullscreen) tg.requestFullscreen(); });
  }

  load();
})();

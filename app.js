(() => {
  const SHEET_ID = "1y4Cis5U7w41evU7td57bjiZfBFBltniyWEdPWyOrtLc";
  const MAX_RESULTS = 60;
  const DEBOUNCE_MS = 120;
  const LIVE_LOAD_TIMEOUT_MS = 60000;
  const CACHE_DB_NAME = "dinh-danh-nha-cache";
  const CACHE_STORE_NAME = "entries";
  const CACHE_KEY = "clientCards:v1";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const resultsEl = document.getElementById("results");
  const metaEl = document.getElementById("resultMeta");
  const inputEl = document.getElementById("searchInput");
  const formEl = document.getElementById("searchForm");
  const clearSearchEl = document.getElementById("clearSearch");
  const toastEl = document.getElementById("toast");

  const state = {
    clientCards: [],
    hasRenderedCache: false,
    timer: null,
    requestId: 0,
    toastTimer: null,
  };

  const icon = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6.4 6.4l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.5.6A2 2 0 0 1 22 16.9z"></path></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
  };

  function hasServer() {
    return typeof google !== "undefined" && google.script && google.script.run;
  }

  function sheetQueryUrl(sheetName, query) {
    const params = new URLSearchParams({
      sheet: sheetName,
      tq: query,
      tqx: "out:json",
    });
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params.toString()}`;
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function normalizeCode(value) {
    return String(value || "").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function firstPhone(value) {
    const match = String(value || "").match(/0\d{8,10}/);
    return match ? match[0] : "";
  }

  function buildClientCards(data) {
    const tdpMap = new Map((data.toDanPho || []).map((item) => [normalizeCode(item.id), item]));
    const officerMap = new Map((data.officers || []).map((item) => [normalizeCode(item.code), item]));

    return (data.houses || [])
      .filter((house) => house && (house.name || house.address) && house.tdpCode)
      .map((house) => {
        const tdp = tdpMap.get(normalizeCode(house.tdpCode)) || {};
        return makeCard(house, tdp, officerMap);
      });
  }

  function loadGviz(sheetName, query) {
    const callback = `__gviz_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timeoutMs = LIVE_LOAD_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const cleanup = () => {
        window.clearTimeout(timer);
        script.remove();
        delete window[callback];
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Không tải được Google Sheet. Hãy kiểm tra quyền chia sẻ hoặc dùng bản Apps Script."));
      }, timeoutMs);

      window[callback] = (response) => {
        cleanup();
        if (!response || response.status === "error") {
          reject(new Error(response?.errors?.[0]?.detailed_message || "Google Sheet trả về lỗi."));
          return;
        }
        resolve(gvizRows(response.table));
      };

      const params = new URLSearchParams({
        sheet: sheetName,
        headers: "1",
        tq: query,
        tqx: `out:json;responseHandler:${callback}`,
      });
      script.onerror = () => {
        cleanup();
        reject(new Error("Không mở được link Google Sheet."));
      };
      script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params.toString()}`;
      document.head.appendChild(script);
    });
  }

  function gvizRows(table) {
    return (table?.rows || []).map((row) => {
      return (row.c || []).map((cell) => {
        if (!cell) return "";
        return cell.f ?? cell.v ?? "";
      });
    });
  }

  function openCacheDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);

    return new Promise((resolve) => {
      const request = indexedDB.open(CACHE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  async function readCachedCards() {
    const db = await openCacheDb();
    if (!db) return null;

    return new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE_NAME, "readonly");
      const request = transaction.objectStore(CACHE_STORE_NAME).get(CACHE_KEY);
      request.onsuccess = () => {
        const entry = request.result;
        if (!entry || !Array.isArray(entry.cards)) {
          resolve(null);
          return;
        }
        resolve(entry);
      };
      request.onerror = () => resolve(null);
      transaction.oncomplete = () => db.close();
    });
  }

  async function writeCachedCards(cards) {
    const db = await openCacheDb();
    if (!db) return;

    await new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE_NAME, "readwrite");
      transaction.objectStore(CACHE_STORE_NAME).put({
        key: CACHE_KEY,
        cards,
        savedAt: Date.now(),
      });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        resolve();
      };
    });
  }

  async function loadLiveData() {
    const [housesRows, toDanPhoRows, officersRows] = await Promise.all([
      loadGviz("Dinh danh NHA", "select A,C,D,F where F is not null"),
      loadGviz("To dan pho", "select A,B,E,F,G,H where A is not null"),
      loadGviz("Cán bộ", "select A,C,D,H where A is not null"),
    ]);

    return {
      houses: housesRows.map((row) => ({
        id: row[0],
        name: row[1],
        address: row[2],
        tdpCode: row[3],
      })),
      toDanPho: toDanPhoRows.map((row) => ({
        id: row[0],
        name: row[1],
        cskvCode: row[2],
        cskvPhone: row[3],
        hinhSuCode: row[4],
        hinhSuPhone: row[5],
      })),
      officers: officersRows.map((row) => ({
        code: row[0],
        name: row[1],
        fullName: row[2],
        phone: row[3],
      })),
    };
  }

  function makeCard(house, tdp, officerMap) {
    const cskvOfficer = officerMap.get(normalizeCode(tdp.cskvCode)) || {};
    const hinhSuOfficer = officerMap.get(normalizeCode(tdp.hinhSuCode)) || {};
    const title = house.address || house.name || "Chưa có địa chỉ";
    const alias = house.name && house.name !== title ? house.name : "";

    return {
      id: house.id || `${title}-${house.tdpCode}`,
      title,
      alias,
      code: house.tdpCode || tdp.id || "",
      tdpName: tdp.name || "",
      searchText: normalizeText(`${house.name} ${house.address} ${house.tdpCode} ${tdp.name}`),
      cskv: {
        role: "CSKV",
        code: tdp.cskvCode || "",
        name: cskvOfficer.fullName || cskvOfficer.name || tdp.cskvCode || "Chưa có dữ liệu",
        phone: tdp.cskvPhone || cskvOfficer.phone || "",
      },
      hinhSu: {
        role: "Hình sự",
        code: tdp.hinhSuCode || "",
        name: hinhSuOfficer.fullName || hinhSuOfficer.name || tdp.hinhSuCode || "Chưa có dữ liệu",
        phone: tdp.hinhSuPhone || hinhSuOfficer.phone || "",
      },
    };
  }

  function scoreCard(card, query) {
    if (!query) return 1;
    if (card.searchText === query) return 100;
    if (card.searchText.startsWith(query)) return 80;
    if (card.searchText.includes(` ${query}`)) return 65;
    if (card.searchText.includes(query)) return 50;

    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length && terms.every((term) => card.searchText.includes(term))) {
      return 30 + terms.length;
    }
    return 0;
  }

  function searchClient(rawQuery) {
    const query = normalizeText(rawQuery);
    if (!query) return state.clientCards.slice(0, MAX_RESULTS);

    const buckets = new Map();
    for (const card of state.clientCards) {
      const score = scoreCard(card, query);
      if (!score) continue;
      if (!buckets.has(score)) buckets.set(score, []);
      const bucket = buckets.get(score);
      if (bucket.length < MAX_RESULTS) bucket.push(card);
    }

    return [...buckets.keys()]
      .sort((a, b) => b - a)
      .flatMap((score) => buckets.get(score))
      .slice(0, MAX_RESULTS);
  }

  function updateSearchControls() {
    formEl.classList.toggle("has-query", inputEl.value.trim().length > 0);
  }

  function render(cards, rawQuery) {
    const query = String(rawQuery || "").trim();
    const safeCards = Array.isArray(cards) ? cards : [];

    if (!safeCards.length) {
      resultsEl.innerHTML = `<div class="empty">${query ? "Không tìm thấy địa chỉ phù hợp." : "Nhập tên gọi hoặc địa chỉ để tra cứu."}</div>`;
      metaEl.textContent = query ? `Không có kết quả cho "${query}"` : "Sẵn sàng tra cứu theo cột C hoặc cột D";
      return;
    }

    resultsEl.innerHTML = safeCards.map(renderCard).join("");
    metaEl.textContent = query
      ? `Hiển thị ${safeCards.length} kết quả cho "${query}"`
      : `Hiển thị ${safeCards.length} địa chỉ đầu tiên`;
  }

  function renderLoading(message) {
    resultsEl.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function renderCard(card) {
    return `
      <article class="result-card">
        <div class="result-card__head">
          <div class="result-card__code">${escapeHtml(card.code || "-")}</div>
          <h2 class="result-card__title">${escapeHtml(card.title)}</h2>
          <p class="result-card__sub">${escapeHtml(card.alias || card.tdpName || "")}</p>
        </div>
        <div class="officers">
          ${renderOfficer(card.cskv, "cskv")}
          <div class="divider" aria-hidden="true"></div>
          ${renderOfficer(card.hinhSu, "hinh-su")}
        </div>
      </article>
    `;
  }

  function renderOfficer(person, kind) {
    const safePerson = person || {};
    const phone = safePerson.phone || "";
    const dial = firstPhone(phone);
    const callAttrs = dial ? `href="tel:${dial}"` : 'aria-disabled="true"';
    const copyDisabled = phone ? "" : 'aria-disabled="true" disabled';

    return `
      <section class="officer officer--${kind}">
        <h3 class="officer__role">${escapeHtml(safePerson.role)}</h3>
        <p class="officer__name">${escapeHtml(safePerson.name || "Chưa có dữ liệu")}</p>
        <p class="officer__phone">${escapeHtml(phone || "-")}</p>
        <div class="actions">
          <a class="action action--call" ${callAttrs}>${icon.phone}<span>Gọi ngay</span></a>
          <button class="action action--copy" type="button" data-copy="${escapeHtml(phone)}" ${copyDisabled}>${icon.copy}<span>Sao chép SĐT</span></button>
        </div>
      </section>
    `;
  }

  function runSearch(immediate = false) {
    window.clearTimeout(state.timer);
    const query = inputEl.value;
    const execute = () => {
      if (hasServer()) {
        searchServer(query);
      } else {
        render(searchClient(query), query);
      }
    };

    if (immediate) {
      execute();
      return;
    }
    state.timer = window.setTimeout(execute, DEBOUNCE_MS);
  }

  function searchServer(query) {
    const requestId = ++state.requestId;
    metaEl.textContent = "Đang tìm trong Google Sheet...";
    google.script.run
      .withSuccessHandler((cards) => {
        if (requestId === state.requestId) render(cards, query);
      })
      .withFailureHandler((error) => {
        if (requestId !== state.requestId) return;
        resultsEl.innerHTML = '<div class="empty">Không đọc được dữ liệu từ Google Sheet.</div>';
        metaEl.textContent = error && error.message ? error.message : "Lỗi tải dữ liệu";
      })
      .searchPlaces(query, MAX_RESULTS);
  }

  async function copyText(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.left = "-9999px";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        document.body.removeChild(field);
      }
      showToast(`Đã sao chép ${text}`);
    } catch (error) {
      showToast("Không sao chép được SĐT");
    }
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toastEl.classList.remove("is-visible");
    }, 1800);
  }

  async function init() {
    const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
    inputEl.value = initialQuery;
    updateSearchControls();

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch(true);
    });
    inputEl.addEventListener("input", () => {
      updateSearchControls();
      runSearch(false);
    });
    clearSearchEl.addEventListener("click", () => {
      if (!inputEl.value) return;
      inputEl.value = "";
      updateSearchControls();
      runSearch(true);
      inputEl.focus();
    });
    resultsEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-copy]");
      if (button) copyText(button.dataset.copy);
    });

    if (hasServer()) {
      searchServer(initialQuery);
      return;
    }

    metaEl.textContent = "Đang kiểm tra dữ liệu đã lưu...";
    const cachedEntry = await readCachedCards();
    if (cachedEntry) {
      state.clientCards = cachedEntry.cards;
      state.hasRenderedCache = true;
      render(searchClient(initialQuery), initialQuery);
      const cacheIsFresh = Date.now() - (cachedEntry.savedAt || 0) < CACHE_TTL_MS;
      metaEl.textContent = cacheIsFresh
        ? `Đã mở nhanh từ dữ liệu lưu trên máy (${state.clientCards.length.toLocaleString("vi-VN")} địa chỉ)`
        : "Đang dùng dữ liệu lưu trên máy, sẽ cập nhật lại từ Google Sheet";
    } else {
      renderLoading("Đang nạp dữ liệu lần đầu từ Google Sheet...");
      metaEl.textContent = "Đang nạp trực tiếp từ Google Sheet...";
    }

    try {
      const liveData = await loadLiveData();
      state.clientCards = buildClientCards(liveData);
      await writeCachedCards(state.clientCards);
      const currentQuery = inputEl.value;
      render(searchClient(currentQuery), currentQuery);
      if (!currentQuery) {
        metaEl.textContent = `Đã nạp ${state.clientCards.length.toLocaleString("vi-VN")} địa chỉ từ Google Sheet`;
      }
      return;
    } catch (error) {
      console.warn(error);
      if (state.hasRenderedCache) {
        metaEl.textContent = "Đang dùng dữ liệu lưu trên máy do Google Sheet tải chậm";
        return;
      }
      if (!new URLSearchParams(window.location.search).has("sample")) {
        resultsEl.innerHTML = `
          <div class="empty">
            Không nạp được dữ liệu trực tiếp từ Google Sheet.<br>
            Google chỉ cho web local đọc link Sheet khi file được chia sẻ "bất kỳ ai có đường liên kết đều có thể xem" hoặc khi app chạy bằng Google Apps Script.
          </div>
        `;
        metaEl.textContent = "Google Sheet đang chặn đọc trực tiếp";
        return;
      }
    }

    if (!window.APP_DATA) {
      resultsEl.innerHTML = '<div class="empty">Không nạp được Google Sheet. Hãy chia sẻ sheet ở chế độ có thể xem bằng link hoặc triển khai bản Apps Script.</div>';
      metaEl.textContent = "Không tải được dữ liệu trực tiếp";
      return;
    }

    state.clientCards = buildClientCards(window.APP_DATA);
    render(searchClient(initialQuery), initialQuery);
    if (!initialQuery) {
      metaEl.textContent = "Đang dùng dữ liệu mẫu do URL có ?sample=1";
    }
  }

  init();
})();

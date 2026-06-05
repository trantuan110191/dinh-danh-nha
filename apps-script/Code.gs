const SPREADSHEET_ID = "1y4Cis5U7w41evU7td57bjiZfBFBltniyWEdPWyOrtLc";
const SHEETS = {
  houses: "Dinh danh NHA",
  neighborhoods: "To dan pho",
  officers: "Cán bộ",
};
const CACHE_TTL_MS = 5 * 60 * 1000;

let LOOKUP_CACHE = null;

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Tra cứu địa bàn CSKV")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function searchPlaces(query, limit) {
  const data = getLookupData_();
  const normalizedQuery = normalizeText_(query || "");
  const max = Math.min(Number(limit) || 60, 100);

  return data.cards
    .map((card, index) => ({
      card,
      index,
      score: scoreCard_(card.searchText, normalizedQuery),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map((item) => stripSearchText_(item.card));
}

function refreshLookupCache() {
  LOOKUP_CACHE = null;
  return { ok: true, refreshedAt: new Date().toISOString() };
}

function getLookupData_() {
  if (LOOKUP_CACHE && LOOKUP_CACHE.expiresAt > Date.now()) {
    return LOOKUP_CACHE;
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const neighborhoods = buildNeighborhoodMap_(ss.getSheetByName(SHEETS.neighborhoods));
  const officers = buildOfficerMap_(ss.getSheetByName(SHEETS.officers));
  const cards = buildCards_(ss.getSheetByName(SHEETS.houses), neighborhoods, officers);

  LOOKUP_CACHE = {
    cards,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return LOOKUP_CACHE;
}

function buildCards_(sheet, neighborhoods, officers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 6).getDisplayValues();
  return values
    .map((row) => {
      const house = {
        id: row[0],
        name: row[2],
        address: row[3],
        tdpCode: row[5],
      };
      if ((!house.name && !house.address) || !house.tdpCode) return null;

      const tdp = neighborhoods[normalizeCode_(house.tdpCode)] || {};
      const cskvOfficer = officers[normalizeCode_(tdp.cskvCode)] || {};
      const hinhSuOfficer = officers[normalizeCode_(tdp.hinhSuCode)] || {};
      const title = house.address || house.name || "Chưa có địa chỉ";
      const alias = house.name && house.name !== title ? house.name : "";

      return {
        id: house.id || `${title}-${house.tdpCode}`,
        title,
        alias,
        code: house.tdpCode || tdp.id || "",
        tdpName: tdp.name || "",
        searchText: normalizeText_(`${house.name} ${house.address} ${house.tdpCode} ${tdp.name || ""}`),
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
    })
    .filter(Boolean);
}

function buildNeighborhoodMap_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const rows = sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();
  return rows.reduce((map, row) => {
    const id = row[0];
    if (!id) return map;
    map[normalizeCode_(id)] = {
      id,
      name: row[1],
      cskvCode: row[4],
      cskvPhone: row[5],
      hinhSuCode: row[6],
      hinhSuPhone: row[7],
    };
    return map;
  }, {});
}

function buildOfficerMap_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const rowCount = lastRow - 1;
  const codes = sheet.getRange(2, 1, rowCount, 1).getDisplayValues();
  const names = sheet.getRange(2, 3, rowCount, 2).getDisplayValues();
  const phones = sheet.getRange(2, 8, rowCount, 1).getDisplayValues();

  return codes.reduce((map, row, index) => {
    const code = row[0];
    if (!code) return map;
    map[normalizeCode_(code)] = {
      code,
      name: names[index][0],
      fullName: names[index][1],
      phone: phones[index][0],
    };
    return map;
  }, {});
}

function scoreCard_(searchText, query) {
  if (!query) return 1;
  if (searchText === query) return 100;
  if (searchText.indexOf(query) === 0) return 80;
  if (searchText.indexOf(` ${query}`) !== -1) return 65;
  if (searchText.indexOf(query) !== -1) return 50;

  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length && terms.every((term) => searchText.indexOf(term) !== -1)) {
    return 30 + terms.length;
  }
  return 0;
}

function stripSearchText_(card) {
  const output = Object.assign({}, card);
  delete output.searchText;
  return output;
}

function normalizeText_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCode_(value) {
  return String(value || "").trim().toLowerCase();
}

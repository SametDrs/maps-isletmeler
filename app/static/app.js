(() => {
  "use strict";

  const POLL_INTERVAL_MS = 1500;
  const ACTIVE_POLL_INTERVAL_MS = 2000;
  const IDLE_POLL_INTERVAL_MS = 10000;
  const LIVE_REFRESH_DEBOUNCE_MS = 700;
  const MAX_POLL_FAILURES = 5;
  const ACTIVE_JOB_STORAGE_KEY = "maps_isletmeler_active_job_id";
  const DISMISSED_BATCH_STORAGE_KEY = "maps_isletmeler_dismissed_batch_id";
  const DISMISSED_JOB_STORAGE_KEY = "maps_isletmeler_dismissed_job_id";
  const THEME_STORAGE_KEY = "maps_isletmeler_theme";
  const WORKERS_STORAGE_KEY = "maps_isletmeler_workers";
  const SCAN_MODE_STORAGE_KEY = "maps_isletmeler_scan_mode";
  const BATCH_MAX_ITEMS_LIMIT = 200;
  const BATCH_WARN_ITEMS_THRESHOLD = 100;
  const ALL_DISTRICTS_VALUE = "__ALL__";
  const RING_CIRCUMFERENCE = 2 * Math.PI * 40;
  const PAGE_SIZE = 12;

  const STATUS_LABELS = {
    running: "Çalışıyor",
    paused: "Duraklatıldı",
    done: "Tamamlandı",
    captcha: "CAPTCHA Algılandı",
    error: "Hata Oluştu",
    cancelled: "İptal Edildi",
  };

  const BATCH_ITEM_STATUS_LABELS = {
    pending: "Bekliyor",
    running: "Taranıyor",
    paused: "Duraklatıldı",
    done: "Tamamlandı",
    skipped: "Atlandı",
    captcha: "CAPTCHA",
    error: "Hata",
    cancelled: "İptal",
  };

  const DURUM_ORDER = ["yeni", "bekleniyor", "onaylandi", "reddedildi"];

  const DURUM_META = {
    yeni: { label: "Yeni", className: "is-yeni" },
    bekleniyor: { label: "Geri dönüş bekleniyor", className: "is-bekleniyor" },
    onaylandi: { label: "Onaylandı", className: "is-onaylandi" },
    reddedildi: { label: "Reddedildi", className: "is-reddedildi" },
  };

  const TR_WEEKDAYS = [
    "Pazartesi",
    "Salı",
    "Çarşamba",
    "Perşembe",
    "Cuma",
    "Cumartesi",
    "Pazar",
  ];

  const TR_WEEKDAY_SHORT = {
    Pazartesi: "Pzt",
    Salı: "Sal",
    Çarşamba: "Çar",
    Perşembe: "Per",
    Cuma: "Cum",
    Cumartesi: "Cmt",
    Pazar: "Paz",
  };

  const JS_DAY_TO_TR = [
    "Pazar",
    "Pazartesi",
    "Salı",
    "Çarşamba",
    "Perşembe",
    "Cuma",
    "Cumartesi",
  ];

  const DAY_ALIASES = {
    pazartesi: "Pazartesi",
    pzt: "Pazartesi",
    monday: "Pazartesi",
    mon: "Pazartesi",
    salı: "Salı",
    sali: "Salı",
    sal: "Salı",
    tuesday: "Salı",
    tue: "Salı",
    çarşamba: "Çarşamba",
    carsamba: "Çarşamba",
    çar: "Çarşamba",
    car: "Çarşamba",
    wednesday: "Çarşamba",
    wed: "Çarşamba",
    perşembe: "Perşembe",
    persembe: "Perşembe",
    per: "Perşembe",
    thursday: "Perşembe",
    thu: "Perşembe",
    cuma: "Cuma",
    cum: "Cuma",
    friday: "Cuma",
    fri: "Cuma",
    cumartesi: "Cumartesi",
    cmt: "Cumartesi",
    saturday: "Cumartesi",
    sat: "Cumartesi",
    pazar: "Pazar",
    paz: "Pazar",
    sunday: "Pazar",
    sun: "Pazar",
  };

  const state = {
    regions: [],
    ilLookup: new Map(),
    uniqueIlceToIl: new Map(),
    categories: [],

    scanMode: "single",
    selectedIl: null,
    selectedIlce: null,
    selectedCategory: null,
    batchIl: null,
    batchIlGeneli: false,
    batchSelectedIlces: new Set(),
    batchIlceAll: false,
    batchSelectedCategories: new Set(),
    batchSubmitPending: false,
    maxResultsUnlimited: false,
    savedWorkers: 1,

    activeJobId: null,
    pollTimer: null,
    pollFailures: 0,
    lastObservedDone: -1,
    lastJobStatus: null,
    jobStartedAtMs: null,
    elapsedTimer: null,

    activeBatch: null,
    trackedGlobalJob: null,
    globalProgressExpanded: false,
    dismissedBatchId: null,
    dismissedJobId: null,
    gpCancelConfirming: false,
    formCancelConfirming: false,
    statusCancelConfirming: false,
    batchActionPending: false,
    jobCancelPending: false,
    activePollTimer: null,
    activePollInFlight: false,
    activePollQueued: false,
    liveRefreshTimer: null,
    lastBatchId: null,
    lastBatchStatus: null,
    lastBatchCompletedItems: -1,
    lastBatchTotalSaved: -1,

    filterRegion: null,
    filterCategory: null,
    businesses: [],
    searches: [],
    isLoadingBusinesses: false,

    viewMode: "cards",
    currentPage: 1,
    filters: {
      text: "",
      il: "",
      ilce: "",
      searchCategory: "",
      mapsCategories: new Set(),
      statuses: new Set(),
      minRating: 0,
      minReviews: 0,
      noPhone: false,
      noWebsite: false,
      hasHours: false,
      sortBy: "newest",
    },

    statusRequestSeq: new Map(),
    detailPlaceId: null,
    canGoBackToList: false,
    capturedScrollBeforeHash: false,
    savedScrollY: 0,
    detailMapInstance: null,
    detailMapTileLayer: null,
    detailMapTileTheme: null,

    mapInstance: null,
    mapTileLayer: null,
    mapTileTheme: null,
    mapClusterGroup: null,
    mapMarkersByKey: new Map(),
    mapNeedsSync: false,
    activePopupCleanup: null,
  };

  const els = {
    globalProgress: document.getElementById("global-progress"),
    gpHeader: document.getElementById("gp-header"),
    gpDot: document.getElementById("gp-dot"),
    gpLabel: document.getElementById("gp-label"),
    gpStatusBadge: document.getElementById("gp-status-badge"),
    gpPercent: document.getElementById("gp-percent"),
    gpPauseBtn: document.getElementById("gp-pause-btn"),
    gpResumeBtn: document.getElementById("gp-resume-btn"),
    gpCancelBtn: document.getElementById("gp-cancel-btn"),
    gpConfirmBox: document.getElementById("gp-confirm-box"),
    gpConfirmYes: document.getElementById("gp-confirm-yes"),
    gpConfirmNo: document.getElementById("gp-confirm-no"),
    gpDismissBtn: document.getElementById("gp-dismiss-btn"),
    gpToggleBtn: document.getElementById("gp-toggle-btn"),
    gpBarTrack: document.getElementById("gp-bar-track"),
    gpBarFill: document.getElementById("gp-bar-fill"),
    gpSummary: document.getElementById("gp-summary"),
    gpDetails: document.getElementById("gp-details"),
    gpDetailsMsg: document.getElementById("gp-details-msg"),
    gpItemsList: document.getElementById("gp-items-list"),

    workspace: document.getElementById("workspace"),
    sidebar: document.getElementById("sidebar"),
    mainContent: document.getElementById("main-content"),
    detailView: document.getElementById("detail-view"),
    themeToggle: document.getElementById("theme-toggle"),
    globalStats: document.getElementById("global-stats"),
    form: document.getElementById("scrape-form"),
    modeToggleBtns: Array.from(document.querySelectorAll("#scan-mode-toggle .mode-toggle-btn")),
    singleFields: document.getElementById("single-fields"),
    batchFields: document.getElementById("batch-fields"),

    ilInput: document.getElementById("il-input"),
    ilClearBtn: document.getElementById("il-clear-btn"),
    ilToggleBtn: document.getElementById("il-toggle-btn"),
    ilPlakaBadge: document.getElementById("il-plaka-badge"),

    ilceInput: document.getElementById("ilce-input"),
    ilceToggleBtn: document.getElementById("ilce-toggle-btn"),
    ilceCountHint: document.getElementById("ilce-count-hint"),

    categoryInput: document.getElementById("category-input"),
    categoryClearBtn: document.getElementById("category-clear-btn"),
    categoryToggleBtn: document.getElementById("category-toggle-btn"),
    categoryGroupBadge: document.getElementById("category-group-badge"),

    queryPreviewText: document.getElementById("query-preview-text"),

    batchIlInput: document.getElementById("batch-il-input"),
    batchIlClearBtn: document.getElementById("batch-il-clear-btn"),
    batchIlToggleBtn: document.getElementById("batch-il-toggle-btn"),
    batchIlPlakaBadge: document.getElementById("batch-il-plaka-badge"),
    batchIlceAllBtn: document.getElementById("batch-ilce-all-btn"),
    batchIlceCountHint: document.getElementById("batch-ilce-count-hint"),
    batchIlceSelectBtn: document.getElementById("batch-ilce-select-btn"),
    batchIlceSelectLabel: document.getElementById("batch-ilce-select-label"),
    batchIlceChips: document.getElementById("batch-ilce-chips"),
    batchCatCountHint: document.getElementById("batch-cat-count-hint"),
    batchCatSelectBtn: document.getElementById("batch-cat-select-btn"),
    batchCatSelectLabel: document.getElementById("batch-cat-select-label"),
    batchCatChips: document.getElementById("batch-cat-chips"),
    batchSummaryCard: document.getElementById("batch-summary-card"),
    batchSummaryText: document.getElementById("batch-summary-text"),
    batchSummaryWarn: document.getElementById("batch-summary-warn"),

    maxResultsInput: document.getElementById("max-results"),
    maxResultsMeta: document.getElementById("max-results-meta"),
    presetPills: Array.from(document.querySelectorAll(".preset-pill")),
    workersMeta: document.getElementById("workers-meta"),
    workerPills: Array.from(document.querySelectorAll(".worker-pill")),
    headlessInput: document.getElementById("headless"),
    formError: document.getElementById("form-error"),
    startBtn: document.getElementById("start-btn"),
    startBtnLabel: document.querySelector("#start-btn span"),
    cancelBtn: document.getElementById("cancel-btn"),
    formConfirmBox: document.getElementById("form-confirm-box"),
    formConfirmYes: document.getElementById("form-confirm-yes"),
    formConfirmNo: document.getElementById("form-confirm-no"),

    statusPanel: document.getElementById("status-panel"),
    liveDot: document.getElementById("live-dot"),
    statusBadge: document.getElementById("status-badge"),
    progressTrack: document.getElementById("progress-track"),
    progressRingCircle: document.getElementById("progress-ring-circle"),
    progressDone: document.getElementById("progress-done"),
    progressTotalLabel: document.getElementById("progress-total-label"),
    progressPercent: document.getElementById("progress-percent"),
    statusElapsed: document.getElementById("status-elapsed"),
    statusMessage: document.getElementById("status-message"),
    statusActions: document.getElementById("status-actions"),
    statusPauseBtn: document.getElementById("status-pause-btn"),
    statusResumeBtn: document.getElementById("status-resume-btn"),
    statusCancelBtn: document.getElementById("status-cancel-btn"),
    statusConfirmBox: document.getElementById("status-confirm-box"),
    statusConfirmYes: document.getElementById("status-confirm-yes"),
    statusConfirmNo: document.getElementById("status-confirm-no"),
    statusGuidance: document.getElementById("status-guidance"),

    searchesList: document.getElementById("searches-list"),
    searchesEmpty: document.getElementById("searches-empty"),
    showAllBtn: document.getElementById("show-all-btn"),

    kpiTotal: document.getElementById("kpi-total"),
    kpiTotalSub: document.getElementById("kpi-total-sub"),
    kpiPhone: document.getElementById("kpi-phone"),
    kpiPhoneSub: document.getElementById("kpi-phone-sub"),
    kpiPhoneBar: document.getElementById("kpi-phone-bar"),
    kpiNoWebsite: document.getElementById("kpi-no-website"),
    kpiNoWebsiteSub: document.getElementById("kpi-no-website-sub"),
    kpiNoWebsiteBar: document.getElementById("kpi-no-website-bar"),

    resultsPanel: document.getElementById("results-panel"),
    resultsCount: document.getElementById("results-count"),
    activeFilterLabel: document.getElementById("active-filter-label"),
    clearFilterBtn: document.getElementById("clear-filter-btn"),
    viewButtons: Array.from(document.querySelectorAll(".view-btn")),
    exportBtn: document.getElementById("export-btn"),

    filterText: document.getElementById("filter-text"),
    mobileFiltersToggle: document.getElementById("mobile-filters-toggle"),
    detailedFiltersGrid: document.getElementById("detailed-filters-grid"),
    filterIl: document.getElementById("filter-il"),
    filterIlce: document.getElementById("filter-ilce"),
    filterSearchCat: document.getElementById("filter-search-cat"),
    filterMapsCatBtn: document.getElementById("filter-maps-cat-btn"),
    filterMapsCatLabel: document.getElementById("filter-maps-cat-label"),
    filterSort: document.getElementById("filter-sort"),
    filterMinRating: document.getElementById("filter-min-rating"),
    filterMinRatingVal: document.getElementById("filter-min-rating-val"),
    filterMinReviews: document.getElementById("filter-min-reviews"),
    filterNoPhone: document.getElementById("filter-no-phone"),
    filterNoWebsite: document.getElementById("filter-no-website"),
    filterHasHours: document.getElementById("filter-has-hours"),
    filterDurumPills: Array.from(
      document.querySelectorAll("#filter-durum-pills .durum-filter-pill")
    ),

    activeChipsBar: document.getElementById("active-chips-bar"),
    activeChipsList: document.getElementById("active-chips-list"),
    clearAllFiltersBtn: document.getElementById("clear-all-filters-btn"),

    tableError: document.getElementById("table-error"),
    skeletonView: document.getElementById("skeleton-view"),
    cardsView: document.getElementById("cards-view"),
    cardsGrid: document.getElementById("cards-grid"),
    tableView: document.getElementById("table-view"),
    tableWrap: document.getElementById("table-wrap"),
    tbody: document.getElementById("businesses-tbody"),
    mapView: document.getElementById("map-view"),
    mapStatsText: document.getElementById("map-stats-text"),
    mapContainer: document.getElementById("map-container"),
    mapFallback: document.getElementById("map-fallback"),
    paginationBar: document.getElementById("pagination-bar"),
    paginationInfo: document.getElementById("pagination-info"),
    paginationControls: document.getElementById("pagination-controls"),

    resultsEmpty: document.getElementById("results-empty"),
    resultsEmptyTitle: document.getElementById("results-empty-title"),
    resultsEmptyDesc: document.getElementById("results-empty-desc"),
    emptyResetBtn: document.getElementById("empty-reset-btn"),

    comboboxPortal: document.getElementById("combobox-portal"),
    toastStack: document.getElementById("toast-stack"),
  };

  let ilCombobox = null;
  let ilceCombobox = null;
  let categoryCombobox = null;
  let batchIlCombobox = null;

  function safeStorageGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch {
      // Storage unavailable
    }
  }

  function safeStorageRemove(storage, key) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage unavailable
    }
  }

  function trLower(value) {
    return String(value ?? "").toLocaleLowerCase("tr-TR");
  }

  function foldTr(value) {
    return trLower(value)
      .replace(/ç/g, "c")
      .replace(/ğ/g, "g")
      .replace(/ı/g, "i")
      .replace(/ö/g, "o")
      .replace(/ş/g, "s")
      .replace(/ü/g, "u");
  }

  function trCompare(a, b) {
    return String(a ?? "").localeCompare(String(b ?? ""), "tr");
  }

  function matchesSearch(text, query) {
    const q = String(query ?? "").trim();
    if (!q) return true;
    return trLower(text).includes(trLower(q)) || foldTr(text).includes(foldTr(q));
  }

  function startsWithSearch(text, query) {
    const q = String(query ?? "").trim();
    if (!q) return false;
    return trLower(text).startsWith(trLower(q)) || foldTr(text).startsWith(foldTr(q));
  }

  function createSvg(paths, size = 16, filled = false) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    if (filled) {
      svg.setAttribute("fill", "currentColor");
    } else {
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.8");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
    }
    for (const def of paths) {
      const node = document.createElementNS(svgNS, def.tag);
      for (const [k, v] of Object.entries(def.attrs)) {
        node.setAttribute(k, v);
      }
      svg.appendChild(node);
    }
    return svg;
  }

  const ICONS = {
    pin: () =>
      createSvg(
        [
          { tag: "path", attrs: { d: "M12 21s6.5-5.8 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.2 12 21 12 21z" } },
          { tag: "circle", attrs: { cx: "12", cy: "9.8", r: "2.3" } },
        ],
        14
      ),
    phone: () =>
      createSvg(
        [
          {
            tag: "path",
            attrs: {
              d: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z",
            },
          },
        ],
        14
      ),
    globe: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "path", attrs: { d: "M3.6 9h16.8M3.6 15h16.8M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" } },
        ],
        14
      ),
    clock: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "polyline", attrs: { points: "12 7 12 12 15.5 14" } },
        ],
        13
      ),
    star: (size = 13) =>
      createSvg(
        [
          {
            tag: "polygon",
            attrs: {
              points: "12 2.5 14.9 8.4 21.4 9.3 16.7 13.9 17.8 20.4 12 17.3 6.2 20.4 7.3 13.9 2.6 9.3 9.1 8.4 12 2.5",
            },
          },
        ],
        size,
        true
      ),
    external: () =>
      createSvg(
        [
          { tag: "path", attrs: { d: "M14 5h5v5" } },
          { tag: "path", attrs: { d: "M19 5l-9 9" } },
          { tag: "path", attrs: { d: "M19 14v5H5V5h5" } },
        ],
        13
      ),
    arrowLeft: () =>
      createSvg(
        [
          { tag: "path", attrs: { d: "M19 12H5" } },
          { tag: "path", attrs: { d: "m12 19-7-7 7-7" } },
        ],
        15
      ),
    chevronLeft: () =>
      createSvg([{ tag: "path", attrs: { d: "m15 18-6-6 6-6" } }], 15),
    chevronRight: () =>
      createSvg([{ tag: "path", attrs: { d: "m9 18 6-6-6-6" } }], 15),
    copy: () =>
      createSvg(
        [
          { tag: "rect", attrs: { x: "9", y: "9", width: "13", height: "13", rx: "2" } },
          { tag: "path", attrs: { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" } },
        ],
        13
      ),
    check: () =>
      createSvg([{ tag: "path", attrs: { d: "M20 6 9 17l-5-5" } }], 13),
    compass: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "path", attrs: { d: "M12 3v3M12 18v3M3 12h3M18 12h3" } },
        ],
        14
      ),
    calendar: () =>
      createSvg(
        [
          { tag: "rect", attrs: { x: "3", y: "4", width: "18", height: "18", rx: "2" } },
          { tag: "path", attrs: { d: "M16 2v4M8 2v4M3 10h18" } },
        ],
        14
      ),
    close: () =>
      createSvg(
        [{ tag: "path", attrs: { d: "M18 6 6 18M6 6l12 12" } }],
        12
      ),
    note: () =>
      createSvg(
        [
          { tag: "path", attrs: { d: "M12 20h9" } },
          { tag: "path", attrs: { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" } },
        ],
        16
      ),
    statusDone: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "path", attrs: { d: "m9 12 2 2 4-4" } },
        ],
        15
      ),
    statusRunning: () =>
      createSvg(
        [{ tag: "path", attrs: { d: "M21 12a9 9 0 1 1-6.22-8.56" } }],
        15
      ),
    statusPending: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "polyline", attrs: { points: "12 7 12 12 15 14" } },
        ],
        15
      ),
    statusCaptcha: () =>
      createSvg(
        [
          {
            tag: "path",
            attrs: {
              d: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z",
            },
          },
          { tag: "line", attrs: { x1: "12", y1: "9", x2: "12", y2: "13" } },
          { tag: "line", attrs: { x1: "12", y1: "17", x2: "12.01", y2: "17" } },
        ],
        15
      ),
    statusError: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "path", attrs: { d: "m15 9-6 6M9 9l6 6" } },
        ],
        15
      ),
    statusCancelled: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "path", attrs: { d: "m4.93 4.93 14.14 14.14" } },
        ],
        15
      ),
    statusPaused: () =>
      createSvg(
        [
          { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
          { tag: "line", attrs: { x1: "10", y1: "9", x2: "10", y2: "15" } },
          { tag: "line", attrs: { x1: "14", y1: "9", x2: "14", y2: "15" } },
        ],
        15
      ),
    statusSkipped: () =>
      createSvg(
        [
          { tag: "path", attrs: { d: "M5 5l9 7-9 7V5z" } },
          { tag: "line", attrs: { x1: "19", y1: "5", x2: "19", y2: "19" } },
        ],
        15
      ),
  };

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast is-${type}`;
    toast.setAttribute("role", "status");

    const text = document.createElement("span");
    text.textContent = message;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close";
    closeBtn.setAttribute("aria-label", "Bildirimi kapat");
    closeBtn.appendChild(ICONS.close());
    closeBtn.addEventListener("click", () => toast.remove());

    toast.append(text, closeBtn);
    els.toastStack.appendChild(toast);

    setTimeout(() => {
      if (toast.isConnected) {
        toast.remove();
      }
    }, 4500);
  }

  function extractApiError(body, fallback) {
    if (!body || !body.detail) return fallback;
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail.length > 0) {
      return body.detail
        .map((item) => (item && typeof item.msg === "string" ? item.msg : JSON.stringify(item)))
        .join(" ");
    }
    return fallback;
  }

  function safeHttpUrl(rawUrl, allowBareDomain = false) {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    let candidate = trimmed;
    if (allowBareDomain && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
      if (!/\s/.test(candidate) && candidate.includes(".")) {
        candidate = `https://${candidate}`;
      } else {
        return null;
      }
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }

  function formatDateTime(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDateTimeLong(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function copyTextWithFeedback(text, label, buttonEl = null) {
    const value = String(text ?? "");
    if (!value) return;
    let copied = false;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (!copied) {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      } catch {
        copied = false;
      }
    }

    if (!copied) {
      showToast("Pano erişimi desteklenmiyor.", "warning");
      return;
    }

    showToast(`${label} kopyalandı.`, "success");
    if (buttonEl) {
      buttonEl.classList.add("is-copied");
      const textNode = buttonEl.querySelector("span");
      const iconNode = buttonEl.querySelector("svg");
      const prevText = textNode ? textNode.textContent : "";
      if (textNode) textNode.textContent = "Kopyalandı";
      if (iconNode) iconNode.replaceWith(ICONS.check());
      if (buttonEl._copyResetTimer) {
        clearTimeout(buttonEl._copyResetTimer);
      }
      buttonEl._copyResetTimer = setTimeout(() => {
        buttonEl.classList.remove("is-copied");
        if (textNode) textNode.textContent = prevText || "Kopyala";
        const currentSvg = buttonEl.querySelector("svg");
        if (currentSvg) currentSvg.replaceWith(ICONS.copy());
      }, 1600);
    }
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatPhoneHref(phone) {
    const cleaned = String(phone).replace(/[^+\d]/g, "");
    return cleaned ? `tel:${cleaned}` : null;
  }

  function hasPhone(b) {
    return Boolean(b && b.phone && String(b.phone).trim());
  }

  function hasWebsite(b) {
    return Boolean(b && safeHttpUrl(b.website, true));
  }

  function getValidCoords(b) {
    if (!b || b.lat === null || b.lat === undefined || b.lng === null || b.lng === undefined) {
      return null;
    }
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    return { lat, lng };
  }

  function isClosedHoursText(hoursText) {
    return /(?:^|[\s,·.;:()-])(kapal[ıi]|closed)(?:$|[\s,·.;:()-])/i.test(trLower(hoursText));
  }

  function parseHoursData(rawHours) {
    if (!rawHours) {
      return { entries: [], rawText: "" };
    }

    let parsed = null;
    if (typeof rawHours === "object" && !Array.isArray(rawHours)) {
      parsed = rawHours;
    } else if (typeof rawHours === "string") {
      try {
        const obj = JSON.parse(rawHours);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          parsed = obj;
        }
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      const text = String(rawHours).trim();
      return { entries: [], rawText: text };
    }

    const todayTr = JS_DAY_TO_TR[new Date().getDay()];
    const entries = [];

    for (const [rawKey, rawVal] of Object.entries(parsed)) {
      const hoursText = rawVal == null ? "" : String(rawVal).trim();
      if (!hoursText) continue;

      const keyTrimmed = String(rawKey).trim();
      const keyLow = trLower(keyTrimmed);
      const isTodayKeyword = keyLow === "bugün" || keyLow === "bugun" || keyLow === "today";
      const canonicalDay = DAY_ALIASES[keyLow] || (isTodayKeyword ? "Bugün" : keyTrimmed);
      const isToday = isTodayKeyword || canonicalDay === todayTr;
      const isClosed = isClosedHoursText(hoursText);
      const is24h = /24\s*(saat|hours?)/i.test(trLower(hoursText));

      entries.push({
        day: canonicalDay,
        shortDay: TR_WEEKDAY_SHORT[canonicalDay] || canonicalDay,
        hoursText,
        isToday,
        isTodayKeyword,
        isClosed,
        is24h,
      });
    }

    entries.sort((a, b) => {
      const idxA = TR_WEEKDAYS.indexOf(a.day);
      const idxB = TR_WEEKDAYS.indexOf(b.day);
      const orderA = idxA === -1 ? TR_WEEKDAYS.length : idxA;
      const orderB = idxB === -1 ? TR_WEEKDAYS.length : idxB;
      if (orderA !== orderB) return orderA - orderB;
      return trCompare(a.day, b.day);
    });

    return { entries, rawText: "" };
  }

  function hasHours(b) {
    const parsed = parseHoursData(b ? b.hours : null);
    return parsed.entries.length > 0 || Boolean(parsed.rawText);
  }

  function getTodayHoursSummary(rawHours) {
    const { entries, rawText } = parseHoursData(rawHours);
    if (entries.length === 0) {
      if (rawText) {
        const lower = trLower(rawText);
        const isClosed = isClosedHoursText(rawText);
        const is24h = /24\s*(saat|hours?)/i.test(lower);
        return {
          hasData: true,
          fullDay: "Bugün",
          text: isClosed && lower === "closed" ? "Kapalı" : rawText,
          isClosed,
          is24h,
        };
      }
      return {
        hasData: false,
        fullDay: "",
        text: "Saat bilgisi yok",
        isClosed: false,
        is24h: false,
      };
    }

    const todayEntry = entries.find((e) => e.isToday);
    if (!todayEntry) {
      return {
        hasData: false,
        fullDay: "",
        text: "Saat bilgisi yok",
        isClosed: false,
        is24h: false,
      };
    }

    const normalizedText =
      todayEntry.isClosed && trLower(todayEntry.hoursText) === "closed"
        ? "Kapalı"
        : todayEntry.hoursText;

    return {
      hasData: true,
      fullDay: todayEntry.day,
      text: normalizedText,
      isClosed: todayEntry.isClosed,
      is24h: todayEntry.is24h,
    };
  }

  function createTodayHoursBadge(rawHours) {
    const summary = getTodayHoursSummary(rawHours);
    const badge = document.createElement("div");
    badge.className = "today-hours-badge";
    if (!summary.hasData) {
      badge.classList.add("is-missing");
    } else if (summary.isClosed) {
      badge.classList.add("is-closed");
    } else if (summary.is24h) {
      badge.classList.add("is-24h");
    }

    badge.appendChild(ICONS.clock());

    if (summary.hasData) {
      const daySpan = document.createElement("span");
      daySpan.className = "today-hours-day";
      daySpan.textContent = "Bugün ·";
      if (summary.fullDay && summary.fullDay !== "Bugün") {
        badge.title = `${summary.fullDay}: ${summary.text}`;
      }
      const timeSpan = document.createElement("span");
      timeSpan.className = "today-hours-text";
      timeSpan.textContent = summary.text;
      badge.append(daySpan, timeSpan);
    } else {
      const textSpan = document.createElement("span");
      textSpan.className = "today-hours-text";
      textSpan.textContent = "Saat bilgisi yok";
      badge.appendChild(textSpan);
    }

    return badge;
  }

  function createDetailHoursTable(rawHours) {
    const { entries, rawText } = parseHoursData(rawHours);
    if (entries.length === 0) {
      const p = document.createElement("p");
      p.className = "hours-empty-text";
      p.textContent = rawText || "Çalışma saati bilgisi yok";
      return p;
    }

    const todayTr = JS_DAY_TO_TR[new Date().getDay()];
    const byDay = new Map();
    const extras = [];

    for (const entry of entries) {
      if (TR_WEEKDAYS.includes(entry.day)) {
        byDay.set(entry.day, entry);
      } else {
        extras.push(entry);
      }
    }

    const rowsToRender = TR_WEEKDAYS.map((day) => {
      const entry = byDay.get(day);
      return {
        day,
        hoursText: entry ? entry.hoursText : null,
        isToday: entry ? entry.isToday : day === todayTr,
        isClosed: entry ? entry.isClosed : false,
        is24h: entry ? entry.is24h : false,
      };
    });

    for (const extra of extras) {
      rowsToRender.push({
        day: extra.day,
        hoursText: extra.hoursText,
        isToday: extra.isToday,
        isClosed: extra.isClosed,
        is24h: extra.is24h,
      });
    }

    const table = document.createElement("table");
    table.className = "detail-hours-table";
    const tbody = document.createElement("tbody");

    for (const item of rowsToRender) {
      const tr = document.createElement("tr");
      if (item.isToday) {
        tr.className = "is-today";
      }

      const tdDay = document.createElement("td");
      const dayWrap = document.createElement("span");
      dayWrap.className = "detail-hours-day-wrap";
      const dayText = document.createElement("span");
      dayText.textContent = item.day;
      dayWrap.appendChild(dayText);

      if (item.isToday) {
        const chip = document.createElement("span");
        chip.className = "detail-today-chip";
        chip.textContent = "Bugün";
        dayWrap.appendChild(chip);
      }
      tdDay.appendChild(dayWrap);

      const tdTime = document.createElement("td");
      const statusSpan = document.createElement("span");
      statusSpan.className = "detail-hours-status";
      if (!item.hoursText) {
        statusSpan.classList.add("is-missing");
        statusSpan.textContent = "Bilgi yok";
      } else {
        if (item.isClosed) statusSpan.classList.add("is-closed");
        else if (item.is24h) statusSpan.classList.add("is-24h");
        statusSpan.textContent =
          item.isClosed && trLower(item.hoursText) === "closed"
            ? "Kapalı"
            : item.hoursText;
      }
      tdTime.appendChild(statusSpan);

      tr.append(tdDay, tdTime);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    return table;
  }

  /* Theme management */
  function getEffectiveTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function applyTheme(theme, persist = false) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", normalized);
    if (persist) {
      safeStorageSet(localStorage, THEME_STORAGE_KEY, normalized);
    }
    const isLight = normalized === "light";
    els.themeToggle.setAttribute("aria-pressed", String(!isLight));
    els.themeToggle.setAttribute(
      "title",
      isLight ? "Koyu temaya geç" : "Açık temaya geç"
    );
    els.themeToggle.setAttribute(
      "aria-label",
      isLight ? "Koyu temaya geç" : "Açık temaya geç"
    );
    updateMapTileLayer();
  }

  function initTheme() {
    applyTheme(getEffectiveTheme(), false);
    els.themeToggle.addEventListener("click", () => {
      const next = getEffectiveTheme() === "dark" ? "light" : "dark";
      applyTheme(next, true);
    });

    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onMediaChange = (event) => {
        const saved = safeStorageGet(localStorage, THEME_STORAGE_KEY);
        if (saved !== "light" && saved !== "dark") {
          applyTheme(event.matches ? "light" : "dark", false);
        }
      };
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onMediaChange);
      }
    }
  }

  /* Floating Portal Cleanup */
  function closeActivePortal() {
    if (typeof state.activePopupCleanup === "function") {
      state.activePopupCleanup();
      state.activePopupCleanup = null;
    }
  }

  function positionPortalElement(anchorEl, dropdownEl, minWidth = 220) {
    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(rect.width, minWidth), vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));

    dropdownEl.style.width = `${width}px`;
    dropdownEl.style.left = `${left}px`;

    const spaceBelow = vh - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const openUpward = spaceBelow < 210 && spaceAbove > spaceBelow;

    if (openUpward) {
      dropdownEl.style.top = "auto";
      dropdownEl.style.bottom = `${vh - rect.top + 6}px`;
      dropdownEl.style.maxHeight = `${Math.max(140, Math.min(292, spaceAbove))}px`;
    } else {
      dropdownEl.style.bottom = "auto";
      dropdownEl.style.top = `${rect.bottom + 6}px`;
      dropdownEl.style.maxHeight = `${Math.max(140, Math.min(292, spaceBelow))}px`;
    }
  }

  /* Accessible Searchable Combobox Factory */
  function createSearchableCombobox(config) {
    const {
      input,
      toggleBtn,
      clearBtn,
      listboxId,
      getGroups,
      getSelectedValue,
      getSelectedDisplay,
      onSelect,
      onClear,
      emptyText = "Eşleşen sonuç bulunamadı.",
    } = config;

    const wrapEl = input.closest(".combobox-wrap");
    let isOpen = false;
    let filterQuery = "";
    let dropdownEl = null;
    let flatOptions = [];
    let highlightedIndex = -1;
    let cleanupListeners = null;

    function buildFilteredGroups() {
      const groups = getGroups();
      const q = filterQuery.trim();
      const out = [];

      for (const grp of groups) {
        const groupMatches = grp.group && q ? matchesSearch(grp.group, q) : false;
        let items = grp.items;

        if (q) {
          if (groupMatches) {
            items = grp.items;
          } else {
            const matched = grp.items.filter((item) => matchesSearch(item.label, q));
            matched.sort((a, b) => {
              if (a.isAllOption && !b.isAllOption) return -1;
              if (!a.isAllOption && b.isAllOption) return 1;
              const aPrefix = startsWithSearch(a.label, q);
              const bPrefix = startsWithSearch(b.label, q);
              if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
              return trCompare(a.label, b.label);
            });
            items = matched;
          }
        }

        if (items.length > 0) {
          out.push({
            group: grp.group,
            icon: grp.icon,
            items,
          });
        }
      }
      return out;
    }

    function updateHighlight(nextIndex, scrollIntoView = true) {
      if (!flatOptions.length) {
        highlightedIndex = -1;
        input.removeAttribute("aria-activedescendant");
        return;
      }

      const clamped = ((nextIndex % flatOptions.length) + flatOptions.length) % flatOptions.length;
      highlightedIndex = clamped;

      flatOptions.forEach((entry, idx) => {
        const isActive = idx === clamped;
        entry.el.classList.toggle("is-highlighted", isActive);
        if (isActive) {
          input.setAttribute("aria-activedescendant", entry.el.id);
          if (scrollIntoView) {
            entry.el.scrollIntoView({ block: "nearest" });
          }
        }
      });
    }

    function renderOptions() {
      if (!dropdownEl) return;
      dropdownEl.replaceChildren();
      flatOptions = [];

      const groups = buildFilteredGroups();
      const selectedVal = getSelectedValue();

      if (!groups.length) {
        const empty = document.createElement("div");
        empty.className = "combobox-empty";
        empty.textContent = emptyText;
        dropdownEl.appendChild(empty);
        highlightedIndex = -1;
        input.removeAttribute("aria-activedescendant");
        return;
      }

      let selectedOptionIdx = -1;
      let optIdx = 0;

      for (const grp of groups) {
        if (grp.group) {
          const header = document.createElement("div");
          header.className = "combobox-group-header";

          const titleWrap = document.createElement("span");
          titleWrap.className = "combobox-group-title";
          if (grp.icon) {
            const iconSpan = document.createElement("span");
            iconSpan.setAttribute("aria-hidden", "true");
            iconSpan.textContent = grp.icon;
            titleWrap.appendChild(iconSpan);
          }
          const grpText = document.createElement("span");
          grpText.textContent = grp.group;
          titleWrap.appendChild(grpText);

          const countSpan = document.createElement("span");
          countSpan.className = "muted tabular";
          countSpan.textContent = String(grp.items.length);

          header.append(titleWrap, countSpan);
          dropdownEl.appendChild(header);
        }

        for (const item of grp.items) {
          const optEl = document.createElement("div");
          optEl.id = `${listboxId}-opt-${optIdx}`;
          optEl.className = "combobox-option";
          optEl.setAttribute("role", "option");

          const isSelected = selectedVal === item.value;
          optEl.setAttribute("aria-selected", String(isSelected));
          if (isSelected) {
            optEl.classList.add("is-selected");
            selectedOptionIdx = optIdx;
          }
          if (item.isAllOption) {
            optEl.classList.add("is-all-option");
          }

          const labelSpan = document.createElement("span");
          labelSpan.textContent = item.label;
          optEl.appendChild(labelSpan);

          if (item.meta) {
            const metaSpan = document.createElement("span");
            metaSpan.className = "combobox-option-meta tabular";
            metaSpan.textContent = item.meta;
            optEl.appendChild(metaSpan);
          }

          const currentFlatIndex = optIdx;
          optEl.addEventListener("pointerdown", (event) => {
            event.preventDefault();
          });
          optEl.addEventListener("click", () => {
            selectItem(item);
          });
          optEl.addEventListener("mouseenter", () => {
            updateHighlight(currentFlatIndex, false);
          });

          dropdownEl.appendChild(optEl);
          flatOptions.push({ item, el: optEl });
          optIdx += 1;
        }
      }

      if (filterQuery.trim()) {
        updateHighlight(0, false);
      } else if (selectedOptionIdx >= 0) {
        updateHighlight(selectedOptionIdx, true);
      } else {
        updateHighlight(0, false);
      }
    }

    function selectItem(item) {
      onSelect(item);
      filterQuery = "";
      close({ restore: true });
    }

    function close({ restore = true } = {}) {
      if (!isOpen) return;
      isOpen = false;
      filterQuery = "";
      input.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");

      if (dropdownEl) {
        dropdownEl.remove();
        dropdownEl = null;
      }
      flatOptions = [];
      highlightedIndex = -1;

      if (cleanupListeners) {
        cleanupListeners();
        cleanupListeners = null;
      }
      if (state.activePopupCleanup === closeFnRef) {
        state.activePopupCleanup = null;
      }
      if (restore) {
        input.value = getSelectedDisplay();
      }
    }

    const closeFnRef = () => close({ restore: true });

    function open({ keepFilter = false, selectText = false } = {}) {
      if (input.disabled) return;
      if (isOpen) {
        if (keepFilter) renderOptions();
        return;
      }

      closeActivePortal();
      state.activePopupCleanup = closeFnRef;

      isOpen = true;
      if (!keepFilter) {
        filterQuery = "";
      }

      input.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");

      dropdownEl = document.createElement("div");
      dropdownEl.id = listboxId;
      dropdownEl.className = "combobox-dropdown";
      dropdownEl.setAttribute("role", "listbox");
      els.comboboxPortal.appendChild(dropdownEl);

      positionPortalElement(wrapEl, dropdownEl);
      renderOptions();

      if (selectText && input.value) {
        setTimeout(() => {
          if (isOpen && document.activeElement === input) {
            input.select();
          }
        }, 0);
      }

      const onOutsidePointerDown = (event) => {
        if (
          wrapEl.contains(event.target) ||
          (dropdownEl && dropdownEl.contains(event.target))
        ) {
          return;
        }
        close({ restore: true });
      };

      const onWindowResize = () => {
        if (dropdownEl) positionPortalElement(wrapEl, dropdownEl);
      };

      const onDocumentScroll = (event) => {
        if (dropdownEl && (event.target === dropdownEl || dropdownEl.contains(event.target))) {
          return;
        }
        if (dropdownEl) positionPortalElement(wrapEl, dropdownEl);
      };

      document.addEventListener("pointerdown", onOutsidePointerDown);
      window.addEventListener("resize", onWindowResize);
      document.addEventListener("scroll", onDocumentScroll, true);

      cleanupListeners = () => {
        document.removeEventListener("pointerdown", onOutsidePointerDown);
        window.removeEventListener("resize", onWindowResize);
        document.removeEventListener("scroll", onDocumentScroll, true);
      };
    }

    input.addEventListener("focus", () => {
      if (!isOpen && !input.disabled) {
        open({ keepFilter: false, selectText: true });
      }
    });

    input.addEventListener("click", () => {
      if (!isOpen && !input.disabled) {
        open({ keepFilter: false, selectText: true });
      }
    });

    input.addEventListener("input", () => {
      filterQuery = input.value;
      if (!isOpen) {
        open({ keepFilter: true, selectText: false });
      } else {
        renderOptions();
      }
    });

    input.addEventListener("keydown", (event) => {
      if (input.disabled) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!isOpen) {
          open({ keepFilter: false, selectText: false });
        } else {
          updateHighlight(highlightedIndex + 1, true);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen) {
          open({ keepFilter: false, selectText: false });
        } else {
          updateHighlight(highlightedIndex - 1, true);
        }
      } else if (event.key === "Home" && isOpen) {
        event.preventDefault();
        updateHighlight(0, true);
      } else if (event.key === "End" && isOpen) {
        event.preventDefault();
        updateHighlight(flatOptions.length - 1, true);
      } else if (event.key === "Enter" && isOpen) {
        event.preventDefault();
        if (highlightedIndex >= 0 && flatOptions[highlightedIndex]) {
          selectItem(flatOptions[highlightedIndex].item);
        }
      } else if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        close({ restore: true });
      } else if (event.key === "Tab" && isOpen) {
        close({ restore: true });
      }
    });

    toggleBtn.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    toggleBtn.addEventListener("click", () => {
      if (input.disabled) return;
      if (isOpen) {
        close({ restore: true });
      } else {
        input.focus();
        open({ keepFilter: false, selectText: true });
      }
    });

    if (clearBtn && onClear) {
      clearBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        close({ restore: false });
        onClear();
      });
    }

    return {
      syncDisplay() {
        if (!isOpen) {
          input.value = getSelectedDisplay();
        }
      },
      close,
    };
  }

  function updateQueryPreview() {
    const region = getSelectedApiRegion();
    const category = state.selectedCategory ? state.selectedCategory.value : null;

    if (region && category) {
      els.queryPreviewText.textContent = `${region} · ${category}`;
      els.queryPreviewText.classList.remove("is-empty");
    } else if (region) {
      els.queryPreviewText.textContent = `${region} · İşletme türü seçin`;
      els.queryPreviewText.classList.add("is-empty");
    } else if (category) {
      els.queryPreviewText.textContent = `İl seçin · ${category}`;
      els.queryPreviewText.classList.add("is-empty");
    } else {
      els.queryPreviewText.textContent = "İl ve işletme türü seçin";
      els.queryPreviewText.classList.add("is-empty");
    }
  }

  function getSelectedApiRegion() {
    if (!state.selectedIl) return null;
    if (state.selectedIlce && state.selectedIlce !== ALL_DISTRICTS_VALUE) {
      return `${state.selectedIlce}, ${state.selectedIl}`;
    }
    return state.selectedIl;
  }

  function applyIlSelection(ilName) {
    const regionObj = state.ilLookup.get(trLower(ilName));
    if (!regionObj) return;

    state.selectedIl = regionObj.il;
    state.selectedIlce = ALL_DISTRICTS_VALUE;

    els.ilPlakaBadge.textContent = `Plaka ${String(regionObj.plaka).padStart(2, "0")}`;
    els.ilPlakaBadge.hidden = false;
    els.ilClearBtn.hidden = false;

    els.ilceInput.disabled = false;
    els.ilceToggleBtn.disabled = false;
    els.ilceInput.placeholder = "İlçe ara veya Tüm ilçeler...";
    els.ilceCountHint.textContent = `${regionObj.ilceler.length} ilçe`;

    if (ilCombobox) ilCombobox.syncDisplay();
    if (ilceCombobox) ilceCombobox.syncDisplay();
    updateQueryPreview();
    showFormError("");
  }

  function clearIlSelection() {
    state.selectedIl = null;
    state.selectedIlce = null;

    els.ilPlakaBadge.hidden = true;
    els.ilPlakaBadge.textContent = "";
    els.ilClearBtn.hidden = true;

    els.ilceInput.disabled = true;
    els.ilceToggleBtn.disabled = true;
    els.ilceInput.value = "";
    els.ilceInput.placeholder = "Önce il seçin";
    els.ilceCountHint.textContent = "";

    if (ilCombobox) ilCombobox.syncDisplay();
    if (ilceCombobox) ilceCombobox.close({ restore: false });
    updateQueryPreview();
  }

  function applyCategorySelection(item) {
    state.selectedCategory = {
      value: item.value,
      group: item.group,
      icon: item.icon,
    };
    els.categoryGroupBadge.textContent = `${item.icon} ${item.group}`;
    els.categoryGroupBadge.hidden = false;
    els.categoryClearBtn.hidden = false;

    if (categoryCombobox) categoryCombobox.syncDisplay();
    updateQueryPreview();
    showFormError("");
  }

  function clearCategorySelection() {
    state.selectedCategory = null;
    els.categoryGroupBadge.hidden = true;
    els.categoryGroupBadge.textContent = "";
    els.categoryClearBtn.hidden = true;

    if (categoryCombobox) categoryCombobox.syncDisplay();
    updateQueryPreview();
  }

  function applyScanMode(mode, persist = false) {
    const normalized = mode === "batch" ? "batch" : "single";
    state.scanMode = normalized;
    closeActivePortal();
    showFormError("");

    const isBatch = normalized === "batch";
    els.singleFields.hidden = isBatch;
    els.batchFields.hidden = !isBatch;
    if (els.startBtnLabel) {
      els.startBtnLabel.textContent = isBatch ? "Toplu Taramayı Başlat" : "Taramayı Başlat";
    }
    for (const btn of els.modeToggleBtns) {
      const active = btn.dataset.mode === normalized;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    if (persist) {
      try {
        safeStorageSet(localStorage, SCAN_MODE_STORAGE_KEY, normalized);
      } catch {
        // Storage unavailable
      }
    }
  }

  function initScanMode() {
    let saved = null;
    try {
      saved = safeStorageGet(localStorage, SCAN_MODE_STORAGE_KEY);
    } catch {
      saved = null;
    }
    applyScanMode(saved === "batch" ? "batch" : "single", false);
  }

  function getOrderedBatchIlces() {
    if (!state.batchIl) return [];
    const regionObj = state.ilLookup.get(trLower(state.batchIl));
    if (!regionObj) return Array.from(state.batchSelectedIlces).sort(trCompare);
    return regionObj.ilceler.filter((ilce) => state.batchSelectedIlces.has(ilce));
  }

  function getOrderedBatchCategories() {
    const out = [];
    const seen = new Set();
    for (const grp of state.categories) {
      for (const name of grp.items) {
        if (state.batchSelectedCategories.has(name) && !seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    }
    for (const name of Array.from(state.batchSelectedCategories).sort(trCompare)) {
      if (!seen.has(name)) {
        out.push(name);
      }
    }
    return out;
  }

  function getBatchRegionsCount() {
    return (state.batchIlGeneli ? 1 : 0) + state.batchSelectedIlces.size;
  }

  function createBatchChip(labelText, removeLabel, onRemove) {
    const chip = document.createElement("span");
    chip.className = "batch-chip";

    const textSpan = document.createElement("span");
    textSpan.className = "batch-chip-text";
    textSpan.textContent = labelText;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "batch-chip-remove";
    btn.setAttribute("aria-label", removeLabel);
    btn.disabled = Boolean(state.activeJobId || isBatchActive() || state.batchSubmitPending);
    btn.appendChild(ICONS.close());
    btn.addEventListener("click", onRemove);

    chip.append(textSpan, btn);
    return chip;
  }

  function updateBatchSummary() {
    const n = getBatchRegionsCount();
    const m = state.batchSelectedCategories.size;
    const k = n * m;

    els.batchSummaryText.textContent = `${n.toLocaleString("tr-TR")} ilçe × ${m.toLocaleString("tr-TR")} tür = ${k.toLocaleString("tr-TR")} arama`;
    els.batchSummaryCard.classList.remove("is-ready", "is-warning", "is-over-limit");

    if (k > BATCH_MAX_ITEMS_LIMIT) {
      els.batchSummaryCard.classList.add("is-over-limit");
      els.batchSummaryWarn.textContent = `Tek seferde en fazla ${BATCH_MAX_ITEMS_LIMIT} arama başlatılabilir. Lütfen ilçe veya tür sayısını azaltın.`;
      els.batchSummaryWarn.hidden = false;
    } else if (k > BATCH_WARN_ITEMS_THRESHOLD) {
      els.batchSummaryCard.classList.add("is-warning");
      els.batchSummaryWarn.textContent = `Uyarı: ${BATCH_WARN_ITEMS_THRESHOLD}'den fazla arama (${k.toLocaleString("tr-TR")}) uzun sürebilir ve CAPTCHA riskini artırabilir.`;
      els.batchSummaryWarn.hidden = false;
    } else {
      if (k > 0) {
        els.batchSummaryCard.classList.add("is-ready");
      }
      els.batchSummaryWarn.textContent = "";
      els.batchSummaryWarn.hidden = true;
    }
  }

  function syncBatchIlceUi() {
    const regionObj = state.batchIl ? state.ilLookup.get(trLower(state.batchIl)) : null;
    if (!regionObj) {
      state.batchIlceAll = false;
      els.batchIlceAllBtn.classList.remove("is-active");
      els.batchIlceAllBtn.setAttribute("aria-pressed", "false");
      els.batchIlceSelectLabel.textContent = "Önce il seçin";
      els.batchIlceSelectBtn.classList.remove("has-selection");
      els.batchIlceChips.replaceChildren();
      els.batchIlceChips.hidden = true;
      return;
    }

    state.batchIlceAll =
      regionObj.ilceler.length > 0 && state.batchSelectedIlces.size === regionObj.ilceler.length;
    els.batchIlceAllBtn.classList.toggle("is-active", state.batchIlceAll);
    els.batchIlceAllBtn.setAttribute("aria-pressed", String(state.batchIlceAll));

    const totalSelected = getBatchRegionsCount();
    if (totalSelected === 0) {
      els.batchIlceSelectLabel.textContent = "İlçe veya İl geneli seçin...";
      els.batchIlceSelectBtn.classList.remove("has-selection");
    } else {
      els.batchIlceSelectBtn.classList.add("has-selection");
      if (state.batchIlceAll && !state.batchIlGeneli) {
        els.batchIlceSelectLabel.textContent = `Tüm ilçeler (${regionObj.ilceler.length})`;
      } else if (state.batchIlGeneli && state.batchSelectedIlces.size === 0) {
        els.batchIlceSelectLabel.textContent = `${regionObj.il} (İl geneli)`;
      } else if (state.batchSelectedIlces.size === 1 && !state.batchIlGeneli) {
        els.batchIlceSelectLabel.textContent = getOrderedBatchIlces()[0];
      } else if (state.batchIlGeneli) {
        els.batchIlceSelectLabel.textContent = `İl geneli + ${state.batchSelectedIlces.size} ilçe`;
      } else {
        els.batchIlceSelectLabel.textContent = `${state.batchSelectedIlces.size} ilçe seçili`;
      }
    }

    const frag = document.createDocumentFragment();
    if (state.batchIlGeneli) {
      frag.appendChild(
        createBatchChip(`${regionObj.il} (İl geneli)`, `${regionObj.il} (İl geneli) seçimini kaldır`, () => {
          state.batchIlGeneli = false;
          syncBatchIlceUi();
          updateBatchSummary();
        })
      );
    }
    for (const ilce of getOrderedBatchIlces()) {
      frag.appendChild(
        createBatchChip(ilce, `${ilce} seçimini kaldır`, () => {
          state.batchSelectedIlces.delete(ilce);
          syncBatchIlceUi();
          updateBatchSummary();
        })
      );
    }

    els.batchIlceChips.replaceChildren(frag);
    els.batchIlceChips.hidden = totalSelected === 0;
  }

  function syncBatchCategoryUi() {
    const selectedCats = getOrderedBatchCategories();
    const count = selectedCats.length;
    els.batchCatCountHint.textContent = `${count} seçili`;

    if (count === 0) {
      els.batchCatSelectLabel.textContent = "İşletme türü seçin...";
      els.batchCatSelectBtn.classList.remove("has-selection");
      els.batchCatChips.replaceChildren();
      els.batchCatChips.hidden = true;
      return;
    }

    els.batchCatSelectBtn.classList.add("has-selection");
    els.batchCatSelectLabel.textContent = count === 1 ? selectedCats[0] : `${count} işletme türü seçili`;

    const frag = document.createDocumentFragment();
    for (const cat of selectedCats) {
      frag.appendChild(
        createBatchChip(cat, `${cat} seçimini kaldır`, () => {
          state.batchSelectedCategories.delete(cat);
          syncBatchCategoryUi();
          updateBatchSummary();
        })
      );
    }
    els.batchCatChips.replaceChildren(frag);
    els.batchCatChips.hidden = false;
  }

  function toggleBatchAllIlces(forceState = null) {
    if (!state.batchIl) return;
    const regionObj = state.ilLookup.get(trLower(state.batchIl));
    if (!regionObj) return;

    const enableAll = forceState === null ? !state.batchIlceAll : Boolean(forceState);
    state.batchSelectedIlces.clear();
    if (enableAll) {
      for (const ilce of regionObj.ilceler) {
        state.batchSelectedIlces.add(ilce);
      }
    }
    syncBatchIlceUi();
    updateBatchSummary();
    showFormError("");
  }

  function applyBatchIlSelection(ilName) {
    const regionObj = state.ilLookup.get(trLower(ilName));
    if (!regionObj) return;

    const ilChanged = state.batchIl !== regionObj.il;
    state.batchIl = regionObj.il;
    if (ilChanged) {
      state.batchSelectedIlces.clear();
      state.batchIlGeneli = false;
      state.batchIlceAll = false;
    }

    els.batchIlPlakaBadge.textContent = `Plaka ${String(regionObj.plaka).padStart(2, "0")}`;
    els.batchIlPlakaBadge.hidden = false;
    els.batchIlClearBtn.hidden = false;

    const blocking = Boolean(state.activeJobId || isBatchActive() || state.batchSubmitPending);
    els.batchIlceSelectBtn.disabled = blocking;
    els.batchIlceAllBtn.disabled = blocking;
    els.batchIlceCountHint.textContent = `${regionObj.ilceler.length} ilçe`;

    if (batchIlCombobox) batchIlCombobox.syncDisplay();
    syncBatchIlceUi();
    updateBatchSummary();
    showFormError("");
  }

  function clearBatchIlSelection() {
    state.batchIl = null;
    state.batchIlGeneli = false;
    state.batchSelectedIlces.clear();
    state.batchIlceAll = false;

    els.batchIlPlakaBadge.hidden = true;
    els.batchIlPlakaBadge.textContent = "";
    els.batchIlClearBtn.hidden = true;

    els.batchIlceSelectBtn.disabled = true;
    els.batchIlceAllBtn.disabled = true;
    els.batchIlceCountHint.textContent = "";

    if (batchIlCombobox) batchIlCombobox.syncDisplay();
    syncBatchIlceUi();
    updateBatchSummary();
  }

  function mountBatchMultiPopover({ anchorBtn, ariaLabel, searchPlaceholder, onClear, renderBody }) {
    if (anchorBtn.disabled) return;
    if (anchorBtn.getAttribute("aria-expanded") === "true") {
      closeActivePortal();
      return;
    }

    closeActivePortal();

    const popover = document.createElement("div");
    popover.className = "combobox-dropdown multi-select-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", ariaLabel);

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "multi-select-search";
    searchInput.placeholder = searchPlaceholder;
    searchInput.setAttribute("aria-label", ariaLabel);

    const listWrap = document.createElement("div");
    listWrap.className = "multi-select-list";

    const footer = document.createElement("div");
    footer.className = "multi-select-footer";

    const selCountSpan = document.createElement("span");
    selCountSpan.className = "muted tabular";
    selCountSpan.style.fontSize = "0.75rem";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "btn btn-ghost btn-sm";
    clearBtn.textContent = "Temizle";

    footer.append(selCountSpan, clearBtn);
    popover.append(searchInput, listWrap, footer);

    const refresh = () => {
      renderBody(listWrap, searchInput.value.trim(), selCountSpan);
    };

    searchInput.addEventListener("input", refresh);
    clearBtn.addEventListener("click", () => {
      onClear();
      refresh();
    });

    els.comboboxPortal.appendChild(popover);
    positionPortalElement(anchorBtn, popover, 280);
    anchorBtn.setAttribute("aria-expanded", "true");
    refresh();

    setTimeout(() => searchInput.focus(), 0);

    const closePopover = () => {
      anchorBtn.setAttribute("aria-expanded", "false");
      popover.remove();
      document.removeEventListener("pointerdown", onOutsideDown);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onEsc);
      if (state.activePopupCleanup === closePopover) {
        state.activePopupCleanup = null;
      }
    };

    const onOutsideDown = (event) => {
      if (anchorBtn.contains(event.target) || popover.contains(event.target)) return;
      closePopover();
    };
    const onResize = () => positionPortalElement(anchorBtn, popover, 280);
    const onScroll = (event) => {
      if (popover.contains(event.target)) return;
      positionPortalElement(anchorBtn, popover, 280);
    };
    const onEsc = (event) => {
      if (event.key === "Escape") {
        closePopover();
        anchorBtn.focus();
      }
    };

    document.addEventListener("pointerdown", onOutsideDown);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onEsc);
    state.activePopupCleanup = closePopover;
  }

  function openBatchIlcePopover() {
    if (!state.batchIl) return;
    const regionObj = state.ilLookup.get(trLower(state.batchIl));
    if (!regionObj) return;

    mountBatchMultiPopover({
      anchorBtn: els.batchIlceSelectBtn,
      ariaLabel: "İlçe çoklu seçimi",
      searchPlaceholder: "İlçe veya İl geneli ara...",
      onClear: () => {
        state.batchIlGeneli = false;
        state.batchSelectedIlces.clear();
        syncBatchIlceUi();
        updateBatchSummary();
      },
      renderBody: (listWrap, q, selCountSpan) => {
        listWrap.replaceChildren();
        selCountSpan.textContent = `${getBatchRegionsCount()} seçili`;

        let renderedAny = false;
        const showIlGeneli = !q || matchesSearch("İl geneli", q) || matchesSearch(regionObj.il, q);
        if (showIlGeneli) {
          renderedAny = true;
          const lbl = document.createElement("label");
          lbl.className = "multi-select-item multi-select-item-special";

          const left = document.createElement("span");
          left.className = "multi-select-item-left";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = state.batchIlGeneli;
          cb.addEventListener("change", () => {
            state.batchIlGeneli = cb.checked;
            selCountSpan.textContent = `${getBatchRegionsCount()} seçili`;
            syncBatchIlceUi();
            updateBatchSummary();
            showFormError("");
          });

          const text = document.createElement("span");
          text.textContent = `${regionObj.il} (İl geneli)`;
          left.append(cb, text);

          const meta = document.createElement("span");
          meta.className = "combobox-option-meta";
          meta.textContent = "Yalnızca il";

          lbl.append(left, meta);
          listWrap.appendChild(lbl);
        }

        const filteredIlces = q
          ? regionObj.ilceler
              .filter((d) => matchesSearch(d, q))
              .sort((a, b) => {
                const ap = startsWithSearch(a, q);
                const bp = startsWithSearch(b, q);
                if (ap !== bp) return ap ? -1 : 1;
                return trCompare(a, b);
              })
          : regionObj.ilceler;

        let allToggleCb = null;
        const districtCheckboxes = [];

        if (!q || matchesSearch("Tüm ilçeler", q)) {
          renderedAny = true;
          const allLbl = document.createElement("label");
          allLbl.className = "multi-select-item multi-select-item-special";

          const left = document.createElement("span");
          left.className = "multi-select-item-left";

          allToggleCb = document.createElement("input");
          allToggleCb.type = "checkbox";
          allToggleCb.checked = state.batchIlceAll;
          allToggleCb.addEventListener("change", () => {
            toggleBatchAllIlces(allToggleCb.checked);
            for (const itemCb of districtCheckboxes) {
              itemCb.checked = allToggleCb.checked;
            }
            selCountSpan.textContent = `${getBatchRegionsCount()} seçili`;
          });

          const text = document.createElement("span");
          text.textContent = "Tüm ilçeler";
          left.append(allToggleCb, text);

          const meta = document.createElement("span");
          meta.className = "combobox-option-meta tabular";
          meta.textContent = `${regionObj.ilceler.length} ilçe`;

          allLbl.append(left, meta);
          listWrap.appendChild(allLbl);
        }

        for (const ilce of filteredIlces) {
          renderedAny = true;
          const lbl = document.createElement("label");
          lbl.className = "multi-select-item";

          const left = document.createElement("span");
          left.className = "multi-select-item-left";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = state.batchSelectedIlces.has(ilce);
          cb.addEventListener("change", () => {
            if (cb.checked) {
              state.batchSelectedIlces.add(ilce);
            } else {
              state.batchSelectedIlces.delete(ilce);
            }
            syncBatchIlceUi();
            updateBatchSummary();
            showFormError("");
            selCountSpan.textContent = `${getBatchRegionsCount()} seçili`;
            if (allToggleCb) {
              allToggleCb.checked = state.batchIlceAll;
            }
          });
          districtCheckboxes.push(cb);

          const text = document.createElement("span");
          text.textContent = ilce;
          left.append(cb, text);
          lbl.appendChild(left);
          listWrap.appendChild(lbl);
        }

        if (!renderedAny) {
          const empty = document.createElement("div");
          empty.className = "combobox-empty";
          empty.textContent = "Eşleşen ilçe bulunamadı.";
          listWrap.appendChild(empty);
        }
      },
    });
  }

  function openBatchCatPopover() {
    mountBatchMultiPopover({
      anchorBtn: els.batchCatSelectBtn,
      ariaLabel: "İşletme türü çoklu seçimi",
      searchPlaceholder: "Kategori ara...",
      onClear: () => {
        state.batchSelectedCategories.clear();
        syncBatchCategoryUi();
        updateBatchSummary();
      },
      renderBody: (listWrap, q, selCountSpan) => {
        listWrap.replaceChildren();
        selCountSpan.textContent = `${state.batchSelectedCategories.size} seçili`;

        let renderedAny = false;
        for (const grp of state.categories) {
          const groupMatches = grp.group && q ? matchesSearch(grp.group, q) : false;
          let items = grp.items;
          if (q && !groupMatches) {
            items = grp.items
              .filter((name) => matchesSearch(name, q))
              .sort((a, b) => {
                const ap = startsWithSearch(a, q);
                const bp = startsWithSearch(b, q);
                if (ap !== bp) return ap ? -1 : 1;
                return trCompare(a, b);
              });
          }
          if (!items.length) continue;
          renderedAny = true;

          if (grp.group) {
            const header = document.createElement("div");
            header.className = "combobox-group-header";

            const titleWrap = document.createElement("span");
            titleWrap.className = "combobox-group-title";
            if (grp.icon) {
              const iconSpan = document.createElement("span");
              iconSpan.setAttribute("aria-hidden", "true");
              iconSpan.textContent = grp.icon;
              titleWrap.appendChild(iconSpan);
            }
            const grpText = document.createElement("span");
            grpText.textContent = grp.group;
            titleWrap.appendChild(grpText);

            const countSpan = document.createElement("span");
            countSpan.className = "muted tabular";
            countSpan.textContent = String(items.length);

            header.append(titleWrap, countSpan);
            listWrap.appendChild(header);
          }

          for (const name of items) {
            const lbl = document.createElement("label");
            lbl.className = "multi-select-item";

            const left = document.createElement("span");
            left.className = "multi-select-item-left";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = state.batchSelectedCategories.has(name);
            cb.addEventListener("change", () => {
              if (cb.checked) {
                state.batchSelectedCategories.add(name);
              } else {
                state.batchSelectedCategories.delete(name);
              }
              selCountSpan.textContent = `${state.batchSelectedCategories.size} seçili`;
              syncBatchCategoryUi();
              updateBatchSummary();
              showFormError("");
            });

            const text = document.createElement("span");
            text.textContent = name;
            left.append(cb, text);
            lbl.appendChild(left);
            listWrap.appendChild(lbl);
          }
        }

        if (!renderedAny) {
          const empty = document.createElement("div");
          empty.className = "combobox-empty";
          empty.textContent = state.categories.length
            ? "Eşleşen kategori bulunamadı."
            : "Kategori verisi yükleniyor...";
          listWrap.appendChild(empty);
        }
      },
    });
  }

  function initComboboxes() {
    const buildIlGroups = () => [
      {
        group: null,
        icon: null,
        items: state.regions.map((r) => ({
          value: r.il,
          label: r.il,
          meta: `${String(r.plaka).padStart(2, "0")} · ${r.ilceler.length} ilçe`,
        })),
      },
    ];

    ilCombobox = createSearchableCombobox({
      input: els.ilInput,
      toggleBtn: els.ilToggleBtn,
      clearBtn: els.ilClearBtn,
      listboxId: "il-listbox",
      getGroups: buildIlGroups,
      getSelectedValue: () => state.selectedIl,
      getSelectedDisplay: () => state.selectedIl || "",
      onSelect: (item) => applyIlSelection(item.value),
      onClear: () => {
        clearIlSelection();
        els.ilInput.focus();
      },
      emptyText: "Eşleşen il bulunamadı.",
    });

    batchIlCombobox = createSearchableCombobox({
      input: els.batchIlInput,
      toggleBtn: els.batchIlToggleBtn,
      clearBtn: els.batchIlClearBtn,
      listboxId: "batch-il-listbox",
      getGroups: buildIlGroups,
      getSelectedValue: () => state.batchIl,
      getSelectedDisplay: () => state.batchIl || "",
      onSelect: (item) => applyBatchIlSelection(item.value),
      onClear: () => {
        clearBatchIlSelection();
        els.batchIlInput.focus();
      },
      emptyText: "Eşleşen il bulunamadı.",
    });

    ilceCombobox = createSearchableCombobox({
      input: els.ilceInput,
      toggleBtn: els.ilceToggleBtn,
      clearBtn: null,
      listboxId: "ilce-listbox",
      getGroups: () => {
        if (!state.selectedIl) return [];
        const regionObj = state.ilLookup.get(trLower(state.selectedIl));
        if (!regionObj) return [];
        const items = [
          {
            value: ALL_DISTRICTS_VALUE,
            label: "Tüm ilçeler",
            meta: `${regionObj.il} geneli`,
            isAllOption: true,
          },
          ...regionObj.ilceler.map((ilce) => ({
            value: ilce,
            label: ilce,
          })),
        ];
        return [{ group: null, icon: null, items }];
      },
      getSelectedValue: () => state.selectedIlce,
      getSelectedDisplay: () => {
        if (!state.selectedIl) return "";
        if (!state.selectedIlce || state.selectedIlce === ALL_DISTRICTS_VALUE) {
          return "Tüm ilçeler";
        }
        return state.selectedIlce;
      },
      onSelect: (item) => {
        state.selectedIlce = item.value;
        ilceCombobox.syncDisplay();
        updateQueryPreview();
      },
      emptyText: "Eşleşen ilçe bulunamadı.",
    });

    categoryCombobox = createSearchableCombobox({
      input: els.categoryInput,
      toggleBtn: els.categoryToggleBtn,
      clearBtn: els.categoryClearBtn,
      listboxId: "category-listbox",
      getGroups: () =>
        state.categories.map((grp) => ({
          group: grp.group,
          icon: grp.icon,
          items: grp.items.map((name) => ({
            value: name,
            label: name,
            group: grp.group,
            icon: grp.icon,
          })),
        })),
      getSelectedValue: () => (state.selectedCategory ? state.selectedCategory.value : null),
      getSelectedDisplay: () => (state.selectedCategory ? state.selectedCategory.value : ""),
      onSelect: (item) => applyCategorySelection(item),
      onClear: () => {
        clearCategorySelection();
        els.categoryInput.focus();
      },
      emptyText: "Eşleşen kategori bulunamadı.",
    });
  }

  async function loadReferenceData() {
    try {
      const [regResp, catResp] = await Promise.all([
        fetch("/static/data/regions.json"),
        fetch("/static/data/categories.json"),
      ]);

      if (!regResp.ok || !catResp.ok) {
        throw new Error("Referans verileri yüklenemedi.");
      }

      const rawRegions = await regResp.json();
      const rawCategories = await catResp.json();

      const sortedRegions = (Array.isArray(rawRegions) ? rawRegions : [])
        .map((r) => ({
          il: String(r.il).trim(),
          plaka: Number(r.plaka),
          bolge: String(r.bolge || "").trim(),
          ilceler: (Array.isArray(r.ilceler) ? r.ilceler : [])
            .map((d) => String(d).trim())
            .filter(Boolean)
            .sort(trCompare),
        }))
        .sort((a, b) => trCompare(a.il, b.il));

      state.regions = sortedRegions;
      state.ilLookup.clear();

      const ilceFrequency = new Map();
      const ilceOwner = new Map();
      for (const r of sortedRegions) {
        state.ilLookup.set(trLower(r.il), r);
        for (const d of r.ilceler) {
          const dk = trLower(d);
          ilceFrequency.set(dk, (ilceFrequency.get(dk) || 0) + 1);
          ilceOwner.set(dk, { il: r.il, ilce: d });
        }
      }

      state.uniqueIlceToIl.clear();
      for (const [dk, count] of ilceFrequency.entries()) {
        if (count === 1) {
          state.uniqueIlceToIl.set(dk, ilceOwner.get(dk));
        }
      }

      state.categories = (Array.isArray(rawCategories) ? rawCategories : []).map((grp) => ({
        group: String(grp.group || "").trim(),
        icon: String(grp.icon || "").trim(),
        items: (Array.isArray(grp.items) ? grp.items : [])
          .map((item) => String(item).trim())
          .filter(Boolean)
          .sort(trCompare),
      }));
    } catch (err) {
      showFormError(`Bölge veya kategori listesi yüklenemedi: ${err.message}`);
      showToast("İl/ilçe veya kategori verileri yüklenemedi.", "error");
    }
  }

  /* Derive İl and İlçe from search_region */
  function deriveRegionParts(searchRegion) {
    const raw = String(searchRegion ?? "").trim();
    if (!raw) return { il: null, ilce: null };

    if (raw.includes(",")) {
      const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        const first = parts.slice(0, -1).join(", ");
        const matchedLast = state.ilLookup.get(trLower(last));
        if (matchedLast) {
          const canonicalIlce =
            matchedLast.ilceler.find((d) => trLower(d) === trLower(first)) || first;
          return { il: matchedLast.il, ilce: canonicalIlce };
        }
        const matchedFirst = state.ilLookup.get(trLower(first));
        if (matchedFirst) {
          return { il: matchedFirst.il, ilce: last };
        }
        return { il: last, ilce: first };
      }
    }

    const matchedIl = state.ilLookup.get(trLower(raw));
    if (matchedIl) {
      return { il: matchedIl.il, ilce: null };
    }

    const uniqueDistrict = state.uniqueIlceToIl.get(trLower(raw));
    if (uniqueDistrict) {
      return { il: uniqueDistrict.il, ilce: uniqueDistrict.ilce };
    }

    return { il: raw, ilce: null };
  }

  function getBusinessDistrict(b) {
    if (!b) return "";
    const parts = deriveRegionParts(b.search_region);
    if (parts.ilce) return parts.ilce;

    const address = String(b.address ?? "").trim();
    if (address) {
      const slashMatches = address.matchAll(
        /([A-Za-zÇĞİÖŞÜçğıöşü0-9\s.'-]+?)\s*\/\s*([A-Za-zÇĞİÖŞÜçğıöşü]+)/g
      );
      for (const match of slashMatches) {
        const leftRaw = match[1].replace(/^\d+\s+/, "").trim();
        const rightRaw = match[2].trim();
        const matchedIl = state.ilLookup.get(trLower(rightRaw));
        if (matchedIl) {
          const tokens = leftRaw.split(/[\s,]+/).filter(Boolean);
          if (tokens.length > 0) {
            const lastOne = tokens[tokens.length - 1];
            const lastTwo = tokens.length >= 2 ? tokens.slice(-2).join(" ") : "";
            const foundTwo = lastTwo
              ? matchedIl.ilceler.find((d) => trLower(d) === trLower(lastTwo))
              : null;
            if (foundTwo) return foundTwo;
            const foundOne = matchedIl.ilceler.find((d) => trLower(d) === trLower(lastOne));
            if (foundOne) return foundOne;
            return lastOne;
          }
        }
      }

      if (parts.il) {
        const ilObj = state.ilLookup.get(trLower(parts.il));
        if (ilObj) {
          const addrLow = trLower(address);
          const sortedIlceler = ilObj.ilceler.slice().sort((a, c) => c.length - a.length);
          for (const d of sortedIlceler) {
            const dl = trLower(d);
            if (
              addrLow.includes(`${dl}/`) ||
              addrLow.includes(`${dl} /`) ||
              addrLow.includes(`, ${dl}`)
            ) {
              return d;
            }
          }
        }
      }
    }

    return parts.il || "";
  }

  /* Client-Side Filter Options & Evaluation */
  function getUniqueMapsCategories() {
    const counts = new Map();
    for (const b of state.businesses) {
      const cat = b.category ? String(b.category).trim() : "";
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => trCompare(a[0], b[0]))
      .map(([name, count]) => ({ name, count }));
  }

  function populateFilterDropdowns() {
    const ils = new Set();
    const searchCats = new Set();

    for (const b of state.businesses) {
      const { il } = deriveRegionParts(b.search_region);
      if (il) ils.add(il);
      if (b.search_category && String(b.search_category).trim()) {
        searchCats.add(String(b.search_category).trim());
      }
    }

    const prevIl = state.filters.il;
    els.filterIl.replaceChildren();
    const defaultIlOpt = document.createElement("option");
    defaultIlOpt.value = "";
    defaultIlOpt.textContent = "Tüm iller";
    els.filterIl.appendChild(defaultIlOpt);

    for (const il of Array.from(ils).sort(trCompare)) {
      const opt = document.createElement("option");
      opt.value = il;
      opt.textContent = il;
      els.filterIl.appendChild(opt);
    }

    if (prevIl && ils.has(prevIl)) {
      els.filterIl.value = prevIl;
    } else {
      state.filters.il = "";
      els.filterIl.value = "";
    }

    populateFilterIlceOptions();

    const prevSc = state.filters.searchCategory;
    els.filterSearchCat.replaceChildren();
    const defaultScOpt = document.createElement("option");
    defaultScOpt.value = "";
    defaultScOpt.textContent = "Tüm türler";
    els.filterSearchCat.appendChild(defaultScOpt);

    for (const sc of Array.from(searchCats).sort(trCompare)) {
      const opt = document.createElement("option");
      opt.value = sc;
      opt.textContent = sc;
      els.filterSearchCat.appendChild(opt);
    }

    if (prevSc && searchCats.has(prevSc)) {
      els.filterSearchCat.value = prevSc;
    } else {
      state.filters.searchCategory = "";
      els.filterSearchCat.value = "";
    }

    const availableMapsCats = new Set(getUniqueMapsCategories().map((c) => c.name));
    for (const selected of Array.from(state.filters.mapsCategories)) {
      if (!availableMapsCats.has(selected)) {
        state.filters.mapsCategories.delete(selected);
      }
    }
    updateMapsCatButtonLabel();
  }

  function populateFilterIlceOptions() {
    const selectedIl = state.filters.il;
    const ilceler = new Set();

    if (selectedIl) {
      for (const b of state.businesses) {
        const parts = deriveRegionParts(b.search_region);
        if (parts.il === selectedIl && parts.ilce) {
          ilceler.add(parts.ilce);
        }
      }
    }

    const prevIlce = state.filters.ilce;
    els.filterIlce.replaceChildren();
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = selectedIl ? "Tüm ilçeler" : "Önce il seçin";
    els.filterIlce.appendChild(defaultOpt);

    for (const ilce of Array.from(ilceler).sort(trCompare)) {
      const opt = document.createElement("option");
      opt.value = ilce;
      opt.textContent = ilce;
      els.filterIlce.appendChild(opt);
    }

    els.filterIlce.disabled = !selectedIl || ilceler.size === 0;
    if (selectedIl && prevIlce && ilceler.has(prevIlce)) {
      els.filterIlce.value = prevIlce;
    } else {
      state.filters.ilce = "";
      els.filterIlce.value = "";
    }
  }

  function updateMapsCatButtonLabel() {
    const count = state.filters.mapsCategories.size;
    if (count === 0) {
      els.filterMapsCatLabel.textContent = "Tüm kategoriler";
      els.filterMapsCatBtn.classList.remove("has-selection");
    } else if (count === 1) {
      els.filterMapsCatLabel.textContent = Array.from(state.filters.mapsCategories)[0];
      els.filterMapsCatBtn.classList.add("has-selection");
    } else {
      els.filterMapsCatLabel.textContent = `${count} kategori seçili`;
      els.filterMapsCatBtn.classList.add("has-selection");
    }
  }

  function openMapsCategoryPopover() {
    const btn = els.filterMapsCatBtn;
    if (btn.getAttribute("aria-expanded") === "true") {
      closeActivePortal();
      return;
    }

    closeActivePortal();

    const categories = getUniqueMapsCategories();
    const popover = document.createElement("div");
    popover.className = "combobox-dropdown multi-select-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Maps kategorisi seçimi");

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "multi-select-search";
    searchInput.placeholder = "Kategori ara...";
    searchInput.setAttribute("aria-label", "Maps kategorisi ara");

    const listWrap = document.createElement("div");
    listWrap.className = "multi-select-list";

    const footer = document.createElement("div");
    footer.className = "multi-select-footer";

    const selCountSpan = document.createElement("span");
    selCountSpan.className = "muted tabular";
    selCountSpan.style.fontSize = "0.75rem";

    const clearCatsBtn = document.createElement("button");
    clearCatsBtn.type = "button";
    clearCatsBtn.className = "btn btn-ghost btn-sm";
    clearCatsBtn.textContent = "Seçimi Temizle";

    footer.append(selCountSpan, clearCatsBtn);
    popover.append(searchInput, listWrap, footer);

    function renderPopoverList() {
      const q = searchInput.value.trim();
      listWrap.replaceChildren();

      const filtered = q
        ? categories.filter((c) => matchesSearch(c.name, q))
        : categories;

      selCountSpan.textContent = `${state.filters.mapsCategories.size} seçili`;

      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "combobox-empty";
        empty.textContent = categories.length
          ? "Kategori bulunamadı."
          : "Henüz Maps kategorisi yok.";
        listWrap.appendChild(empty);
        return;
      }

      for (const cat of filtered) {
        const label = document.createElement("label");
        label.className = "multi-select-item";

        const left = document.createElement("span");
        left.className = "multi-select-item-left";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = state.filters.mapsCategories.has(cat.name);
        cb.addEventListener("change", () => {
          if (cb.checked) {
            state.filters.mapsCategories.add(cat.name);
          } else {
            state.filters.mapsCategories.delete(cat.name);
          }
          selCountSpan.textContent = `${state.filters.mapsCategories.size} seçili`;
          updateMapsCatButtonLabel();
          state.currentPage = 1;
          renderResults();
        });

        const nameSpan = document.createElement("span");
        nameSpan.textContent = cat.name;
        left.append(cb, nameSpan);

        const countSpan = document.createElement("span");
        countSpan.className = "muted tabular";
        countSpan.textContent = String(cat.count);

        label.append(left, countSpan);
        listWrap.appendChild(label);
      }
    }

    searchInput.addEventListener("input", renderPopoverList);
    clearCatsBtn.addEventListener("click", () => {
      state.filters.mapsCategories.clear();
      updateMapsCatButtonLabel();
      renderPopoverList();
      state.currentPage = 1;
      renderResults();
    });

    els.comboboxPortal.appendChild(popover);
    positionPortalElement(btn, popover, 280);
    btn.setAttribute("aria-expanded", "true");
    renderPopoverList();

    setTimeout(() => searchInput.focus(), 0);

    const closePopover = () => {
      btn.setAttribute("aria-expanded", "false");
      popover.remove();
      document.removeEventListener("pointerdown", onOutsideDown);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onEsc);
      if (state.activePopupCleanup === closePopover) {
        state.activePopupCleanup = null;
      }
    };

    const onOutsideDown = (event) => {
      if (btn.contains(event.target) || popover.contains(event.target)) return;
      closePopover();
    };
    const onResize = () => positionPortalElement(btn, popover, 280);
    const onScroll = (event) => {
      if (popover.contains(event.target)) return;
      positionPortalElement(btn, popover, 280);
    };
    const onEsc = (event) => {
      if (event.key === "Escape") {
        closePopover();
        btn.focus();
      }
    };

    document.addEventListener("pointerdown", onOutsideDown);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onEsc);
    state.activePopupCleanup = closePopover;
  }

  function getFilteredAndSortedBusinesses() {
    const f = state.filters;
    const textQ = f.text.trim();
    const minRating = Number(f.minRating) || 0;
    const minReviews = Number(f.minReviews) || 0;

    const filtered = state.businesses.filter((b) => {
      if (textQ) {
        const combined = [b.name, b.address, b.category].filter(Boolean).join(" ");
        if (!matchesSearch(combined, textQ)) return false;
      }

      if (f.il || f.ilce) {
        const parts = deriveRegionParts(b.search_region);
        if (f.il && parts.il !== f.il) return false;
        if (f.ilce && parts.ilce !== f.ilce) return false;
      }

      if (f.searchCategory && b.search_category !== f.searchCategory) {
        return false;
      }

      if (f.mapsCategories.size > 0) {
        const cat = b.category ? String(b.category).trim() : "";
        if (!cat || !f.mapsCategories.has(cat)) return false;
      }

      if (f.statuses.size > 0) {
        const statusKey = normalizeDurum(b.durum);
        if (!f.statuses.has(statusKey)) return false;
      }

      if (minRating > 0) {
        const rating = b.rating !== null && b.rating !== undefined ? Number(b.rating) : NaN;
        if (!Number.isFinite(rating) || rating < minRating) return false;
      }

      if (minReviews > 0) {
        const reviews =
          b.review_count !== null && b.review_count !== undefined
            ? Number(b.review_count)
            : NaN;
        if (!Number.isFinite(reviews) || reviews < minReviews) return false;
      }

      if (f.noPhone && hasPhone(b)) return false;
      if (f.noWebsite && hasWebsite(b)) return false;
      if (f.hasHours && !hasHours(b)) return false;

      return true;
    });

    if (f.sortBy === "newest") {
      return filtered;
    }

    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      if (f.sortBy === "rating") {
        const ra = a.rating != null && Number.isFinite(Number(a.rating)) ? Number(a.rating) : -1;
        const rb = b.rating != null && Number.isFinite(Number(b.rating)) ? Number(b.rating) : -1;
        if (rb !== ra) return rb - ra;
        const rva = Number(a.review_count) || 0;
        const rvb = Number(b.review_count) || 0;
        return rvb - rva;
      }

      if (f.sortBy === "reviews") {
        const rva =
          a.review_count != null && Number.isFinite(Number(a.review_count))
            ? Number(a.review_count)
            : -1;
        const rvb =
          b.review_count != null && Number.isFinite(Number(b.review_count))
            ? Number(b.review_count)
            : -1;
        if (rvb !== rva) return rvb - rva;
        const ra = Number(a.rating) || 0;
        const rb = Number(b.rating) || 0;
        return rb - ra;
      }

      if (f.sortBy === "name") {
        const na = a.name ? String(a.name).trim() : "";
        const nb = b.name ? String(b.name).trim() : "";
        if (!na && !nb) return 0;
        if (!na) return 1;
        if (!nb) return -1;
        return trCompare(na, nb);
      }

      return 0;
    });

    return sorted;
  }

  function hasActiveClientFilters() {
    const f = state.filters;
    return Boolean(
      f.text.trim() ||
        f.il ||
        f.ilce ||
        f.searchCategory ||
        f.mapsCategories.size > 0 ||
        f.statuses.size > 0 ||
        f.minRating > 0 ||
        f.minReviews > 0 ||
        f.noPhone ||
        f.noWebsite ||
        f.hasHours
    );
  }

  function syncStatusFilterPills() {
    const selected = state.filters.statuses;
    for (const btn of els.filterDurumPills) {
      const key = btn.dataset.durum || "";
      const isActive = key === "" ? selected.size === 0 : selected.has(key);
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    }
  }

  function clearAllClientFilters() {
    state.filters.text = "";
    state.filters.il = "";
    state.filters.ilce = "";
    state.filters.searchCategory = "";
    state.filters.mapsCategories.clear();
    state.filters.statuses.clear();
    state.filters.minRating = 0;
    state.filters.minReviews = 0;
    state.filters.noPhone = false;
    state.filters.noWebsite = false;
    state.filters.hasHours = false;
    state.currentPage = 1;

    els.filterText.value = "";
    els.filterIl.value = "";
    populateFilterIlceOptions();
    els.filterSearchCat.value = "";
    updateMapsCatButtonLabel();
    syncStatusFilterPills();
    els.filterMinRating.value = "0";
    els.filterMinRatingVal.textContent = "Tümü";
    els.filterMinReviews.value = "";
    els.filterNoPhone.checked = false;
    els.filterNoWebsite.checked = false;
    els.filterHasHours.checked = false;

    renderResults();
  }

  function renderActiveChips() {
    const f = state.filters;
    const chips = [];

    if (f.text.trim()) {
      chips.push({
        label: `Arama: "${f.text.trim()}"`,
        clear: () => {
          f.text = "";
          els.filterText.value = "";
        },
      });
    }
    if (f.il) {
      chips.push({
        label: `İl: ${f.il}`,
        clear: () => {
          f.il = "";
          f.ilce = "";
          els.filterIl.value = "";
          populateFilterIlceOptions();
        },
      });
    }
    if (f.ilce) {
      chips.push({
        label: `İlçe: ${f.ilce}`,
        clear: () => {
          f.ilce = "";
          els.filterIlce.value = "";
        },
      });
    }
    if (f.searchCategory) {
      chips.push({
        label: `Arama Türü: ${f.searchCategory}`,
        clear: () => {
          f.searchCategory = "";
          els.filterSearchCat.value = "";
        },
      });
    }
    for (const cat of Array.from(f.mapsCategories).sort(trCompare)) {
      chips.push({
        label: `Kategori: ${cat}`,
        clear: () => {
          f.mapsCategories.delete(cat);
          updateMapsCatButtonLabel();
        },
      });
    }
    for (const statusKey of DURUM_ORDER) {
      if (f.statuses.has(statusKey)) {
        chips.push({
          label: `Durum: ${DURUM_META[statusKey].label}`,
          clear: () => {
            f.statuses.delete(statusKey);
            syncStatusFilterPills();
          },
        });
      }
    }
    if (f.minRating > 0) {
      chips.push({
        label: `Min. Puan: ${Number(f.minRating).toLocaleString("tr-TR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}+`,
        clear: () => {
          f.minRating = 0;
          els.filterMinRating.value = "0";
          els.filterMinRatingVal.textContent = "Tümü";
        },
      });
    }
    if (f.minReviews > 0) {
      chips.push({
        label: `Min. Yorum: ${Number(f.minReviews).toLocaleString("tr-TR")}+`,
        clear: () => {
          f.minReviews = 0;
          els.filterMinReviews.value = "";
        },
      });
    }
    if (f.noPhone) {
      chips.push({
        label: "Telefonu yok",
        clear: () => {
          f.noPhone = false;
          els.filterNoPhone.checked = false;
        },
      });
    }
    if (f.noWebsite) {
      chips.push({
        label: "Web sitesi yok",
        clear: () => {
          f.noWebsite = false;
          els.filterNoWebsite.checked = false;
        },
      });
    }
    if (f.hasHours) {
      chips.push({
        label: "Çalışma saati var",
        clear: () => {
          f.hasHours = false;
          els.filterHasHours.checked = false;
        },
      });
    }

    els.activeChipsList.replaceChildren();
    if (!chips.length) {
      els.activeChipsBar.hidden = true;
      return;
    }

    els.activeChipsBar.hidden = false;
    for (const chip of chips) {
      const el = document.createElement("span");
      el.className = "active-chip";

      const txt = document.createElement("span");
      txt.textContent = chip.label;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", `${chip.label} filtresini kaldır`);
      btn.appendChild(ICONS.close());
      btn.addEventListener("click", () => {
        chip.clear();
        state.currentPage = 1;
        renderResults();
      });

      el.append(txt, btn);
      els.activeChipsList.appendChild(el);
    }
  }

  /* KPI Rendering */
  function renderKpis(rows) {
    const total = rows.length;
    const allCount = state.businesses.length;

    els.kpiTotal.textContent = total.toLocaleString("tr-TR");
    if (total === 0 && allCount === 0) {
      els.kpiTotalSub.textContent = "Kayıt bekleniyor";
    } else if (total !== allCount) {
      els.kpiTotalSub.textContent = `Toplam ${allCount.toLocaleString("tr-TR")} kayıttan`;
    } else {
      els.kpiTotalSub.textContent = "Görüntülenen tüm kayıtlar";
    }

    let phoneCount = 0;
    let noWebCount = 0;

    for (const b of rows) {
      if (hasPhone(b)) phoneCount += 1;
      if (!hasWebsite(b)) noWebCount += 1;
    }

    const totalSub = `${total.toLocaleString("tr-TR")} işletmeden`;

    els.kpiPhone.textContent = phoneCount.toLocaleString("tr-TR");
    els.kpiPhoneSub.textContent = totalSub;
    els.kpiPhoneBar.style.width = total > 0 ? `${Math.round((phoneCount / total) * 100)}%` : "0%";

    els.kpiNoWebsite.textContent = noWebCount.toLocaleString("tr-TR");
    els.kpiNoWebsiteSub.textContent = totalSub;
    els.kpiNoWebsiteBar.style.width =
      total > 0 ? `${Math.round((noWebCount / total) * 100)}%` : "0%";
  }

  /* Card & Table Builders */
  function getBusinessKey(b) {
    return b.place_id || b.maps_url || `${b.name || ""}|${b.lat}|${b.lng}`;
  }

  function getBusinessRouteId(b) {
    return (b && (b.place_id || getBusinessKey(b))) || "";
  }

  function buildDetailHash(id) {
    return `#/isletme/${encodeURIComponent(id)}`;
  }

  function parseDetailHash(hash) {
    const raw = String(hash || "");
    const prefix = "#/isletme/";
    if (!raw.startsWith(prefix)) return null;
    const encoded = raw.slice(prefix.length);
    if (!encoded) return null;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  function bindDetailLinkNavigation(anchorEl) {
    anchorEl.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }
      if (state.detailPlaceId === null) {
        state.savedScrollY = window.scrollY;
        state.capturedScrollBeforeHash = true;
        state.canGoBackToList = true;
      }
    });
  }

  function navigateToDetail(b) {
    const id = getBusinessRouteId(b);
    if (!id) return;
    if (state.detailPlaceId === null) {
      state.savedScrollY = window.scrollY;
      state.capturedScrollBeforeHash = true;
      state.canGoBackToList = true;
    }
    const targetHash = buildDetailHash(id);
    if (window.location.hash === targetHash) {
      openDetailRoute(id);
    } else {
      window.location.hash = targetHash;
    }
  }

  function navigateBackToList() {
    if (state.detailPlaceId === null) return;
    if (state.canGoBackToList) {
      history.back();
    } else {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      closeDetailRoute();
    }
  }

  function createRatingPill(b, { showParens = true } = {}) {
    if (!b || b.rating === null || b.rating === undefined || !Number.isFinite(Number(b.rating))) {
      return null;
    }
    const pill = document.createElement("span");
    pill.className = "rating-pill tabular";
    pill.appendChild(ICONS.star());

    const rNum = document.createElement("span");
    rNum.textContent = Number(b.rating).toLocaleString("tr-TR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    pill.appendChild(rNum);

    if (
      showParens &&
      b.review_count !== null &&
      b.review_count !== undefined &&
      Number.isFinite(Number(b.review_count))
    ) {
      const rCount = document.createElement("span");
      rCount.className = "rating-review-count";
      rCount.textContent = `(${Number(b.review_count).toLocaleString("tr-TR")})`;
      pill.appendChild(rCount);
    }

    return pill;
  }

  function createContactIndicators(b, { showAbsent = true } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "contact-indicators";

    if (hasPhone(b)) {
      const href = formatPhoneHref(b.phone);
      const el = document.createElement(href ? "a" : "span");
      el.className = "contact-pill is-present tabular";
      if (href) {
        el.href = href;
        el.addEventListener("click", (e) => e.stopPropagation());
      }
      el.appendChild(ICONS.phone());
      const span = document.createElement("span");
      span.textContent = b.phone;
      el.appendChild(span);
      wrap.appendChild(el);
    } else if (showAbsent) {
      const el = document.createElement("span");
      el.className = "contact-pill is-absent";
      el.appendChild(ICONS.phone());
      const span = document.createElement("span");
      span.textContent = "Tel yok";
      el.appendChild(span);
      wrap.appendChild(el);
    }

    const webUrl = safeHttpUrl(b.website, true);
    if (webUrl) {
      const a = document.createElement("a");
      a.className = "contact-pill is-present";
      a.href = webUrl.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = webUrl.href;
      a.addEventListener("click", (e) => e.stopPropagation());
      a.appendChild(ICONS.globe());
      const span = document.createElement("span");
      span.textContent = "Web";
      a.appendChild(span);
      wrap.appendChild(a);
    } else if (showAbsent) {
      const el = document.createElement("span");
      el.className = "contact-pill is-absent";
      el.appendChild(ICONS.globe());
      const span = document.createElement("span");
      span.textContent = "Web yok";
      el.appendChild(span);
      wrap.appendChild(el);
    }

    return wrap;
  }

  function normalizeDurum(value) {
    const key = String(value ?? "").trim();
    return Object.prototype.hasOwnProperty.call(DURUM_META, key) ? key : "yeni";
  }

  function createDurumBadge(durum) {
    const key = normalizeDurum(durum);
    const meta = DURUM_META[key];
    const badge = document.createElement("span");
    badge.className = `durum-badge ${meta.className}`;

    const dot = document.createElement("span");
    dot.className = "durum-dot";
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.textContent = meta.label;

    badge.append(dot, text);
    return badge;
  }

  function createTitleMetaChips(b) {
    const cat = b && b.category ? String(b.category).trim() : "";
    const district = getBusinessDistrict(b);
    if (!cat && !district) return null;

    const wrap = document.createElement("span");
    wrap.className = "biz-inline-chips";

    if (cat) {
      const catTag = document.createElement("span");
      catTag.className = "category-tag is-compact";
      catTag.textContent = cat;
      wrap.appendChild(catTag);
    }

    if (district) {
      const distChip = document.createElement("span");
      distChip.className = "district-chip";
      distChip.appendChild(ICONS.pin());
      const distText = document.createElement("span");
      distText.textContent = district;
      distChip.appendChild(distText);
      wrap.appendChild(distChip);
    }

    return wrap;
  }

  function createBusinessCard(b) {
    const card = document.createElement("article");
    card.className = "biz-card is-clickable";

    const detailId = getBusinessRouteId(b);

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) return;
      navigateToDetail(b);
    });

    // Header: name + inline category & district chips + rating pill
    const head = document.createElement("div");
    head.className = "biz-card-head";

    const titleGroup = document.createElement("div");
    titleGroup.className = "biz-card-title-group";

    const titleInline = document.createElement("div");
    titleInline.className = "biz-title-inline";

    const title = document.createElement("h3");
    title.className = "biz-card-name";
    if (detailId) {
      const link = document.createElement("a");
      link.className = "biz-card-link";
      link.href = buildDetailHash(detailId);
      link.textContent = b.name || "İsimsiz İşletme";
      bindDetailLinkNavigation(link);
      title.appendChild(link);
    } else {
      title.textContent = b.name || "İsimsiz İşletme";
    }
    titleInline.appendChild(title);

    const inlineChips = createTitleMetaChips(b);
    if (inlineChips) {
      titleInline.appendChild(inlineChips);
    }

    titleGroup.appendChild(titleInline);
    head.appendChild(titleGroup);

    const ratingPill = createRatingPill(b, { showParens: true });
    if (ratingPill) {
      head.appendChild(ratingPill);
    }

    card.appendChild(head);

    // Mid row: today's hours + follow-up status badge
    const midRow = document.createElement("div");
    midRow.className = "biz-card-mid";
    midRow.appendChild(createTodayHoursBadge(b.hours));
    midRow.appendChild(createDurumBadge(b.durum));
    card.appendChild(midRow);

    // Footer: small phone/website indicators + detail cue
    const footer = document.createElement("div");
    footer.className = "biz-card-footer";
    footer.appendChild(createContactIndicators(b, { showAbsent: true }));

    const cue = document.createElement("span");
    cue.className = "biz-card-detail-cue";
    cue.setAttribute("aria-hidden", "true");
    cue.textContent = "Detay →";
    footer.appendChild(cue);

    card.appendChild(footer);

    return card;
  }

  function renderCards(rows) {
    els.cardsGrid.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const b of rows) {
      fragment.appendChild(createBusinessCard(b));
    }
    els.cardsGrid.appendChild(fragment);
  }

  function createMutedDash() {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = "—";
    return span;
  }

  function renderTable(rows) {
    els.tbody.replaceChildren();
    const fragment = document.createDocumentFragment();

    for (const b of rows) {
      const tr = document.createElement("tr");
      tr.className = "is-clickable";
      const detailId = getBusinessRouteId(b);

      tr.addEventListener("click", (event) => {
        if (event.target.closest("a, button")) return;
        const sel = window.getSelection();
        if (sel && sel.toString().trim().length > 0) return;
        navigateToDetail(b);
      });

      // İşletme (name + inline category & district chips)
      const tdName = document.createElement("td");
      tdName.className = "table-biz-name";
      const nameInline = document.createElement("div");
      nameInline.className = "table-biz-inline";
      if (detailId) {
        const link = document.createElement("a");
        link.className = "table-biz-link";
        link.href = buildDetailHash(detailId);
        link.textContent = b.name || "İsimsiz İşletme";
        bindDetailLinkNavigation(link);
        nameInline.appendChild(link);
      } else {
        const nameSpan = document.createElement("span");
        nameSpan.textContent = b.name || "—";
        nameInline.appendChild(nameSpan);
      }
      const inlineChips = createTitleMetaChips(b);
      if (inlineChips) {
        nameInline.appendChild(inlineChips);
      }
      tdName.appendChild(nameInline);
      tr.appendChild(tdName);

      // Durum
      const tdStatus = document.createElement("td");
      tdStatus.className = "table-status-cell";
      tdStatus.appendChild(createDurumBadge(b.durum));
      tr.appendChild(tdStatus);

      // Puan / Yorum
      const tdRating = document.createElement("td");
      tdRating.className = "num tabular";
      const ratingPill = createRatingPill(b, { showParens: false });
      if (ratingPill) {
        tdRating.appendChild(ratingPill);
        if (
          b.review_count !== null &&
          b.review_count !== undefined &&
          Number.isFinite(Number(b.review_count))
        ) {
          const rev = document.createElement("div");
          rev.className = "table-biz-sub";
          rev.textContent = `${Number(b.review_count).toLocaleString("tr-TR")} yorum`;
          tdRating.appendChild(rev);
        }
      } else {
        tdRating.appendChild(createMutedDash());
      }
      tr.appendChild(tdRating);

      // Bugünkü Saatler
      const tdHours = document.createElement("td");
      tdHours.className = "table-hours-cell";
      tdHours.appendChild(createTodayHoursBadge(b.hours));
      tr.appendChild(tdHours);

      // İletişim indicators
      const tdContact = document.createElement("td");
      tdContact.className = "table-contact-cell";
      const indicators = createContactIndicators(b, { showAbsent: false });
      if (indicators.children.length > 0) {
        indicators.classList.add("table-contact-list");
        tdContact.appendChild(indicators);
      } else {
        tdContact.appendChild(createMutedDash());
      }
      tr.appendChild(tdContact);

      fragment.appendChild(tr);
    }

    els.tbody.appendChild(fragment);
  }

  /* Interactive Leaflet Map */
  function getTileUrlForTheme(theme) {
    return theme === "light"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
  }

  function syncThemeTileLayer(map, existingLayer, existingTheme) {
    if (!map || typeof L === "undefined") {
      return { layer: existingLayer, theme: existingTheme };
    }
    const theme = getEffectiveTheme();
    if (existingTheme === theme && existingLayer) {
      return { layer: existingLayer, theme: existingTheme };
    }
    if (existingLayer) {
      map.removeLayer(existingLayer);
    }
    const nextLayer = L.tileLayer(getTileUrlForTheme(theme), {
      attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
      maxZoom: 16,
    }).addTo(map);
    return { layer: nextLayer, theme };
  }

  function updateMapTileLayer() {
    if (state.mapInstance) {
      const res = syncThemeTileLayer(state.mapInstance, state.mapTileLayer, state.mapTileTheme);
      state.mapTileLayer = res.layer;
      state.mapTileTheme = res.theme;
    }
    if (state.detailMapInstance) {
      const res = syncThemeTileLayer(
        state.detailMapInstance,
        state.detailMapTileLayer,
        state.detailMapTileTheme
      );
      state.detailMapTileLayer = res.layer;
      state.detailMapTileTheme = res.theme;
    }
  }

  function ensureMapInitialized() {
    if (state.mapInstance) return true;
    if (typeof L === "undefined") {
      els.mapContainer.hidden = true;
      els.mapFallback.hidden = false;
      els.mapStatsText.textContent = "Harita kütüphanesi kullanılamıyor.";
      return false;
    }

    els.mapContainer.hidden = false;
    els.mapFallback.hidden = true;

    const map = L.map(els.mapContainer, {
      zoomControl: true,
    }).setView([39.0, 35.0], 6);

    state.mapInstance = map;
    updateMapTileLayer();

    if (typeof L.markerClusterGroup === "function") {
      state.mapClusterGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 48,
        iconCreateFunction: (cluster) =>
          L.divIcon({
            html: `<span>${cluster.getChildCount()}</span>`,
            className: "marker-cluster-custom",
            iconSize: L.point(40, 40),
          }),
      });
    } else {
      state.mapClusterGroup = L.layerGroup();
    }

    map.addLayer(state.mapClusterGroup);
    return true;
  }

  function buildPopupElement(b) {
    const wrap = document.createElement("div");
    wrap.className = "popup-card";
    const detailId = getBusinessRouteId(b);

    const title = document.createElement("h4");
    title.className = "popup-title";
    if (detailId) {
      const titleLink = document.createElement("a");
      titleLink.className = "popup-title-link";
      titleLink.href = buildDetailHash(detailId);
      titleLink.textContent = b.name || "İsimsiz İşletme";
      bindDetailLinkNavigation(titleLink);
      title.appendChild(titleLink);
    } else {
      title.textContent = b.name || "İsimsiz İşletme";
    }
    wrap.appendChild(title);

    const topMeta = document.createElement("div");
    topMeta.style.display = "flex";
    topMeta.style.flexWrap = "wrap";
    topMeta.style.alignItems = "center";
    topMeta.style.gap = "6px";

    topMeta.appendChild(createDurumBadge(b.durum));

    if (b.category) {
      const tag = document.createElement("span");
      tag.className = "category-tag";
      tag.textContent = b.category;
      topMeta.appendChild(tag);
    }

    const rp = createRatingPill(b, { showParens: true });
    if (rp) {
      topMeta.appendChild(rp);
    }

    wrap.appendChild(topMeta);

    if (b.address) {
      const addr = document.createElement("div");
      addr.className = "popup-row";
      addr.textContent = b.address;
      wrap.appendChild(addr);
    }

    if (hasPhone(b)) {
      const phoneDiv = document.createElement("div");
      phoneDiv.className = "popup-row tabular";
      const href = formatPhoneHref(b.phone);
      if (href) {
        const a = document.createElement("a");
        a.className = "inline-link";
        a.href = href;
        a.textContent = b.phone;
        phoneDiv.appendChild(a);
      } else {
        phoneDiv.textContent = b.phone;
      }
      wrap.appendChild(phoneDiv);
    }

    const webUrl = safeHttpUrl(b.website, true);
    if (webUrl) {
      const webDiv = document.createElement("div");
      webDiv.className = "popup-row";
      const a = document.createElement("a");
      a.className = "inline-link";
      a.href = webUrl.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = webUrl.hostname.replace(/^www\./i, "");
      webDiv.appendChild(a);
      wrap.appendChild(webDiv);
    }

    wrap.appendChild(createTodayHoursBadge(b.hours));

    const actions = document.createElement("div");
    actions.className = "popup-actions";

    if (detailId) {
      const detailLink = document.createElement("a");
      detailLink.className = "action-link-btn";
      detailLink.href = buildDetailHash(detailId);
      detailLink.textContent = "Detayları Gör";
      bindDetailLinkNavigation(detailLink);
      actions.appendChild(detailLink);
    }

    const mapsUrl = safeHttpUrl(b.maps_url, false);
    if (mapsUrl) {
      const link = document.createElement("a");
      link.className = "action-link-btn";
      link.href = mapsUrl.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const span = document.createElement("span");
      span.textContent = "Google Maps'te Aç";
      link.append(span, ICONS.external());
      actions.appendChild(link);
    }

    if (actions.children.length > 0) {
      wrap.appendChild(actions);
    }

    return wrap;
  }

  function syncMapMarkers(rows, fitBounds = true) {
    if (!ensureMapInitialized()) return;

    state.mapClusterGroup.clearLayers();
    state.mapMarkersByKey.clear();
    state.mapNeedsSync = false;

    const pinIcon = L.divIcon({
      className: "custom-map-pin",
      html: '<div class="map-pin-badge"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -26],
    });

    const markers = [];
    const boundsPoints = [];
    let missingCoords = 0;

    for (const b of rows) {
      const coords = getValidCoords(b);
      if (!coords) {
        missingCoords += 1;
        continue;
      }

      const marker = L.marker([coords.lat, coords.lng], {
        icon: pinIcon,
        title: b.name || "",
      });
      marker.bindPopup(() => buildPopupElement(b), { maxWidth: 310 });

      markers.push(marker);
      boundsPoints.push([coords.lat, coords.lng]);
      state.mapMarkersByKey.set(getBusinessKey(b), marker);
    }

    if (markers.length > 0) {
      if (typeof state.mapClusterGroup.addLayers === "function") {
        state.mapClusterGroup.addLayers(markers);
      } else {
        for (const m of markers) {
          state.mapClusterGroup.addLayer(m);
        }
      }
      if (fitBounds) {
        state.mapInstance.fitBounds(boundsPoints, {
          padding: [36, 36],
          maxZoom: 15,
        });
      }
    } else if (fitBounds) {
      state.mapInstance.setView([39.0, 35.0], 6);
    }

    const total = rows.length;
    if (total === 0) {
      els.mapStatsText.textContent = "Haritada gösterilecek kayıt yok.";
    } else if (missingCoords > 0) {
      els.mapStatsText.textContent = `Haritada ${markers.length.toLocaleString("tr-TR")} / ${total.toLocaleString("tr-TR")} işletme gösteriliyor (${missingCoords.toLocaleString("tr-TR")} kayıtta koordinat yok)`;
    } else {
      els.mapStatsText.textContent = `Haritada ${markers.length.toLocaleString("tr-TR")} işletme gösteriliyor`;
    }
  }

  function setViewMode(mode, { skipFitBounds = false } = {}) {
    state.viewMode = mode;
    for (const btn of els.viewButtons) {
      const isActive = btn.dataset.view === mode;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    }
    renderResults({ skipFitBounds });
  }

  /* Pagination */
  function buildPaginationItems(currentPage, totalPages) {
    if (totalPages <= 7) {
      const all = [];
      for (let i = 1; i <= totalPages; i += 1) all.push(i);
      return all;
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, "...", totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [
        1,
        "...",
        totalPages - 4,
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages,
      ];
    }
    return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
  }

  function goToPage(page) {
    state.currentPage = page;
    renderResults({ skipFitBounds: true });
    if (els.tableWrap) {
      els.tableWrap.scrollTop = 0;
    }
    els.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderPagination(filteredCount, totalPages, startIdx, endIdx) {
    if (filteredCount <= 0 || state.viewMode === "map") {
      els.paginationBar.hidden = true;
      return;
    }

    els.paginationBar.hidden = false;
    const startDisplay = (startIdx + 1).toLocaleString("tr-TR");
    const endDisplay = endIdx.toLocaleString("tr-TR");
    const totalDisplay = filteredCount.toLocaleString("tr-TR");
    els.paginationInfo.textContent = `${startDisplay}–${endDisplay} / ${totalDisplay}`;

    els.paginationControls.replaceChildren();

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "page-btn page-btn-nav";
    prevBtn.disabled = state.currentPage <= 1;
    prevBtn.setAttribute("aria-label", "Önceki sayfa");
    prevBtn.appendChild(ICONS.chevronLeft());
    const prevLbl = document.createElement("span");
    prevLbl.textContent = "Önceki";
    prevBtn.appendChild(prevLbl);
    prevBtn.addEventListener("click", () => {
      if (state.currentPage > 1) {
        goToPage(state.currentPage - 1);
      }
    });
    els.paginationControls.appendChild(prevBtn);

    const items = buildPaginationItems(state.currentPage, totalPages);
    for (const item of items) {
      if (item === "...") {
        const dots = document.createElement("span");
        dots.className = "page-ellipsis";
        dots.setAttribute("aria-hidden", "true");
        dots.textContent = "…";
        els.paginationControls.appendChild(dots);
        continue;
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "page-btn";
      if (item === state.currentPage) {
        btn.classList.add("is-active");
        btn.setAttribute("aria-current", "page");
      }
      btn.setAttribute("aria-label", `Sayfa ${item}`);
      btn.textContent = item.toLocaleString("tr-TR");
      btn.addEventListener("click", () => {
        if (item !== state.currentPage) {
          goToPage(item);
        }
      });
      els.paginationControls.appendChild(btn);
    }

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "page-btn page-btn-nav";
    nextBtn.disabled = state.currentPage >= totalPages;
    nextBtn.setAttribute("aria-label", "Sonraki sayfa");
    const nextLbl = document.createElement("span");
    nextLbl.textContent = "Sonraki";
    nextBtn.appendChild(nextLbl);
    nextBtn.appendChild(ICONS.chevronRight());
    nextBtn.addEventListener("click", () => {
      if (state.currentPage < totalPages) {
        goToPage(state.currentPage + 1);
      }
    });
    els.paginationControls.appendChild(nextBtn);
  }

  /* Master Results Render */
  function renderResults({ skipFitBounds = false } = {}) {
    const filteredRows = getFilteredAndSortedBusinesses();
    const totalLoaded = state.businesses.length;
    const filteredCount = filteredRows.length;

    renderKpis(filteredRows);
    renderActiveChips();

    if (filteredCount !== totalLoaded && totalLoaded > 0) {
      els.resultsCount.textContent = `${filteredCount.toLocaleString("tr-TR")} / ${totalLoaded.toLocaleString("tr-TR")} sonuç`;
    } else {
      els.resultsCount.textContent = `${filteredCount.toLocaleString("tr-TR")} sonuç`;
    }

    const exportLabel = els.exportBtn.querySelector("span");
    if (exportLabel && !els.exportBtn.disabled) {
      exportLabel.textContent =
        filteredCount > 0 && filteredCount !== totalLoaded
          ? `Excel İndir (${filteredCount})`
          : "Excel İndir";
    }

    if (state.isLoadingBusinesses && totalLoaded === 0) {
      els.skeletonView.hidden = false;
      els.cardsView.hidden = true;
      els.tableView.hidden = true;
      els.mapView.hidden = true;
      els.paginationBar.hidden = true;
      els.resultsEmpty.hidden = true;
      return;
    }

    els.skeletonView.hidden = true;

    if (filteredCount === 0) {
      els.cardsView.hidden = true;
      els.tableView.hidden = true;
      els.mapView.hidden = true;
      els.paginationBar.hidden = true;
      els.resultsEmpty.hidden = false;

      if (hasActiveClientFilters() && totalLoaded > 0) {
        els.resultsEmptyTitle.textContent = "Filtrelerle eşleşen işletme bulunamadı.";
        els.resultsEmptyDesc.textContent =
          "Seçili filtre kombinasyonunu daralttığınız için sonuç yok. Filtreleri temizleyerek tüm kayıtları görebilirsiniz.";
        els.emptyResetBtn.hidden = false;
      } else if (state.filterRegion || state.filterCategory) {
        els.resultsEmptyTitle.textContent = "Bu arama için kayıt bulunamadı.";
        els.resultsEmptyDesc.textContent =
          "Kapsamı kaldırarak tüm kayıtları görebilir veya sol panelden yeni tarama başlatabilirsiniz.";
        els.emptyResetBtn.hidden = true;
      } else {
        els.resultsEmptyTitle.textContent = "Henüz işletme kaydı yok.";
        els.resultsEmptyDesc.textContent =
          "Sol panelden il, ilçe ve işletme türü seçerek Google Maps taraması başlatabilirsiniz.";
        els.emptyResetBtn.hidden = true;
      }

      if (state.mapInstance) {
        state.mapNeedsSync = true;
      }
      return;
    }

    els.resultsEmpty.hidden = true;

    if (state.viewMode === "cards" || state.viewMode === "table") {
      const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
      if (state.currentPage > totalPages) state.currentPage = totalPages;
      if (state.currentPage < 1) state.currentPage = 1;

      const startIdx = (state.currentPage - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, filteredCount);
      const pageRows = filteredRows.slice(startIdx, endIdx);

      if (state.viewMode === "cards") {
        els.cardsView.hidden = false;
        els.tableView.hidden = true;
        els.mapView.hidden = true;
        renderCards(pageRows);
      } else {
        els.cardsView.hidden = true;
        els.tableView.hidden = false;
        els.mapView.hidden = true;
        renderTable(pageRows);
      }

      renderPagination(filteredCount, totalPages, startIdx, endIdx);
      state.mapNeedsSync = true;
    } else {
      els.cardsView.hidden = true;
      els.tableView.hidden = true;
      els.mapView.hidden = false;
      els.paginationBar.hidden = true;
      requestAnimationFrame(() => {
        if (ensureMapInitialized()) {
          state.mapInstance.invalidateSize();
          syncMapMarkers(filteredRows, !skipFitBounds);
        }
      });
    }
  }

  /* Business Detail Page & Hash Routing */
  function destroyDetailMap() {
    if (state.detailMapInstance) {
      state.detailMapInstance.remove();
      state.detailMapInstance = null;
      state.detailMapTileLayer = null;
      state.detailMapTileTheme = null;
    }
  }

  function findBusinessByRouteId(id) {
    if (!id) return null;
    return (
      state.businesses.find((b) => b.place_id === id) ||
      state.businesses.find((b) => getBusinessKey(b) === id) ||
      null
    );
  }

  function createStarRating(rating) {
    const val = Math.max(0, Math.min(5, Number(rating) || 0));
    const wrap = document.createElement("div");
    wrap.className = "star-rating";
    wrap.setAttribute(
      "aria-label",
      `5 üzerinden ${val.toLocaleString("tr-TR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} yıldız`
    );

    for (let i = 0; i < 5; i += 1) {
      const fillPct = Math.max(0, Math.min(100, (val - i) * 100));
      const slot = document.createElement("span");
      slot.className = "star-slot";

      const bg = document.createElement("span");
      bg.className = "star-slot-bg";
      bg.appendChild(ICONS.star(18));

      const fill = document.createElement("span");
      fill.className = "star-slot-fill";
      fill.style.width = `${fillPct}%`;
      const filledSvg = ICONS.star(18);
      filledSvg.style.flexShrink = "0";
      fill.appendChild(filledSvg);

      slot.append(bg, fill);
      wrap.appendChild(slot);
    }

    return wrap;
  }

  function createCopyButton(value, toastLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.appendChild(ICONS.copy());
    const span = document.createElement("span");
    span.textContent = "Kopyala";
    btn.appendChild(span);
    btn.addEventListener("click", () => {
      copyTextWithFeedback(value, toastLabel, btn);
    });
    return btn;
  }

  function createDetailInfoRow({ icon, label, valueNode, copyValue = null, copyLabel = "" }) {
    const row = document.createElement("div");
    row.className = "detail-info-row";

    const body = document.createElement("div");
    body.className = "detail-info-body";

    const iconBox = document.createElement("span");
    iconBox.className = "detail-info-icon";
    iconBox.setAttribute("aria-hidden", "true");
    iconBox.appendChild(icon);

    const textCol = document.createElement("div");
    textCol.className = "detail-info-text";

    const labelEl = document.createElement("span");
    labelEl.className = "detail-info-label";
    labelEl.textContent = label;

    const valWrap = document.createElement("div");
    valWrap.className = "detail-info-value";
    valWrap.appendChild(valueNode);

    textCol.append(labelEl, valWrap);
    body.append(iconBox, textCol);
    row.appendChild(body);

    if (copyValue) {
      row.appendChild(createCopyButton(copyValue, copyLabel || label));
    }

    return row;
  }

  function createDetailBackTopbar(mapsUrl = null) {
    const topbar = document.createElement("div");
    topbar.className = "detail-topbar";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn btn-ghost detail-back-btn";
    backBtn.appendChild(ICONS.arrowLeft());
    const backLbl = document.createElement("span");
    backLbl.textContent = "Geri";
    const escHint = document.createElement("span");
    escHint.className = "kbd-hint";
    escHint.textContent = "ESC";
    backBtn.append(backLbl, escHint);
    backBtn.addEventListener("click", navigateBackToList);
    topbar.appendChild(backBtn);

    if (mapsUrl) {
      const mapsBtn = document.createElement("a");
      mapsBtn.className = "btn btn-primary";
      mapsBtn.style.flex = "0 0 auto";
      mapsBtn.href = mapsUrl.href;
      mapsBtn.target = "_blank";
      mapsBtn.rel = "noopener noreferrer";
      const lbl = document.createElement("span");
      lbl.textContent = "Google Maps'ta aç";
      mapsBtn.append(lbl, ICONS.external());
      topbar.appendChild(mapsBtn);
    }

    return topbar;
  }

  function formatStatusUpdatedLabel(isoString) {
    if (!isoString) return "Henüz güncellenmedi";
    const formatted = formatDateTimeLong(isoString) || formatDateTime(isoString);
    return formatted ? `Son güncelleme: ${formatted}` : "Henüz güncellenmedi";
  }

  function createDetailStatusPanel(b, onBadgeUpdate) {
    const canSave = Boolean(b.place_id && String(b.place_id).trim());

    const panel = document.createElement("section");
    panel.className = "panel glass-panel detail-status-panel";
    panel.setAttribute("aria-label", "Takip durumu ve notlar");

    const head = document.createElement("div");
    head.className = "panel-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "panel-title-wrap";
    const titleIcon = ICONS.note();
    titleIcon.classList.add("panel-icon");
    const heading = document.createElement("h2");
    heading.textContent = "Takip Durumu ve Notlar";
    titleWrap.append(titleIcon, heading);

    const updatedEl = document.createElement("span");
    updatedEl.className = "detail-status-updated tabular";
    head.append(titleWrap, updatedEl);
    panel.appendChild(head);

    const body = document.createElement("div");
    body.className = "detail-status-body";

    const segmentedWrap = document.createElement("div");
    segmentedWrap.className = "detail-status-controls";

    const statusLabel = document.createElement("span");
    statusLabel.className = "detail-status-field-label";
    statusLabel.id = "detail-durum-label";
    statusLabel.textContent = "Durum";

    const segmented = document.createElement("div");
    segmented.className = "durum-segmented";
    segmented.setAttribute("role", "radiogroup");
    segmented.setAttribute("aria-labelledby", "detail-durum-label");

    const pillButtons = new Map();

    function syncDetailStatusUi() {
      const activeKey = normalizeDurum(b.durum);
      for (const [key, btn] of pillButtons.entries()) {
        const isActive = key === activeKey;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-checked", String(isActive));
      }
      updatedEl.textContent = formatStatusUpdatedLabel(b.durum_guncellendi);
      updatedEl.classList.toggle("muted", !b.durum_guncellendi);
      if (typeof onBadgeUpdate === "function") {
        onBadgeUpdate(activeKey);
      }
    }

    async function patchBusinessStatus(payloadBody) {
      const response = await fetch(
        `/api/businesses/${encodeURIComponent(b.place_id)}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBody),
        }
      );
      const resBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiError(resBody, `Durum güncellenemedi (${response.status}).`)
        );
      }
      return resBody;
    }

    for (const key of DURUM_ORDER) {
      const meta = DURUM_META[key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `durum-pill ${meta.className}`;
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", "false");
      if (!canSave) btn.disabled = true;

      const dot = document.createElement("span");
      dot.className = "durum-dot";
      dot.setAttribute("aria-hidden", "true");

      const lbl = document.createElement("span");
      lbl.textContent = meta.label;

      btn.append(dot, lbl);
      pillButtons.set(key, btn);

      btn.addEventListener("click", async () => {
        if (!canSave) return;
        const currentDurum = normalizeDurum(b.durum);
        if (key === currentDurum) return;

        const prevDurum = currentDurum;
        const prevUpdated = b.durum_guncellendi || null;
        const seq = (state.statusRequestSeq.get(b.place_id) || 0) + 1;
        state.statusRequestSeq.set(b.place_id, seq);

        b.durum = key;
        b.durum_guncellendi = new Date().toISOString();
        syncDetailStatusUi();

        try {
          const updated = await patchBusinessStatus({ durum: key });
          if (state.statusRequestSeq.get(b.place_id) === seq) {
            b.durum = normalizeDurum(updated.durum);
            b.durum_guncellendi = updated.durum_guncellendi || b.durum_guncellendi;
            if (Object.prototype.hasOwnProperty.call(updated, "not")) {
              b.not = updated.not;
            }
            if (panel.isConnected) {
              syncDetailStatusUi();
            } else if (state.detailPlaceId === null) {
              renderResults({ skipFitBounds: true });
            }
          }
          showToast(`Durum "${meta.label}" olarak güncellendi.`, "success");
        } catch (err) {
          if (state.statusRequestSeq.get(b.place_id) === seq) {
            b.durum = prevDurum;
            b.durum_guncellendi = prevUpdated;
            if (panel.isConnected) {
              syncDetailStatusUi();
            } else if (state.detailPlaceId === null) {
              renderResults({ skipFitBounds: true });
            }
          }
          showToast(err.message || "Durum güncellenemedi.", "error");
        }
      });

      segmented.appendChild(btn);
    }

    segmentedWrap.append(statusLabel, segmented);
    body.appendChild(segmentedWrap);

    const noteBlock = document.createElement("div");
    noteBlock.className = "detail-note-block";

    const noteLabel = document.createElement("label");
    noteLabel.className = "detail-status-field-label";
    noteLabel.setAttribute("for", "detail-note-input");
    noteLabel.textContent = "Not";

    const noteRow = document.createElement("div");
    noteRow.className = "detail-note-row";

    const textarea = document.createElement("textarea");
    textarea.id = "detail-note-input";
    textarea.className = "detail-note-textarea";
    textarea.rows = 3;
    textarea.placeholder = "Görüşme sonucu veya takip notu ekleyin...";
    textarea.value = b.not || "";
    if (!canSave) textarea.disabled = true;

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary detail-note-save-btn";
    saveBtn.appendChild(ICONS.check());
    const saveBtnLabel = document.createElement("span");
    saveBtnLabel.textContent = "Kaydet";
    saveBtn.appendChild(saveBtnLabel);
    if (!canSave) saveBtn.disabled = true;

    let isSavingNote = false;
    async function handleSaveNote() {
      if (!canSave || isSavingNote) return;
      const prevNote = b.not ?? "";
      const prevUpdated = b.durum_guncellendi || null;
      const currentDurum = normalizeDurum(b.durum);
      const newNote = textarea.value;

      const seq = (state.statusRequestSeq.get(b.place_id) || 0) + 1;
      state.statusRequestSeq.set(b.place_id, seq);

      isSavingNote = true;
      saveBtn.disabled = true;
      saveBtnLabel.textContent = "Kaydediliyor...";

      b.not = newNote;
      b.durum_guncellendi = new Date().toISOString();
      if (panel.isConnected) {
        syncDetailStatusUi();
      }

      try {
        const updated = await patchBusinessStatus({ durum: currentDurum, not: newNote });
        if (state.statusRequestSeq.get(b.place_id) === seq) {
          b.durum = normalizeDurum(updated.durum);
          b.not = updated.not ?? "";
          b.durum_guncellendi = updated.durum_guncellendi || b.durum_guncellendi;
          if (panel.isConnected) {
            syncDetailStatusUi();
          } else if (state.detailPlaceId === null) {
            renderResults({ skipFitBounds: true });
          }
        }
        showToast("Not kaydedildi.", "success");
      } catch (err) {
        if (state.statusRequestSeq.get(b.place_id) === seq) {
          b.not = prevNote;
          b.durum_guncellendi = prevUpdated;
          if (panel.isConnected) {
            textarea.value = prevNote;
            syncDetailStatusUi();
          } else if (state.detailPlaceId === null) {
            renderResults({ skipFitBounds: true });
          }
        }
        showToast(err.message || "Not kaydedilemedi.", "error");
      } finally {
        isSavingNote = false;
        if (saveBtn.isConnected) {
          saveBtn.disabled = !canSave;
          saveBtnLabel.textContent = "Kaydet";
        }
      }
    }

    saveBtn.addEventListener("click", handleSaveNote);
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        handleSaveNote();
      }
    });

    noteRow.append(textarea, saveBtn);
    noteBlock.append(noteLabel, noteRow);

    if (!canSave) {
      const hint = document.createElement("p");
      hint.className = "detail-status-readonly-hint muted";
      hint.textContent =
        "Place ID bilgisi bulunmadığı için bu işletmede durum ve not güncellenemez.";
      noteBlock.appendChild(hint);
    }

    body.appendChild(noteBlock);
    panel.appendChild(body);
    syncDetailStatusUi();

    return panel;
  }

  function renderDetailView() {
    if (state.detailPlaceId === null) return;
    destroyDetailMap();
    els.detailView.replaceChildren();

    const b = findBusinessByRouteId(state.detailPlaceId);

    if (!b && state.isLoadingBusinesses) {
      els.detailView.appendChild(createDetailBackTopbar());
      const loadingCard = document.createElement("div");
      loadingCard.className = "panel glass-panel detail-state-card";
      const title = document.createElement("h2");
      title.className = "empty-title";
      title.textContent = "İşletme bilgileri yükleniyor...";
      const desc = document.createElement("p");
      desc.className = "empty-desc";
      desc.textContent = "Kayıt veritabanından alınıyor, lütfen bekleyin.";
      loadingCard.append(title, desc);
      els.detailView.appendChild(loadingCard);
      return;
    }

    if (!b) {
      els.detailView.appendChild(createDetailBackTopbar());
      const emptyCard = document.createElement("div");
      emptyCard.className = "panel glass-panel detail-state-card";
      const illus = document.createElement("span");
      illus.className = "empty-illustration";
      illus.appendChild(ICONS.pin());
      const title = document.createElement("h2");
      title.className = "empty-title";
      title.textContent = "İşletme bulunamadı";
      const desc = document.createElement("p");
      desc.className = "empty-desc";
      desc.textContent =
        "İstediğiniz işletme kaydı mevcut listede bulunamadı veya kaldırılmış olabilir.";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "btn btn-secondary";
      backBtn.textContent = "Listeye Dön";
      backBtn.addEventListener("click", navigateBackToList);
      emptyCard.append(illus, title, desc, backBtn);
      els.detailView.appendChild(emptyCard);
      return;
    }

    const mapsUrl = safeHttpUrl(b.maps_url, false);
    const webUrl = safeHttpUrl(b.website, true);
    const coords = getValidCoords(b);

    els.detailView.appendChild(createDetailBackTopbar(mapsUrl));

    // Hero Card
    const hero = document.createElement("section");
    hero.className = "glass-panel detail-hero";

    const heroMain = document.createElement("div");
    heroMain.className = "detail-hero-main";

    const badges = document.createElement("div");
    badges.className = "detail-hero-badges";
    let heroStatusBadge = createDurumBadge(b.durum);
    badges.appendChild(heroStatusBadge);
    if (b.category) {
      const catTag = document.createElement("span");
      catTag.className = "category-tag";
      catTag.textContent = b.category;
      badges.appendChild(catTag);
    }
    badges.appendChild(createTodayHoursBadge(b.hours));
    heroMain.appendChild(badges);

    const title = document.createElement("h2");
    title.className = "detail-title";
    title.textContent = b.name || "İsimsiz İşletme";
    heroMain.appendChild(title);

    const ratingRow = document.createElement("div");
    ratingRow.className = "detail-rating-row";
    if (b.rating !== null && b.rating !== undefined && Number.isFinite(Number(b.rating))) {
      const ratingNum = Number(b.rating);
      ratingRow.appendChild(createStarRating(ratingNum));
      const score = document.createElement("span");
      score.className = "detail-rating-score tabular";
      score.textContent = ratingNum.toLocaleString("tr-TR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      ratingRow.appendChild(score);

      const countSpan = document.createElement("span");
      countSpan.className = "detail-rating-count tabular";
      if (
        b.review_count !== null &&
        b.review_count !== undefined &&
        Number.isFinite(Number(b.review_count))
      ) {
        countSpan.textContent = `(${Number(b.review_count).toLocaleString("tr-TR")} değerlendirme)`;
      } else {
        countSpan.textContent = "Değerlendirme sayısı belirtilmemiş";
      }
      ratingRow.appendChild(countSpan);
    } else {
      const noRating = document.createElement("span");
      noRating.className = "muted";
      noRating.textContent = "Puan bilgisi yok";
      ratingRow.appendChild(noRating);
    }
    heroMain.appendChild(ratingRow);

    hero.appendChild(heroMain);

    const heroActions = document.createElement("div");
    heroActions.className = "detail-hero-actions";

    if (hasPhone(b)) {
      const telHref = formatPhoneHref(b.phone);
      if (telHref) {
        const callBtn = document.createElement("a");
        callBtn.className = "btn btn-secondary";
        callBtn.href = telHref;
        callBtn.appendChild(ICONS.phone());
        const span = document.createElement("span");
        span.textContent = "Ara";
        callBtn.appendChild(span);
        heroActions.appendChild(callBtn);
      }
    }

    if (webUrl) {
      const webBtn = document.createElement("a");
      webBtn.className = "btn btn-ghost";
      webBtn.href = webUrl.href;
      webBtn.target = "_blank";
      webBtn.rel = "noopener noreferrer";
      webBtn.appendChild(ICONS.globe());
      const span = document.createElement("span");
      span.textContent = "Web Sitesi";
      webBtn.appendChild(span);
      heroActions.appendChild(webBtn);
    }

    if (heroActions.children.length > 0) {
      hero.appendChild(heroActions);
    }

    els.detailView.appendChild(hero);

    els.detailView.appendChild(
      createDetailStatusPanel(b, (nextDurum) => {
        if (!badges.isConnected) return;
        const nextBadge = createDurumBadge(nextDurum);
        heroStatusBadge.replaceWith(nextBadge);
        heroStatusBadge = nextBadge;
      })
    );

    // 2-Column Detail Body
    const grid = document.createElement("div");
    grid.className = "detail-grid";

    const leftCol = document.createElement("div");
    leftCol.className = "detail-col";

    // Contact & Location Info Panel
    const infoPanel = document.createElement("section");
    infoPanel.className = "panel glass-panel";
    const infoHead = document.createElement("div");
    infoHead.className = "panel-head";
    const infoTitleWrap = document.createElement("div");
    infoTitleWrap.className = "panel-title-wrap";
    const infoIcon = ICONS.pin();
    infoIcon.classList.add("panel-icon");
    const infoTitle = document.createElement("h2");
    infoTitle.textContent = "İletişim ve Konum";
    infoTitleWrap.append(infoIcon, infoTitle);
    infoHead.appendChild(infoTitleWrap);
    infoPanel.appendChild(infoHead);

    const infoList = document.createElement("div");
    infoList.className = "detail-info-list";

    // Address row
    const addrNode = document.createElement("span");
    if (b.address) {
      addrNode.textContent = b.address;
    } else {
      addrNode.className = "muted";
      addrNode.textContent = "Adres bilgisi yok";
    }
    infoList.appendChild(
      createDetailInfoRow({
        icon: ICONS.pin(),
        label: "Adres",
        valueNode: addrNode,
        copyValue: b.address || null,
        copyLabel: "Adres",
      })
    );

    // Phone row
    const phoneNode = document.createElement("span");
    if (hasPhone(b)) {
      const telHref = formatPhoneHref(b.phone);
      if (telHref) {
        const a = document.createElement("a");
        a.className = "inline-link tabular";
        a.href = telHref;
        a.textContent = b.phone;
        phoneNode.appendChild(a);
      } else {
        phoneNode.className = "tabular";
        phoneNode.textContent = b.phone;
      }
    } else {
      phoneNode.className = "muted";
      phoneNode.textContent = "Telefon bilgisi yok";
    }
    infoList.appendChild(
      createDetailInfoRow({
        icon: ICONS.phone(),
        label: "Telefon",
        valueNode: phoneNode,
        copyValue: hasPhone(b) ? b.phone : null,
        copyLabel: "Telefon",
      })
    );

    // Website row
    const webNode = document.createElement("span");
    if (webUrl) {
      const a = document.createElement("a");
      a.className = "inline-link";
      a.href = webUrl.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = webUrl.href;
      webNode.appendChild(a);
    } else {
      webNode.className = "muted";
      webNode.textContent = "Web sitesi yok";
    }
    infoList.appendChild(
      createDetailInfoRow({
        icon: ICONS.globe(),
        label: "Web Sitesi",
        valueNode: webNode,
        copyValue: webUrl ? webUrl.href : null,
        copyLabel: "Web sitesi",
      })
    );

    // Coordinates row
    const coordNode = document.createElement("span");
    const coordText = coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : "";
    if (coordText) {
      coordNode.className = "tabular";
      coordNode.textContent = coordText;
    } else {
      coordNode.className = "muted";
      coordNode.textContent = "Koordinat bilgisi yok";
    }
    infoList.appendChild(
      createDetailInfoRow({
        icon: ICONS.compass(),
        label: "Koordinatlar",
        valueNode: coordNode,
        copyValue: coordText || null,
        copyLabel: "Koordinatlar",
      })
    );

    infoPanel.appendChild(infoList);
    leftCol.appendChild(infoPanel);

    // Scrape Metadata Panel
    const metaPanel = document.createElement("section");
    metaPanel.className = "panel glass-panel";
    const metaHead = document.createElement("div");
    metaHead.className = "panel-head";
    const metaTitleWrap = document.createElement("div");
    metaTitleWrap.className = "panel-title-wrap";
    const metaIcon = ICONS.calendar();
    metaIcon.classList.add("panel-icon");
    const metaTitle = document.createElement("h2");
    metaTitle.textContent = "Tarama Bilgileri";
    metaTitleWrap.append(metaIcon, metaTitle);
    metaHead.appendChild(metaTitleWrap);
    metaPanel.appendChild(metaHead);

    const metaGrid = document.createElement("div");
    metaGrid.className = "detail-meta-grid";

    const metaItems = [
      { label: "Arama Bölgesi", value: b.search_region || "Belirtilmemiş" },
      { label: "Arama Türü", value: b.search_category || "Belirtilmemiş" },
      {
        label: "Çekilme Zamanı",
        value: formatDateTimeLong(b.scraped_at) || "Bilinmiyor",
        wide: true,
      },
    ];
    if (b.place_id) {
      metaItems.push({ label: "Place ID", value: b.place_id, wide: true });
    }

    for (const item of metaItems) {
      const box = document.createElement("div");
      box.className = item.wide ? "detail-meta-item is-wide" : "detail-meta-item";
      const lbl = document.createElement("span");
      lbl.className = "detail-info-label";
      lbl.textContent = item.label;
      const val = document.createElement("span");
      val.className = "detail-meta-value";
      val.textContent = item.value;
      box.append(lbl, val);
      metaGrid.appendChild(box);
    }

    metaPanel.appendChild(metaGrid);
    leftCol.appendChild(metaPanel);

    // Right Column: 7-day schedule + Leaflet mini map
    const rightCol = document.createElement("div");
    rightCol.className = "detail-col";

    const hoursPanel = document.createElement("section");
    hoursPanel.className = "panel glass-panel";
    const hoursHead = document.createElement("div");
    hoursHead.className = "panel-head";
    const hoursTitleWrap = document.createElement("div");
    hoursTitleWrap.className = "panel-title-wrap";
    const hoursIcon = ICONS.clock();
    hoursIcon.classList.add("panel-icon");
    const hoursTitle = document.createElement("h2");
    hoursTitle.textContent = "Haftalık Çalışma Saatleri";
    hoursTitleWrap.append(hoursIcon, hoursTitle);
    hoursHead.appendChild(hoursTitleWrap);
    hoursPanel.appendChild(hoursHead);
    hoursPanel.appendChild(createDetailHoursTable(b.hours));
    rightCol.appendChild(hoursPanel);

    const mapPanel = document.createElement("section");
    mapPanel.className = "panel glass-panel";
    const mapHead = document.createElement("div");
    mapHead.className = "panel-head";
    const mapTitleWrap = document.createElement("div");
    mapTitleWrap.className = "panel-title-wrap";
    const mapIcon = ICONS.compass();
    mapIcon.classList.add("panel-icon");
    const mapTitle = document.createElement("h2");
    mapTitle.textContent = "Konum Haritası";
    mapTitleWrap.append(mapIcon, mapTitle);
    mapHead.appendChild(mapTitleWrap);
    if (coordText) {
      const coordBadge = document.createElement("span");
      coordBadge.className = "field-meta tabular";
      coordBadge.textContent = coordText;
      mapHead.appendChild(coordBadge);
    }
    mapPanel.appendChild(mapHead);

    if (!coords) {
      const emptyMap = document.createElement("div");
      emptyMap.className = "detail-map-empty";
      emptyMap.textContent = "Bu işletme için koordinat bilgisi bulunmuyor.";
      mapPanel.appendChild(emptyMap);
    } else if (typeof L === "undefined") {
      const noLib = document.createElement("div");
      noLib.className = "detail-map-empty";
      noLib.textContent = "Harita kütüphanesi yüklenemedi.";
      mapPanel.appendChild(noLib);
    } else {
      const mapEl = document.createElement("div");
      mapEl.id = "detail-map-container";
      mapEl.className = "detail-map-container";
      mapEl.setAttribute("aria-label", `${b.name || "İşletme"} konum haritası`);
      mapPanel.appendChild(mapEl);

      requestAnimationFrame(() => {
        if (state.detailPlaceId === null || !mapEl.isConnected) return;
        const dMap = L.map(mapEl, {
          zoomControl: true,
          scrollWheelZoom: false,
        }).setView([coords.lat, coords.lng], 15);

        state.detailMapInstance = dMap;
        updateMapTileLayer();

        const pinIcon = L.divIcon({
          className: "custom-map-pin",
          html: '<div class="map-pin-badge"></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          popupAnchor: [0, -26],
        });
        L.marker([coords.lat, coords.lng], {
          icon: pinIcon,
          title: b.name || "",
        }).addTo(dMap);

        dMap.invalidateSize();
      });
    }

    rightCol.appendChild(mapPanel);
    grid.append(leftCol, rightCol);
    els.detailView.appendChild(grid);
  }

  function openDetailRoute(id) {
    state.detailPlaceId = id;
    els.workspace.classList.add("is-detail-mode");
    els.sidebar.hidden = true;
    els.mainContent.hidden = true;
    els.detailView.hidden = false;
    renderDetailView();
    window.scrollTo(0, 0);
  }

  function closeDetailRoute() {
    state.detailPlaceId = null;
    destroyDetailMap();
    els.detailView.hidden = true;
    els.detailView.replaceChildren();
    els.workspace.classList.remove("is-detail-mode");
    els.sidebar.hidden = false;
    els.mainContent.hidden = false;

    renderResults({ skipFitBounds: true });

    requestAnimationFrame(() => {
      window.scrollTo(0, state.savedScrollY || 0);
      if (state.viewMode === "map" && state.mapInstance) {
        state.mapInstance.invalidateSize();
        if (state.mapNeedsSync) {
          syncMapMarkers(getFilteredAndSortedBusinesses(), false);
        }
      }
    });
  }

  function handleHashChange() {
    closeActivePortal();
    const detailId = parseDetailHash(window.location.hash);
    if (detailId !== null) {
      if (state.detailPlaceId === null) {
        if (!state.capturedScrollBeforeHash) {
          state.savedScrollY = window.scrollY;
        }
        state.capturedScrollBeforeHash = false;
      }
      openDetailRoute(detailId);
    } else {
      state.capturedScrollBeforeHash = false;
      if (state.detailPlaceId !== null) {
        closeDetailRoute();
      }
    }
  }

  /* Sidebar, Search Scope & Job Polling */
  function showFormError(message) {
    if (!message) {
      els.formError.hidden = true;
      els.formError.textContent = "";
      return;
    }
    els.formError.textContent = message;
    els.formError.hidden = false;
  }

  function showTableError(message) {
    if (!message) {
      els.tableError.hidden = true;
      els.tableError.textContent = "";
      return;
    }
    els.tableError.textContent = message;
    els.tableError.hidden = false;
  }

  function updateFilterScopeDisplay() {
    const hasSearchScope = Boolean(state.filterRegion || state.filterCategory);
    if (hasSearchScope) {
      const parts = [state.filterRegion, state.filterCategory].filter(Boolean);
      els.activeFilterLabel.textContent = parts.join(" · ");
      els.activeFilterLabel.classList.add("is-filtered");
      els.clearFilterBtn.hidden = false;
      els.showAllBtn.hidden = false;
    } else {
      els.activeFilterLabel.textContent = "Tüm kayıtlar";
      els.activeFilterLabel.classList.remove("is-filtered");
      els.clearFilterBtn.hidden = true;
      els.showAllBtn.hidden = true;
    }
  }

  function renderSearches() {
    els.searchesList.replaceChildren();
    const searches = state.searches;

    if (!searches.length) {
      els.searchesEmpty.hidden = false;
      els.globalStats.textContent = `${state.businesses.length.toLocaleString("tr-TR")} kayıt`;
      return;
    }

    els.searchesEmpty.hidden = true;
    let totalRecords = 0;

    for (const item of searches) {
      totalRecords += Number(item.count) || 0;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-item-btn";

      const itemRegion = item.search_region || null;
      const itemCategory = item.search_category || null;
      const isActive =
        state.filterRegion === itemRegion && state.filterCategory === itemCategory;
      if (isActive) {
        btn.classList.add("is-active");
      }
      btn.setAttribute("aria-pressed", String(isActive));

      const top = document.createElement("div");
      top.className = "search-item-top";

      const title = document.createElement("span");
      title.className = "search-item-title";
      title.textContent = item.search_region || "Belirtilmemiş bölge";

      const count = document.createElement("span");
      count.className = "search-item-count tabular";
      count.textContent = `${Number(item.count ?? 0).toLocaleString("tr-TR")} kayıt`;

      top.append(title, count);

      const meta = document.createElement("div");
      meta.className = "search-item-meta";

      const cat = document.createElement("span");
      cat.textContent = item.search_category || "Genel";

      const dt = document.createElement("span");
      dt.className = "tabular";
      dt.textContent = formatDateTime(item.last_scraped_at);

      meta.append(cat, dt);
      btn.append(top, meta);

      btn.addEventListener("click", () => {
        if (isActive) {
          setSearchFilter(null, null);
        } else {
          setSearchFilter(itemRegion, itemCategory);
        }
      });

      li.appendChild(btn);
      els.searchesList.appendChild(li);
    }

    els.globalStats.textContent = `${totalRecords.toLocaleString("tr-TR")} toplam kayıt`;
  }

  function buildScopeQueryParams() {
    const params = new URLSearchParams();
    if (state.filterRegion) params.set("region", state.filterRegion);
    if (state.filterCategory) params.set("category", state.filterCategory);
    return params;
  }

  async function loadBusinesses({ silent = false } = {}) {
    showTableError("");
    if (!silent) {
      state.isLoadingBusinesses = true;
      if (state.businesses.length === 0) {
        renderResults();
      }
    }

    const params = buildScopeQueryParams();
    const qs = params.toString();
    const url = qs ? `/api/businesses?${qs}` : "/api/businesses";

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Sunucu hatası (${response.status})`);
      }
      const data = await response.json();
      state.businesses = Array.isArray(data) ? data : [];
      state.isLoadingBusinesses = false;
      populateFilterDropdowns();
      renderResults();
      if (state.detailPlaceId !== null && !els.detailView.querySelector(".detail-hero")) {
        renderDetailView();
      }
      if (!state.searches.length) {
        els.globalStats.textContent = `${state.businesses.length.toLocaleString("tr-TR")} kayıt`;
      }
    } catch (err) {
      state.isLoadingBusinesses = false;
      renderResults();
      if (state.detailPlaceId !== null && !els.detailView.querySelector(".detail-hero")) {
        renderDetailView();
      }
      showTableError(`İşletme listesi yüklenemedi: ${err.message}`);
    }
  }

  async function loadSearches() {
    try {
      const response = await fetch("/api/searches");
      if (!response.ok) return;
      const data = await response.json();
      state.searches = Array.isArray(data) ? data : [];
      renderSearches();
    } catch {
      // Non-fatal background refresh
    }
  }

  function setSearchFilter(region, category) {
    state.filterRegion = region;
    state.filterCategory = category;
    state.currentPage = 1;
    updateFilterScopeDisplay();
    renderSearches();
    loadBusinesses();
  }

  function isBatchRunning() {
    return Boolean(state.activeBatch && state.activeBatch.status === "running");
  }

  function isBatchActive() {
    return Boolean(
      state.activeBatch &&
        (state.activeBatch.status === "running" || state.activeBatch.status === "paused")
    );
  }

  function clampWorkersCount(value) {
    const num = Number.parseInt(value, 10);
    if (!Number.isFinite(num)) return 1;
    return Math.min(5, Math.max(1, num));
  }

  function parseOptionalWorkersCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number.parseInt(value, 10);
    if (!Number.isFinite(num) || num < 1 || num > 5) return null;
    return num;
  }

  function getActiveEffectiveWorkers() {
    if (state.activeJobId && state.trackedGlobalJob && state.trackedGlobalJob.status === "running") {
      return parseOptionalWorkersCount(state.trackedGlobalJob.workers);
    }
    if (isBatchActive()) {
      return parseOptionalWorkersCount(state.activeBatch.workers);
    }
    return null;
  }

  function renderWorkersControl(workersCount) {
    const workers = clampWorkersCount(workersCount);
    if (els.workersMeta) {
      els.workersMeta.textContent = `${workers} tarayıcı`;
    }
    for (const pill of els.workerPills) {
      const pillVal = Number.parseInt(pill.dataset.workers, 10);
      const active = pillVal === workers;
      pill.classList.toggle("is-active", active);
      pill.setAttribute("aria-pressed", String(active));
    }
  }

  function syncWorkersDisplay() {
    const activeWorkers = getActiveEffectiveWorkers();
    renderWorkersControl(activeWorkers !== null ? activeWorkers : state.savedWorkers);
  }

  function applyWorkersSelection(value, persist = false) {
    const workers = clampWorkersCount(value);
    state.savedWorkers = workers;
    syncWorkersDisplay();
    if (persist) {
      try {
        safeStorageSet(localStorage, WORKERS_STORAGE_KEY, String(workers));
      } catch {
        // Storage unavailable
      }
    }
  }

  function initWorkersSelector() {
    let saved = null;
    try {
      saved = safeStorageGet(localStorage, WORKERS_STORAGE_KEY);
    } catch {
      saved = null;
    }
    applyWorkersSelection(saved || 1, false);
  }

  function setRunningUi(isRunning) {
    const singleRunning = Boolean(isRunning);
    const anyBlocking = singleRunning || isBatchActive() || state.batchSubmitPending;
    els.startBtn.disabled = anyBlocking;
    for (const btn of els.modeToggleBtns) {
      btn.disabled = anyBlocking;
    }
    els.ilInput.disabled = anyBlocking;
    els.ilToggleBtn.disabled = anyBlocking;
    els.ilClearBtn.disabled = anyBlocking;
    els.ilceInput.disabled = anyBlocking || !state.selectedIl;
    els.ilceToggleBtn.disabled = anyBlocking || !state.selectedIl;
    els.categoryInput.disabled = anyBlocking;
    els.categoryToggleBtn.disabled = anyBlocking;
    els.categoryClearBtn.disabled = anyBlocking;

    els.batchIlInput.disabled = anyBlocking;
    els.batchIlToggleBtn.disabled = anyBlocking;
    els.batchIlClearBtn.disabled = anyBlocking;
    els.batchIlceSelectBtn.disabled = anyBlocking || !state.batchIl;
    els.batchIlceAllBtn.disabled = anyBlocking || !state.batchIl;
    els.batchCatSelectBtn.disabled = anyBlocking;
    if (anyBlocking) {
      closeActivePortal();
    }
    for (const chipBtn of els.batchFields.querySelectorAll(".batch-chip-remove")) {
      chipBtn.disabled = anyBlocking;
    }

    els.maxResultsInput.disabled = anyBlocking || state.maxResultsUnlimited;
    els.headlessInput.disabled = anyBlocking;
    for (const pill of els.presetPills) {
      pill.disabled = anyBlocking;
    }
    for (const pill of els.workerPills) {
      pill.disabled = anyBlocking;
    }
    syncWorkersDisplay();
    syncAllControlButtons();
  }

  /* Global Progress Bar (Batches & Active Jobs) */
  function formatEtaRemaining(etaSeconds) {
    if (etaSeconds === null || etaSeconds === undefined) return "";
    const secs = Number(etaSeconds);
    if (!Number.isFinite(secs) || secs < 0) return "";
    if (secs < 60) {
      return `~${Math.max(1, Math.round(secs))} sn kaldı`;
    }
    if (secs < 3600) {
      return `~${Math.max(1, Math.round(secs / 60))} dk kaldı`;
    }
    const hours = Math.floor(secs / 3600);
    const mins = Math.round((secs % 3600) / 60);
    if (mins >= 60) {
      return `~${hours + 1} sa kaldı`;
    }
    if (mins === 0) {
      return `~${hours} sa kaldı`;
    }
    return `~${hours} sa ${mins} dk kaldı`;
  }

  function scheduleLiveDataRefresh() {
    if (state.liveRefreshTimer !== null) {
      clearTimeout(state.liveRefreshTimer);
    }
    state.liveRefreshTimer = setTimeout(async () => {
      state.liveRefreshTimer = null;
      await Promise.all([loadBusinesses({ silent: true }), loadSearches()]);
    }, LIVE_REFRESH_DEBOUNCE_MS);
  }

  function getActiveGlobalTarget() {
    const batch = state.activeBatch;
    const job = state.trackedGlobalJob;

    if (batch && (batch.status === "running" || batch.status === "paused")) {
      return { kind: "batch", data: batch };
    }
    if (job && job.status === "running") {
      return { kind: "job", data: job };
    }

    const showableBatch =
      batch && batch.batch_id && batch.batch_id !== state.dismissedBatchId ? batch : null;
    const showableJob =
      job && job.job_id && job.job_id !== state.dismissedJobId ? job : null;

    if (showableBatch && showableJob) {
      const batchFin = Date.parse(showableBatch.finished_at || 0) || 0;
      const jobFin = Date.parse(showableJob.finished_at || 0) || 0;
      return jobFin >= batchFin
        ? { kind: "job", data: showableJob }
        : { kind: "batch", data: showableBatch };
    }
    if (showableBatch) {
      return { kind: "batch", data: showableBatch };
    }
    if (showableJob) {
      return { kind: "job", data: showableJob };
    }
    return null;
  }

  function createItemStatusIcon(status) {
    if (status === "done") return ICONS.statusDone();
    if (status === "running") return ICONS.statusRunning();
    if (status === "paused") return ICONS.statusPaused();
    if (status === "skipped") return ICONS.statusSkipped();
    if (status === "captcha") return ICONS.statusCaptcha();
    if (status === "error") return ICONS.statusError();
    if (status === "cancelled") return ICONS.statusCancelled();
    return ICONS.statusPending();
  }

  function buildGlobalItemRow(item, idx) {
    const li = document.createElement("li");
    const status = item.status || "pending";
    li.className = `gp-item is-${status}`;
    li.dataset.status = status;

    const left = document.createElement("div");
    left.className = "gp-item-left";

    const iconWrap = document.createElement("span");
    iconWrap.className = "gp-item-icon";
    iconWrap.setAttribute("aria-hidden", "true");
    iconWrap.appendChild(createItemStatusIcon(status));

    const idxSpan = document.createElement("span");
    idxSpan.className = "gp-item-idx tabular";
    idxSpan.textContent = `${idx + 1}.`;

    const titleSpan = document.createElement("span");
    titleSpan.className = "gp-item-title";
    titleSpan.textContent = `${item.region || ""} — ${item.category || ""}`;

    left.append(iconWrap, idxSpan, titleSpan);

    const right = document.createElement("div");
    right.className = "gp-item-right";

    const statusSpan = document.createElement("span");
    statusSpan.className = "gp-item-status";
    statusSpan.textContent = BATCH_ITEM_STATUS_LABELS[status] || status;

    const countSpan = document.createElement("span");
    countSpan.className = "gp-item-count tabular";
    countSpan.textContent = `${Number(item.done || 0).toLocaleString("tr-TR")} kayıt`;

    right.append(statusSpan, countSpan);
    li.append(left, right);
    return li;
  }

  function renderGlobalItemsList(items, detailsMessage) {
    if (detailsMessage) {
      els.gpDetailsMsg.textContent = detailsMessage;
      els.gpDetailsMsg.hidden = false;
    } else {
      els.gpDetailsMsg.hidden = true;
      els.gpDetailsMsg.textContent = "";
    }

    const existing = els.gpItemsList.children;
    if (existing.length === items.length) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const li = existing[i];
        const status = item.status || "pending";
        const nextTitle = `${item.region || ""} — ${item.category || ""}`;
        const nextCount = `${Number(item.done || 0).toLocaleString("tr-TR")} kayıt`;

        const titleEl = li.querySelector(".gp-item-title");
        if (titleEl && titleEl.textContent !== nextTitle) {
          titleEl.textContent = nextTitle;
        }
        const countEl = li.querySelector(".gp-item-count");
        if (countEl && countEl.textContent !== nextCount) {
          countEl.textContent = nextCount;
        }
        if (li.dataset.status !== status) {
          li.className = `gp-item is-${status}`;
          li.dataset.status = status;
          const iconEl = li.querySelector(".gp-item-icon");
          if (iconEl) iconEl.replaceChildren(createItemStatusIcon(status));
          const statusEl = li.querySelector(".gp-item-status");
          if (statusEl) statusEl.textContent = BATCH_ITEM_STATUS_LABELS[status] || status;
        }
      }
      return;
    }

    const prevScroll = els.gpDetails.scrollTop;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i += 1) {
      frag.appendChild(buildGlobalItemRow(items[i], i));
    }
    els.gpItemsList.replaceChildren(frag);
    els.gpDetails.scrollTop = prevScroll;
  }

  function buildBatchSummaryText(batch) {
    const status = batch.status || "running";
    const totalItems = Math.max(0, Number(batch.total_items) || 0);
    const completedItems = Math.max(0, Number(batch.completed_items) || 0);
    const totalSaved = Math.max(0, Number(batch.total_saved) || 0);
    const workers = clampWorkersCount(batch.workers);

    if (status === "paused") {
      const pausedParts = [
        `Duraklatıldı · ${completedItems.toLocaleString("tr-TR")} / ${totalItems.toLocaleString("tr-TR")} arama`,
      ];
      if (totalSaved > 0) {
        pausedParts.push(`Toplam ${totalSaved.toLocaleString("tr-TR")} kayıt`);
      }
      pausedParts.push(`${workers} tarayıcı`);
      return pausedParts.join(" · ");
    }

    const parts = [
      `${completedItems.toLocaleString("tr-TR")} / ${totalItems.toLocaleString("tr-TR")} arama`,
    ];

    if (status === "running" && batch.current) {
      const curDone = Number(batch.current.done || 0).toLocaleString("tr-TR");
      parts.push(
        `Şu an: ${batch.current.region || ""} — ${batch.current.category || ""} (${curDone} bulundu)`
      );
    }

    parts.push(`Toplam ${totalSaved.toLocaleString("tr-TR")} kayıt`);
    parts.push(`${workers} tarayıcı`);

    if (status === "running") {
      const etaText = formatEtaRemaining(batch.eta_seconds);
      if (etaText) parts.push(etaText);
    } else if (batch.message) {
      parts.push(batch.message);
    }

    return parts.join(" · ");
  }

  function syncAllControlButtons() {
    const target = getActiveGlobalTarget();

    // 1. Global Progress Bar controls
    if (!target) {
      state.gpCancelConfirming = false;
      els.gpPauseBtn.hidden = true;
      els.gpResumeBtn.hidden = true;
      els.gpCancelBtn.hidden = true;
      els.gpConfirmBox.hidden = true;
      els.gpDismissBtn.hidden = true;
    } else if (target.data.status !== "running" && target.data.status !== "paused") {
      state.gpCancelConfirming = false;
      els.gpPauseBtn.hidden = true;
      els.gpResumeBtn.hidden = true;
      els.gpCancelBtn.hidden = true;
      els.gpConfirmBox.hidden = true;
      els.gpDismissBtn.hidden = false;
    } else if (target.kind === "batch") {
      const bStatus = target.data.status;
      const busy = state.batchActionPending;
      els.gpDismissBtn.hidden = true;
      if (state.gpCancelConfirming) {
        els.gpPauseBtn.hidden = true;
        els.gpResumeBtn.hidden = true;
        els.gpCancelBtn.hidden = true;
        els.gpConfirmBox.hidden = false;
        els.gpConfirmYes.disabled = busy;
        els.gpConfirmNo.disabled = busy;
      } else {
        els.gpConfirmBox.hidden = true;
        els.gpPauseBtn.hidden = bStatus !== "running";
        els.gpPauseBtn.disabled = busy;
        els.gpResumeBtn.hidden = bStatus !== "paused";
        els.gpResumeBtn.disabled = busy;
        els.gpCancelBtn.hidden = false;
        els.gpCancelBtn.disabled = busy;
      }
    } else {
      const busy = state.jobCancelPending;
      els.gpPauseBtn.hidden = true;
      els.gpResumeBtn.hidden = true;
      els.gpDismissBtn.hidden = true;
      if (state.gpCancelConfirming) {
        els.gpCancelBtn.hidden = true;
        els.gpConfirmBox.hidden = false;
        els.gpConfirmYes.disabled = busy;
        els.gpConfirmNo.disabled = busy;
      } else {
        els.gpConfirmBox.hidden = true;
        els.gpCancelBtn.hidden = false;
        els.gpCancelBtn.disabled = busy;
      }
    }

    // 2. Sidebar 'Yeni Tarama' form + 'Tarama Durumu' panel controls
    if (state.activeJobId) {
      const busy = state.jobCancelPending;
      els.cancelBtn.hidden = state.formCancelConfirming;
      els.cancelBtn.disabled = busy;
      els.formConfirmBox.hidden = !state.formCancelConfirming;
      els.formConfirmYes.disabled = busy;
      els.formConfirmNo.disabled = busy;

      els.statusActions.hidden = false;
      els.statusPauseBtn.hidden = true;
      els.statusResumeBtn.hidden = true;
      if (state.statusCancelConfirming) {
        els.statusCancelBtn.hidden = true;
        els.statusConfirmBox.hidden = false;
        els.statusConfirmYes.disabled = busy;
        els.statusConfirmNo.disabled = busy;
      } else {
        els.statusConfirmBox.hidden = true;
        els.statusCancelBtn.hidden = false;
        els.statusCancelBtn.disabled = busy;
      }
    } else if (isBatchActive()) {
      const bStatus = state.activeBatch.status;
      const busy = state.batchActionPending;
      state.formCancelConfirming = false;
      els.cancelBtn.hidden = true;
      els.formConfirmBox.hidden = true;

      els.statusActions.hidden = false;
      if (state.statusCancelConfirming) {
        els.statusPauseBtn.hidden = true;
        els.statusResumeBtn.hidden = true;
        els.statusCancelBtn.hidden = true;
        els.statusConfirmBox.hidden = false;
        els.statusConfirmYes.disabled = busy;
        els.statusConfirmNo.disabled = busy;
      } else {
        els.statusConfirmBox.hidden = true;
        els.statusPauseBtn.hidden = bStatus !== "running";
        els.statusPauseBtn.disabled = busy;
        els.statusResumeBtn.hidden = bStatus !== "paused";
        els.statusResumeBtn.disabled = busy;
        els.statusCancelBtn.hidden = false;
        els.statusCancelBtn.disabled = busy;
      }
    } else {
      state.formCancelConfirming = false;
      state.statusCancelConfirming = false;
      els.cancelBtn.hidden = true;
      els.cancelBtn.disabled = false;
      els.formConfirmBox.hidden = true;
      els.statusActions.hidden = true;
      els.statusConfirmBox.hidden = true;
    }
  }

  function renderGlobalProgress() {
    const target = getActiveGlobalTarget();
    if (!target) {
      els.globalProgress.hidden = true;
      syncAllControlButtons();
      return;
    }

    els.globalProgress.hidden = false;

    if (target.kind === "batch") {
      const b = target.data;
      const status = b.status || "running";
      const totalItems = Math.max(0, Number(b.total_items) || 0);
      const completedItems = Math.max(0, Number(b.completed_items) || 0);

      els.globalProgress.className = `global-progress is-${status}`;
      els.gpDot.className = `live-dot is-${status}`;
      els.gpLabel.textContent = b.label || "Toplu tarama";
      els.gpStatusBadge.className = `status-badge is-${status}`;
      els.gpStatusBadge.textContent = STATUS_LABELS[status] || status;

      els.gpBarTrack.classList.remove("is-indeterminate");
      const pct =
        status === "done"
          ? 100
          : totalItems > 0
            ? Math.min(100, Math.round((completedItems / totalItems) * 100))
            : 0;
      els.gpBarTrack.setAttribute("aria-valuenow", String(pct));
      els.gpBarFill.style.width = `${pct}%`;
      els.gpPercent.textContent = `%${pct}`;

      els.gpSummary.textContent = buildBatchSummaryText(b);

      syncAllControlButtons();
      renderGlobalItemsList(Array.isArray(b.items) ? b.items : [], b.message || "");
      els.gpToggleBtn.setAttribute("aria-expanded", String(state.globalProgressExpanded));
      els.gpDetails.hidden = !state.globalProgressExpanded;
      return;
    }

    // Single job display
    const j = target.data;
    const status = j.status || "running";
    const done = Number(j.done) || 0;
    const total = Number(j.total) || 0;
    const msg = j.message || "";
    const isRunning = status === "running";
    const isCollectingLinks =
      isRunning && done === 0 && total > 0 && /bağlantı bulundu/i.test(msg);
    const titleText = [j.region, j.category].filter(Boolean).join(" — ") || "Tekli tarama";
    const workers = clampWorkersCount(j.workers);

    els.globalProgress.className = `global-progress is-${status}`;
    els.gpDot.className = `live-dot is-${status}`;
    els.gpLabel.textContent = titleText;
    els.gpStatusBadge.className = `status-badge is-${status}`;
    els.gpStatusBadge.textContent = STATUS_LABELS[status] || status;

    if (isCollectingLinks || (isRunning && total <= 0)) {
      els.gpBarTrack.classList.add("is-indeterminate");
      els.gpBarTrack.setAttribute("aria-valuenow", "0");
      els.gpBarFill.style.width = "";
      els.gpPercent.textContent = isCollectingLinks
        ? `${total.toLocaleString("tr-TR")} bağlantı`
        : done > 0
          ? `${done.toLocaleString("tr-TR")} bulundu`
          : "Hazırlanıyor";
    } else if (total > 0) {
      els.gpBarTrack.classList.remove("is-indeterminate");
      const effectiveTotal = Math.max(total, done);
      const pct = Math.min(100, Math.round((done / effectiveTotal) * 100));
      els.gpBarTrack.setAttribute("aria-valuenow", String(pct));
      els.gpBarFill.style.width = `${pct}%`;
      els.gpPercent.textContent = `%${pct}`;
    } else {
      els.gpBarTrack.classList.remove("is-indeterminate");
      const pct = status === "done" ? 100 : 0;
      els.gpBarTrack.setAttribute("aria-valuenow", String(pct));
      els.gpBarFill.style.width = `${pct}%`;
      els.gpPercent.textContent =
        status === "done" ? "%100" : `${done.toLocaleString("tr-TR")} kayıt`;
    }

    const summaryParts = [titleText];
    if (total > 0) {
      summaryParts.push(
        `${done.toLocaleString("tr-TR")} / ${Math.max(total, done).toLocaleString("tr-TR")} kayıt`
      );
    } else {
      summaryParts.push(
        isRunning
          ? `${done.toLocaleString("tr-TR")} bulundu`
          : `${done.toLocaleString("tr-TR")} kayıt`
      );
    }
    summaryParts.push(`${workers} tarayıcı`);
    if (msg) summaryParts.push(msg);
    els.gpSummary.textContent = summaryParts.join(" · ");

    syncAllControlButtons();

    renderGlobalItemsList(
      [
        {
          region: j.region || "",
          category: j.category || "",
          status,
          done,
        },
      ],
      msg
    );
    els.gpToggleBtn.setAttribute("aria-expanded", String(state.globalProgressExpanded));
    els.gpDetails.hidden = !state.globalProgressExpanded;
  }

  function toggleGlobalProgressDetails() {
    state.globalProgressExpanded = !state.globalProgressExpanded;
    els.gpToggleBtn.setAttribute("aria-expanded", String(state.globalProgressExpanded));
    els.gpDetails.hidden = !state.globalProgressExpanded;
  }

  async function performBatchPause(batchId) {
    if (!batchId || state.batchActionPending) return;
    state.batchActionPending = true;
    state.gpCancelConfirming = false;
    state.statusCancelConfirming = false;
    syncAllControlButtons();

    try {
      const resp = await fetch(`/api/batches/${encodeURIComponent(batchId)}/pause`, {
        method: "POST",
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(extractApiError(body, `Toplu tarama duraklatılamadı (${resp.status}).`), "error");
        return;
      }
      state.activeBatch = body;
      state.lastBatchStatus = body.status;
      showToast("Toplu tarama duraklatıldı.", "info");
      renderBatchStatusPanel(body);
      setRunningUi(Boolean(state.activeJobId));
      renderGlobalProgress();
      triggerActivePollNow();
    } catch (err) {
      showToast(`Toplu tarama duraklatılamadı: ${err.message}`, "error");
    } finally {
      state.batchActionPending = false;
      syncAllControlButtons();
    }
  }

  async function performBatchResume(batchId) {
    if (!batchId || state.batchActionPending) return;
    state.batchActionPending = true;
    state.gpCancelConfirming = false;
    state.statusCancelConfirming = false;
    syncAllControlButtons();

    try {
      const resp = await fetch(`/api/batches/${encodeURIComponent(batchId)}/resume`, {
        method: "POST",
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(extractApiError(body, `Toplu tarama devam ettirilemedi (${resp.status}).`), "error");
        return;
      }
      state.activeBatch = body;
      state.lastBatchStatus = body.status;
      showToast("Toplu tarama devam ettiriliyor.", "info");
      renderBatchStatusPanel(body);
      setRunningUi(Boolean(state.activeJobId));
      renderGlobalProgress();
      triggerActivePollNow();
    } catch (err) {
      showToast(`Toplu tarama devam ettirilemedi: ${err.message}`, "error");
    } finally {
      state.batchActionPending = false;
      syncAllControlButtons();
    }
  }

  async function performBatchCancel(batchId) {
    if (!batchId || state.batchActionPending) return;
    state.batchActionPending = true;
    syncAllControlButtons();

    try {
      const resp = await fetch(`/api/batches/${encodeURIComponent(batchId)}/cancel`, {
        method: "POST",
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(extractApiError(body, `Toplu tarama iptal edilemedi (${resp.status}).`), "error");
        return;
      }
      state.gpCancelConfirming = false;
      state.statusCancelConfirming = false;
      showToast("Toplu tarama iptal isteği gönderildi.", "info");
      triggerActivePollNow();
    } catch (err) {
      showToast(`Toplu tarama iptal edilemedi: ${err.message}`, "error");
    } finally {
      state.batchActionPending = false;
      syncAllControlButtons();
    }
  }

  async function performSingleJobCancel(jobId) {
    if (!jobId || state.jobCancelPending) return;
    state.jobCancelPending = true;
    syncAllControlButtons();

    try {
      const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(extractApiError(body, `Tarama iptal edilemedi (${resp.status}).`), "error");
        return;
      }
      state.gpCancelConfirming = false;
      state.formCancelConfirming = false;
      state.statusCancelConfirming = false;
      if (state.activeJobId === jobId) {
        els.statusMessage.textContent = "Tarama iptal ediliyor, mevcut işlem sonlandırılıyor...";
      }
      showToast("İptal isteği gönderildi.", "info");
      triggerActivePollNow();
    } catch (err) {
      showToast(`Tarama iptal edilemedi: ${err.message}`, "error");
    } finally {
      state.jobCancelPending = false;
      syncAllControlButtons();
    }
  }

  function handleGlobalPauseClick() {
    const target = getActiveGlobalTarget();
    if (!target || target.kind !== "batch" || target.data.status !== "running") return;
    performBatchPause(target.data.batch_id);
  }

  function handleGlobalResumeClick() {
    const target = getActiveGlobalTarget();
    if (!target || target.kind !== "batch" || target.data.status !== "paused") return;
    performBatchResume(target.data.batch_id);
  }

  function handleGlobalCancelRequest() {
    const target = getActiveGlobalTarget();
    if (!target || (target.data.status !== "running" && target.data.status !== "paused")) return;
    state.gpCancelConfirming = true;
    syncAllControlButtons();
  }

  function handleGlobalCancelConfirmYes() {
    const target = getActiveGlobalTarget();
    if (!target || (target.data.status !== "running" && target.data.status !== "paused")) {
      state.gpCancelConfirming = false;
      syncAllControlButtons();
      return;
    }
    if (target.kind === "batch") {
      performBatchCancel(target.data.batch_id);
    } else {
      performSingleJobCancel(target.data.job_id);
    }
  }

  function handleGlobalCancelConfirmNo() {
    state.gpCancelConfirming = false;
    syncAllControlButtons();
  }

  function handleGlobalDismissClick() {
    const target = getActiveGlobalTarget();
    if (!target || target.data.status === "running" || target.data.status === "paused") return;

    if (target.kind === "batch") {
      state.dismissedBatchId = target.data.batch_id;
      safeStorageSet(sessionStorage, DISMISSED_BATCH_STORAGE_KEY, target.data.batch_id);
    } else {
      state.dismissedJobId = target.data.job_id;
      safeStorageSet(sessionStorage, DISMISSED_JOB_STORAGE_KEY, target.data.job_id);
    }
    state.globalProgressExpanded = false;
    renderGlobalProgress();
  }

  function stopActivePollTimer() {
    if (state.activePollTimer !== null) {
      clearTimeout(state.activePollTimer);
      state.activePollTimer = null;
    }
  }

  function scheduleActivePoll(delayMs) {
    stopActivePollTimer();
    state.activePollTimer = setTimeout(() => {
      pollActive();
    }, delayMs);
  }

  function triggerActivePollNow() {
    stopActivePollTimer();
    pollActive();
  }

  async function pollActive() {
    if (state.activePollInFlight) {
      state.activePollQueued = true;
      return;
    }
    state.activePollInFlight = true;
    state.activePollQueued = false;

    try {
      const response = await fetch("/api/active");
      if (!response.ok) {
        throw new Error(`Aktif durum alınamadı (${response.status})`);
      }
      const data = await response.json();
      const batch = data && data.batch ? data.batch : null;
      const job = data && data.job ? data.job : null;

      if (batch) {
        if (batch.batch_id !== state.lastBatchId) {
          state.lastBatchId = batch.batch_id;
          state.lastBatchStatus = null;
          state.lastBatchCompletedItems = -1;
          state.lastBatchTotalSaved = -1;
          if (
            (batch.status === "running" || batch.status === "paused") &&
            state.dismissedBatchId === batch.batch_id
          ) {
            state.dismissedBatchId = null;
            safeStorageRemove(sessionStorage, DISMISSED_BATCH_STORAGE_KEY);
          }
        }

        const completedNow = Number(batch.completed_items) || 0;
        const savedNow = Number(batch.total_saved) || 0;
        const wasActiveBatch =
          state.lastBatchStatus === "running" || state.lastBatchStatus === "paused";
        const isTerminalNow = batch.status !== "running" && batch.status !== "paused";

        if (wasActiveBatch && isTerminalNow) {
          if (batch.status === "done") {
            showToast(batch.message || "Toplu tarama tamamlandı.", "success");
          } else if (batch.status === "captcha") {
            showToast("Toplu taramada CAPTCHA algılandı.", "warning");
          } else if (batch.status === "cancelled") {
            showToast(batch.message || "Toplu tarama iptal edildi.", "info");
          } else if (batch.status === "error") {
            showToast(batch.message || "Toplu taramada hata oluştu.", "error");
          }
          await Promise.all([loadBusinesses({ silent: true }), loadSearches()]);
        } else if (
          (batch.status === "running" ||
            (state.lastBatchStatus === "running" && batch.status === "paused")) &&
          ((state.lastBatchCompletedItems >= 0 && completedNow > state.lastBatchCompletedItems) ||
            (state.lastBatchTotalSaved >= 0 && savedNow > state.lastBatchTotalSaved))
        ) {
          scheduleLiveDataRefresh();
        }

        state.lastBatchCompletedItems = completedNow;
        state.lastBatchTotalSaved = savedNow;
        state.lastBatchStatus = batch.status;
        state.activeBatch = batch;

        if (!state.activeJobId && (batch.status === "running" || batch.status === "paused" || wasActiveBatch)) {
          renderBatchStatusPanel(batch);
        }
      } else {
        state.activeBatch = null;
        state.lastBatchId = null;
        state.lastBatchStatus = null;
        state.lastBatchCompletedItems = -1;
        state.lastBatchTotalSaved = -1;
      }

      if (job && job.status === "running") {
        state.trackedGlobalJob = job;
        if (!state.activeJobId) {
          state.activeJobId = job.job_id;
          state.lastJobStatus = "running";
          state.lastObservedDone = Number(job.done) || 0;
          safeStorageSet(sessionStorage, ACTIVE_JOB_STORAGE_KEY, job.job_id);
          renderJobStatus(job);
          pollJob(job.job_id);
        }
      } else if (state.trackedGlobalJob && state.trackedGlobalJob.status === "running") {
        const finishedId = state.trackedGlobalJob.job_id;
        try {
          const jobResp = await fetch(`/api/jobs/${encodeURIComponent(finishedId)}`);
          if (jobResp.ok) {
            const finishedJob = await jobResp.json();
            state.trackedGlobalJob = finishedJob;
            if (state.activeJobId === finishedId && finishedJob.status !== "running") {
              state.activeJobId = null;
              safeStorageRemove(sessionStorage, ACTIVE_JOB_STORAGE_KEY);
            }
          } else if (jobResp.status === 404) {
            state.trackedGlobalJob = null;
          }
        } catch {
          // Keep current snapshot until next poll
        }
      }

      setRunningUi(Boolean(state.activeJobId));
      renderGlobalProgress();

      const isActive = Boolean(
        (batch && (batch.status === "running" || batch.status === "paused")) ||
          (job && job.status === "running") ||
          state.activeJobId
      );
      scheduleActivePoll(isActive ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
    } catch {
      const isActive = Boolean(isBatchActive() || state.activeJobId);
      scheduleActivePoll(isActive ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
    } finally {
      state.activePollInFlight = false;
      if (state.activePollQueued) {
        state.activePollQueued = false;
        triggerActivePollNow();
      }
    }
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer !== null) {
      clearInterval(state.elapsedTimer);
      state.elapsedTimer = null;
    }
  }

  function syncElapsedDisplay(job) {
    if (job && job.started_at) {
      const startMs = Date.parse(job.started_at);
      if (Number.isFinite(startMs)) {
        state.jobStartedAtMs = startMs;
      }
    }
    const baseStart = state.jobStartedAtMs || Date.now();
    if (job && job.finished_at) {
      const endMs = Date.parse(job.finished_at);
      if (Number.isFinite(endMs)) {
        els.statusElapsed.textContent = formatElapsed(endMs - baseStart);
        return;
      }
    }
    els.statusElapsed.textContent = formatElapsed(Date.now() - baseStart);
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    syncElapsedDisplay();
    state.elapsedTimer = setInterval(() => syncElapsedDisplay(), 1000);
  }

  function renderJobStatus(job) {
    els.statusPanel.hidden = false;
    const status = job.status || "running";
    const done = Number(job.done) || 0;
    const total = Number(job.total) || 0;
    const msg = job.message || "";
    const isCollectingLinks =
      status === "running" && done === 0 && total > 0 && /bağlantı bulundu/i.test(msg);

    els.statusBadge.textContent = STATUS_LABELS[status] || status;
    els.statusBadge.className = `status-badge is-${status}`;
    els.liveDot.className = `live-dot is-${status}`;
    els.progressRingCircle.className.baseVal = `progress-ring-fill is-${status}`;

    if (isCollectingLinks) {
      els.progressDone.textContent = total.toLocaleString("tr-TR");
      els.progressTotalLabel.textContent = "bulundu";
      els.progressTrack.classList.add("is-indeterminate");
      els.progressTrack.setAttribute("aria-valuenow", "0");
      els.progressRingCircle.style.strokeDashoffset = "";
      els.progressPercent.textContent = "Bağlantılar toplanıyor";
    } else if (status === "running" && total <= 0) {
      els.progressDone.textContent = done.toLocaleString("tr-TR");
      els.progressTotalLabel.textContent = done > 0 ? "işlendi" : "kayıt";
      els.progressTrack.classList.add("is-indeterminate");
      els.progressTrack.setAttribute("aria-valuenow", "0");
      els.progressRingCircle.style.strokeDashoffset = "";
      els.progressPercent.textContent =
        done > 0 ? `${done.toLocaleString("tr-TR")} işlendi` : "Hazırlanıyor";
    } else if (total > 0) {
      const effectiveTotal = Math.max(total, done);
      els.progressDone.textContent = done.toLocaleString("tr-TR");
      els.progressTotalLabel.textContent = `/ ${effectiveTotal.toLocaleString("tr-TR")}`;
      els.progressTrack.classList.remove("is-indeterminate");
      const ratio = Math.min(100, Math.round((done / effectiveTotal) * 100));
      els.progressTrack.setAttribute("aria-valuenow", String(ratio));
      const offset = RING_CIRCUMFERENCE * (1 - ratio / 100);
      els.progressRingCircle.style.strokeDashoffset = String(offset);
      els.progressPercent.textContent = `%${ratio}`;
    } else {
      els.progressDone.textContent = done.toLocaleString("tr-TR");
      els.progressTotalLabel.textContent = "kayıt";
      els.progressTrack.classList.remove("is-indeterminate");
      const ratio = status === "done" ? 100 : 0;
      els.progressTrack.setAttribute("aria-valuenow", String(ratio));
      const offset = RING_CIRCUMFERENCE * (1 - ratio / 100);
      els.progressRingCircle.style.strokeDashoffset = String(offset);
      els.progressPercent.textContent =
        status === "done"
          ? "%100"
          : done > 0
            ? `${done.toLocaleString("tr-TR")} kayıt`
            : "—";
    }

    syncElapsedDisplay(job);
    if (status === "running") {
      if (state.elapsedTimer === null) startElapsedTimer();
    } else {
      stopElapsedTimer();
    }

    els.statusMessage.textContent = job.message || "";

    if (status === "captcha") {
      els.statusGuidance.className = "alert alert-captcha";
      els.statusGuidance.textContent =
        "Google Maps doğrulama (CAPTCHA) istedi. 'Arka planda çalıştır (headless)' anahtarını kapatıp birkaç dakika bekledikten sonra tekrar deneyin; görünür pencerede doğrulamayı geçebilirsiniz.";
      els.statusGuidance.hidden = false;
    } else if (status === "error") {
      els.statusGuidance.className = "alert alert-error";
      els.statusGuidance.textContent =
        "Tarama hata nedeniyle durdu. Bölge veya kategori seçimini kontrol edip tekrar başlatabilirsiniz.";
      els.statusGuidance.hidden = false;
    } else {
      els.statusGuidance.hidden = true;
      els.statusGuidance.textContent = "";
    }
    syncAllControlButtons();
  }

  function renderBatchStatusPanel(batch) {
    if (!batch) return;
    els.statusPanel.hidden = false;
    const status = batch.status || "running";
    const completedItems = Math.max(0, Number(batch.completed_items) || 0);
    const totalItems = Math.max(0, Number(batch.total_items) || 0);
    const totalSaved = Math.max(0, Number(batch.total_saved) || 0);

    els.statusBadge.textContent = STATUS_LABELS[status] || status;
    els.statusBadge.className = `status-badge is-${status}`;
    els.liveDot.className = `live-dot is-${status}`;
    els.progressRingCircle.className.baseVal = `progress-ring-fill is-${status}`;

    els.progressDone.textContent = completedItems.toLocaleString("tr-TR");
    els.progressTotalLabel.textContent = `/ ${totalItems.toLocaleString("tr-TR")}`;
    els.progressTrack.classList.remove("is-indeterminate");
    const ratio =
      status === "done"
        ? 100
        : totalItems > 0
          ? Math.min(100, Math.round((completedItems / totalItems) * 100))
          : 0;
    els.progressTrack.setAttribute("aria-valuenow", String(ratio));
    const offset = RING_CIRCUMFERENCE * (1 - ratio / 100);
    els.progressRingCircle.style.strokeDashoffset = String(offset);
    els.progressPercent.textContent =
      status === "paused"
        ? "Duraklatıldı"
        : `%${ratio} · ${totalSaved.toLocaleString("tr-TR")} kayıt`;

    syncElapsedDisplay(batch);
    if (status === "running") {
      if (state.elapsedTimer === null) startElapsedTimer();
    } else {
      stopElapsedTimer();
    }

    if (status === "paused") {
      els.statusMessage.textContent = `Duraklatıldı · ${completedItems.toLocaleString("tr-TR")} / ${totalItems.toLocaleString("tr-TR")} arama · Toplam ${totalSaved.toLocaleString("tr-TR")} kayıt · ${clampWorkersCount(batch.workers)} tarayıcı`;
    } else {
      const prefix = batch.label ? `${batch.label}: ` : "";
      els.statusMessage.textContent = `${prefix}${batch.message || buildBatchSummaryText(batch)}`;
    }

    if (status === "captcha") {
      els.statusGuidance.className = "alert alert-captcha";
      els.statusGuidance.textContent =
        "Google Maps doğrulama (CAPTCHA) istedi. 'Arka planda çalıştır (headless)' anahtarını kapatıp tekrar deneyin.";
      els.statusGuidance.hidden = false;
    } else if (status === "error") {
      els.statusGuidance.className = "alert alert-error";
      els.statusGuidance.textContent =
        batch.message || "Toplu tarama hata nedeniyle durdu.";
      els.statusGuidance.hidden = false;
    } else {
      els.statusGuidance.hidden = true;
      els.statusGuidance.textContent = "";
    }
    syncAllControlButtons();
  }

  function stopPolling() {
    if (state.pollTimer !== null) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function scheduleNextPoll(jobId) {
    stopPolling();
    state.pollTimer = setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS);
  }

  async function pollJob(jobId) {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (response.status === 404) {
        stopPolling();
        stopElapsedTimer();
        state.activeJobId = null;
        state.pollFailures = 0;
        safeStorageRemove(sessionStorage, ACTIVE_JOB_STORAGE_KEY);
        if (state.trackedGlobalJob && state.trackedGlobalJob.job_id === jobId) {
          state.trackedGlobalJob = null;
          renderGlobalProgress();
        }
        setRunningUi(false);
        return;
      }
      if (!response.ok) {
        throw new Error(`Durum alınamadı (${response.status})`);
      }

      state.pollFailures = 0;
      const job = await response.json();
      renderJobStatus(job);
      state.trackedGlobalJob = job;
      renderGlobalProgress();

      const done = Number(job.done) || 0;
      const doneChanged = done !== state.lastObservedDone;
      state.lastObservedDone = done;

      if (job.status === "running") {
        state.lastJobStatus = "running";
        setRunningUi(true);
        if (doneChanged && done > 0) {
          loadBusinesses({ silent: true });
          loadSearches();
        }
        scheduleNextPoll(jobId);
      } else {
        stopPolling();
        stopElapsedTimer();
        state.activeJobId = null;
        safeStorageRemove(sessionStorage, ACTIVE_JOB_STORAGE_KEY);
        setRunningUi(false);

        if (state.lastJobStatus === "running") {
          if (job.status === "done") {
            showToast(job.message || "Tarama tamamlandı.", "success");
          } else if (job.status === "captcha") {
            showToast("CAPTCHA algılandı. Headless modunu kapatıp tekrar deneyin.", "warning");
          } else if (job.status === "cancelled") {
            showToast(job.message || "Tarama iptal edildi.", "info");
          } else if (job.status === "error") {
            showToast(job.message || "Tarama sırasında hata oluştu.", "error");
          }
        }
        state.lastJobStatus = job.status;
        renderGlobalProgress();
        await Promise.all([loadBusinesses({ silent: true }), loadSearches()]);
        scheduleActivePoll(isBatchActive() ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
      }
    } catch {
      state.pollFailures += 1;
      if (state.activeJobId === jobId && state.pollFailures < MAX_POLL_FAILURES) {
        scheduleNextPoll(jobId);
      } else {
        stopPolling();
        stopElapsedTimer();
        state.activeJobId = null;
        safeStorageRemove(sessionStorage, ACTIVE_JOB_STORAGE_KEY);
        setRunningUi(false);
        const errorJob = {
          job_id: jobId,
          region: state.trackedGlobalJob ? state.trackedGlobalJob.region : "",
          category: state.trackedGlobalJob ? state.trackedGlobalJob.category : "",
          status: "error",
          done: Math.max(0, state.lastObservedDone),
          total: 0,
          message: "Sunucu ile bağlantı kesildi; tarama durumu alınamıyor.",
        };
        renderJobStatus(errorJob);
        if (state.trackedGlobalJob && state.trackedGlobalJob.job_id === jobId) {
          state.trackedGlobalJob = errorJob;
          renderGlobalProgress();
        }
        showToast("Sunucu ile bağlantı kesildi.", "error");
      }
    }
  }

  async function submitSingleScan(maxResultsPayload, headless, workers) {
    const region = getSelectedApiRegion();
    const category = state.selectedCategory ? state.selectedCategory.value : null;

    if (!region) {
      showFormError("Lütfen listeden bir il (ve isteğe bağlı ilçe) seçin.");
      els.ilInput.focus();
      return;
    }
    if (!category) {
      showFormError("Lütfen listeden bir işletme türü seçin.");
      els.categoryInput.focus();
      return;
    }

    setRunningUi(true);

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region,
          category,
          max_results: maxResultsPayload,
          headless,
          workers,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRunningUi(false);
        showFormError(extractApiError(body, `Tarama başlatılamadı (${response.status}).`));
        return;
      }

      const jobId = body.job_id;
      state.activeJobId = jobId;
      state.pollFailures = 0;
      state.lastObservedDone = -1;
      state.lastJobStatus = "running";
      state.jobStartedAtMs = Date.now();
      safeStorageSet(sessionStorage, ACTIVE_JOB_STORAGE_KEY, jobId);

      setSearchFilter(region, category);

      const initialJobSnapshot = {
        job_id: jobId,
        region,
        category,
        workers,
        status: "running",
        done: 0,
        total: 0,
        message: `'${region}' için '${category}' taraması başlatılıyor...`,
      };
      state.trackedGlobalJob = initialJobSnapshot;
      state.formCancelConfirming = false;
      state.statusCancelConfirming = false;
      state.gpCancelConfirming = false;
      renderJobStatus(initialJobSnapshot);
      renderGlobalProgress();
      showToast(`Tarama başlatıldı: ${region} · ${category}`, "info");

      pollJob(jobId);
      scheduleActivePoll(ACTIVE_POLL_INTERVAL_MS);
    } catch (err) {
      setRunningUi(false);
      showFormError(`Sunucuya bağlanılamadı: ${err.message}`);
    }
  }

  async function submitBatchScan(maxResultsPayload, headless, workers) {
    if (!state.batchIl) {
      showFormError("Lütfen listeden bir il seçin.");
      els.batchIlInput.focus();
      return;
    }

    const regions = [];
    if (state.batchIlGeneli) {
      regions.push(state.batchIl);
    }
    for (const ilce of getOrderedBatchIlces()) {
      regions.push(`${ilce}, ${state.batchIl}`);
    }
    if (!regions.length) {
      showFormError("Lütfen en az bir ilçe veya 'İl geneli' seçin.");
      els.batchIlceSelectBtn.focus();
      return;
    }

    const categories = getOrderedBatchCategories();
    if (!categories.length) {
      showFormError("Lütfen en az bir işletme türü seçin.");
      els.batchCatSelectBtn.focus();
      return;
    }

    const items = [];
    for (const region of regions) {
      for (const cat of categories) {
        items.push({ region, category: cat });
      }
    }

    if (items.length > BATCH_MAX_ITEMS_LIMIT) {
      showFormError(
        `Tek toplu taramada en fazla ${BATCH_MAX_ITEMS_LIMIT} arama başlatılabilir (seçilen: ${items.length.toLocaleString("tr-TR")}).`
      );
      return;
    }

    const label = `${state.batchIl} · ${categories.length} tür`;
    state.batchSubmitPending = true;
    setRunningUi(Boolean(state.activeJobId));

    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          max_results: maxResultsPayload,
          headless,
          workers,
          label,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errMsg = extractApiError(body, `Toplu tarama başlatılamadı (${response.status}).`);
        if (response.status === 409) {
          showToast(errMsg, "warning");
        }
        showFormError(errMsg);
        return;
      }

      const batchId = body.batch_id;
      if (state.dismissedBatchId) {
        state.dismissedBatchId = null;
        safeStorageRemove(sessionStorage, DISMISSED_BATCH_STORAGE_KEY);
      }
      state.formCancelConfirming = false;
      state.statusCancelConfirming = false;
      state.gpCancelConfirming = false;

      if (batchId) {
        try {
          const batchResp = await fetch(`/api/batches/${encodeURIComponent(batchId)}`);
          if (batchResp.ok) {
            const createdBatch = await batchResp.json();
            state.activeBatch = createdBatch;
            state.lastBatchId = createdBatch.batch_id;
            state.lastBatchStatus = createdBatch.status;
            state.lastBatchCompletedItems = Number(createdBatch.completed_items) || 0;
            state.lastBatchTotalSaved = Number(createdBatch.total_saved) || 0;
            renderBatchStatusPanel(createdBatch);
            renderGlobalProgress();
          }
        } catch {
          // Will synchronize via immediate poll below
        }
      }

      showToast(
        `Toplu tarama başlatıldı: ${label} (${items.length.toLocaleString("tr-TR")} arama)`,
        "info"
      );
      triggerActivePollNow();
    } catch (err) {
      showFormError(`Sunucuya bağlanılamadı: ${err.message}`);
    } finally {
      state.batchSubmitPending = false;
      setRunningUi(Boolean(state.activeJobId));
    }
  }

  async function handleStartSubmit(event) {
    event.preventDefault();
    showFormError("");

    let maxResultsPayload = null;
    if (!state.maxResultsUnlimited) {
      const rawMax = String(els.maxResultsInput.value).trim();
      const parsed = /^\d+$/.test(rawMax) ? Number.parseInt(rawMax, 10) : NaN;
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) {
        showFormError("Maksimum sonuç sayısı 1 ile 1000 arasında olmalıdır.");
        els.maxResultsInput.focus();
        return;
      }
      maxResultsPayload = parsed;
    }

    const headless = els.headlessInput.checked;
    const workers = clampWorkersCount(state.savedWorkers);

    if (state.scanMode === "batch") {
      await submitBatchScan(maxResultsPayload, headless, workers);
    } else {
      await submitSingleScan(maxResultsPayload, headless, workers);
    }
  }

  function handleFormCancelRequest() {
    if (!state.activeJobId) return;
    state.formCancelConfirming = true;
    syncAllControlButtons();
  }

  function handleFormCancelConfirmYes() {
    if (!state.activeJobId) {
      state.formCancelConfirming = false;
      syncAllControlButtons();
      return;
    }
    performSingleJobCancel(state.activeJobId);
  }

  function handleFormCancelConfirmNo() {
    state.formCancelConfirming = false;
    syncAllControlButtons();
  }

  function handleStatusPauseClick() {
    if (!isBatchRunning()) return;
    performBatchPause(state.activeBatch.batch_id);
  }

  function handleStatusResumeClick() {
    if (!state.activeBatch || state.activeBatch.status !== "paused") return;
    performBatchResume(state.activeBatch.batch_id);
  }

  function handleStatusCancelRequest() {
    if (!state.activeJobId && !isBatchActive()) return;
    state.statusCancelConfirming = true;
    syncAllControlButtons();
  }

  function handleStatusCancelConfirmYes() {
    if (state.activeJobId) {
      performSingleJobCancel(state.activeJobId);
      return;
    }
    if (isBatchActive()) {
      performBatchCancel(state.activeBatch.batch_id);
      return;
    }
    state.statusCancelConfirming = false;
    syncAllControlButtons();
  }

  function handleStatusCancelConfirmNo() {
    state.statusCancelConfirming = false;
    syncAllControlButtons();
  }

  function extractDownloadFilename(headerValue) {
    if (!headerValue) return "isletmeler.xlsx";
    const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
    if (utfMatch && utfMatch[1]) {
      try {
        return decodeURIComponent(utfMatch[1]);
      } catch {
        // Fallback below
      }
    }
    const plainMatch = /filename="?([^";]+)"?/i.exec(headerValue);
    if (plainMatch && plainMatch[1]) {
      return plainMatch[1];
    }
    return "isletmeler.xlsx";
  }

  async function handleExportClick() {
    showTableError("");
    const filteredRows = getFilteredAndSortedBusinesses();
    if (!filteredRows.length) {
      showToast("Dışa aktarılacak işletme bulunamadı.", "warning");
      return;
    }

    const ids = filteredRows.map((b) => b.place_id).filter(Boolean);
    const labelSpan = els.exportBtn.querySelector("span");
    const originalText = labelSpan ? labelSpan.textContent : "Excel İndir";

    els.exportBtn.disabled = true;
    if (labelSpan) labelSpan.textContent = "Hazırlanıyor...";

    try {
      let response;
      if (ids.length > 0) {
        response = await fetch("/api/export.xlsx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids,
            region: state.filterRegion,
            category: state.filterCategory,
          }),
        });
      } else {
        const params = buildScopeQueryParams();
        const qs = params.toString();
        response = await fetch(qs ? `/api/export.xlsx?${qs}` : "/api/export.xlsx");
      }

      if (!response.ok) {
        throw new Error(`Dışa aktarım başarısız (${response.status})`);
      }

      const blob = await response.blob();
      const filename = extractDownloadFilename(response.headers.get("Content-Disposition"));
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      showToast(
        `${filteredRows.length.toLocaleString("tr-TR")} kayıt Excel olarak indirildi.`,
        "success"
      );
    } catch (err) {
      showTableError(`Excel dosyası indirilemedi: ${err.message}`);
      showToast("Excel indirme başarısız.", "error");
    } finally {
      els.exportBtn.disabled = false;
      if (labelSpan) labelSpan.textContent = originalText;
      renderResults({ skipFitBounds: true });
    }
  }

  function syncMaxResultsMode(unlimited) {
    state.maxResultsUnlimited = Boolean(unlimited);
    if (state.maxResultsUnlimited) {
      els.maxResultsInput.value = "";
      els.maxResultsInput.disabled = true;
      els.maxResultsInput.required = false;
      els.maxResultsInput.placeholder = "Hepsi";
      if (els.maxResultsMeta) els.maxResultsMeta.textContent = "Liste sonuna kadar";
    } else {
      els.maxResultsInput.disabled = Boolean(
        state.activeJobId || isBatchActive() || state.batchSubmitPending
      );
      els.maxResultsInput.required = true;
      els.maxResultsInput.placeholder = "1–1000";
      if (els.maxResultsMeta) els.maxResultsMeta.textContent = "1–1000";
    }
    syncPresetPills();
  }

  function syncPresetPills() {
    const val = state.maxResultsUnlimited ? "all" : String(els.maxResultsInput.value).trim();
    for (const pill of els.presetPills) {
      pill.classList.toggle("is-active", pill.dataset.max === val);
    }
  }

  function bindEvents() {
    els.gpHeader.addEventListener("click", (event) => {
      if (event.target.closest("button, a, .inline-confirm")) return;
      toggleGlobalProgressDetails();
    });
    els.gpToggleBtn.addEventListener("click", toggleGlobalProgressDetails);
    els.gpPauseBtn.addEventListener("click", handleGlobalPauseClick);
    els.gpResumeBtn.addEventListener("click", handleGlobalResumeClick);
    els.gpCancelBtn.addEventListener("click", handleGlobalCancelRequest);
    els.gpConfirmYes.addEventListener("click", handleGlobalCancelConfirmYes);
    els.gpConfirmNo.addEventListener("click", handleGlobalCancelConfirmNo);
    els.gpDismissBtn.addEventListener("click", handleGlobalDismissClick);

    for (const btn of els.modeToggleBtns) {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        applyScanMode(btn.dataset.mode, true);
      });
    }
    els.batchIlceAllBtn.addEventListener("click", () => toggleBatchAllIlces());
    els.batchIlceSelectBtn.addEventListener("click", openBatchIlcePopover);
    els.batchCatSelectBtn.addEventListener("click", openBatchCatPopover);

    els.form.addEventListener("submit", handleStartSubmit);
    els.cancelBtn.addEventListener("click", handleFormCancelRequest);
    els.formConfirmYes.addEventListener("click", handleFormCancelConfirmYes);
    els.formConfirmNo.addEventListener("click", handleFormCancelConfirmNo);

    els.statusPauseBtn.addEventListener("click", handleStatusPauseClick);
    els.statusResumeBtn.addEventListener("click", handleStatusResumeClick);
    els.statusCancelBtn.addEventListener("click", handleStatusCancelRequest);
    els.statusConfirmYes.addEventListener("click", handleStatusCancelConfirmYes);
    els.statusConfirmNo.addEventListener("click", handleStatusCancelConfirmNo);

    els.exportBtn.addEventListener("click", handleExportClick);

    els.clearFilterBtn.addEventListener("click", () => setSearchFilter(null, null));
    els.showAllBtn.addEventListener("click", () => setSearchFilter(null, null));

    for (const pill of els.presetPills) {
      pill.addEventListener("click", () => {
        if (pill.dataset.max === "all") {
          syncMaxResultsMode(true);
        } else {
          syncMaxResultsMode(false);
          els.maxResultsInput.value = pill.dataset.max;
          syncPresetPills();
        }
      });
    }
    for (const pill of els.workerPills) {
      pill.addEventListener("click", () => {
        if (pill.disabled) return;
        applyWorkersSelection(pill.dataset.workers, true);
      });
    }
    els.maxResultsInput.addEventListener("input", () => {
      if (state.maxResultsUnlimited) {
        syncMaxResultsMode(false);
      } else {
        syncPresetPills();
      }
    });

    for (const btn of els.viewButtons) {
      btn.addEventListener("click", () => {
        setViewMode(btn.dataset.view);
      });
    }

    els.mobileFiltersToggle.addEventListener("click", () => {
      const open = els.detailedFiltersGrid.classList.toggle("is-open-mobile");
      els.mobileFiltersToggle.setAttribute("aria-expanded", String(open));
    });

    els.filterText.addEventListener("input", () => {
      state.filters.text = els.filterText.value;
      state.currentPage = 1;
      renderResults();
    });

    els.filterIl.addEventListener("change", () => {
      state.filters.il = els.filterIl.value;
      state.filters.ilce = "";
      populateFilterIlceOptions();
      state.currentPage = 1;
      renderResults();
    });

    els.filterIlce.addEventListener("change", () => {
      state.filters.ilce = els.filterIlce.value;
      state.currentPage = 1;
      renderResults();
    });

    els.filterSearchCat.addEventListener("change", () => {
      state.filters.searchCategory = els.filterSearchCat.value;
      state.currentPage = 1;
      renderResults();
    });

    els.filterMapsCatBtn.addEventListener("click", openMapsCategoryPopover);

    els.filterSort.addEventListener("change", () => {
      state.filters.sortBy = els.filterSort.value;
      state.currentPage = 1;
      renderResults();
    });

    els.filterMinRating.addEventListener("input", () => {
      const val = Number.parseFloat(els.filterMinRating.value) || 0;
      state.filters.minRating = val;
      els.filterMinRatingVal.textContent =
        val > 0
          ? `${val.toLocaleString("tr-TR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}+`
          : "Tümü";
      state.currentPage = 1;
      renderResults();
    });

    els.filterMinReviews.addEventListener("input", () => {
      const parsed = Number.parseInt(els.filterMinReviews.value, 10);
      state.filters.minReviews = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      state.currentPage = 1;
      renderResults();
    });

    els.filterNoPhone.addEventListener("change", () => {
      state.filters.noPhone = els.filterNoPhone.checked;
      state.currentPage = 1;
      renderResults();
    });

    els.filterNoWebsite.addEventListener("change", () => {
      state.filters.noWebsite = els.filterNoWebsite.checked;
      state.currentPage = 1;
      renderResults();
    });

    els.filterHasHours.addEventListener("change", () => {
      state.filters.hasHours = els.filterHasHours.checked;
      state.currentPage = 1;
      renderResults();
    });

    for (const btn of els.filterDurumPills) {
      btn.addEventListener("click", () => {
        const key = btn.dataset.durum || "";
        if (!key) {
          state.filters.statuses.clear();
        } else if (state.filters.statuses.has(key)) {
          state.filters.statuses.delete(key);
        } else {
          state.filters.statuses.add(key);
          if (state.filters.statuses.size === DURUM_ORDER.length) {
            state.filters.statuses.clear();
          }
        }
        syncStatusFilterPills();
        state.currentPage = 1;
        renderResults();
      });
    }

    els.clearAllFiltersBtn.addEventListener("click", clearAllClientFilters);
    els.emptyResetBtn.addEventListener("click", clearAllClientFilters);

    window.addEventListener("hashchange", handleHashChange);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (state.gpCancelConfirming || state.formCancelConfirming || state.statusCancelConfirming) {
        state.gpCancelConfirming = false;
        state.formCancelConfirming = false;
        state.statusCancelConfirming = false;
        syncAllControlButtons();
        event.preventDefault();
        return;
      }
      if (state.detailPlaceId !== null) {
        if (state.activePopupCleanup) return;
        event.preventDefault();
        navigateBackToList();
      }
    });
  }

  async function init() {
    state.dismissedBatchId = safeStorageGet(sessionStorage, DISMISSED_BATCH_STORAGE_KEY);
    state.dismissedJobId = safeStorageGet(sessionStorage, DISMISSED_JOB_STORAGE_KEY);

    initTheme();
    initScanMode();
    initWorkersSelector();
    initComboboxes();
    bindEvents();
    updateFilterScopeDisplay();
    updateQueryPreview();
    syncBatchIlceUi();
    syncBatchCategoryUi();
    updateBatchSummary();
    syncPresetPills();

    const initialDetailId = parseDetailHash(window.location.hash);
    if (initialDetailId !== null) {
      state.isLoadingBusinesses = true;
      openDetailRoute(initialDetailId);
    }

    pollActive();
    await loadReferenceData();
    await Promise.all([loadBusinesses(), loadSearches()]);

    const savedJobId = safeStorageGet(sessionStorage, ACTIVE_JOB_STORAGE_KEY);
    if (savedJobId && state.activeJobId !== savedJobId) {
      state.activeJobId = savedJobId;
      state.lastJobStatus = "running";
      pollJob(savedJobId);
    }
  }

  init();
})();

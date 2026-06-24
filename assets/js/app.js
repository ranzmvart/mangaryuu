(() => {
  "use strict";

  const IS_LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname) || location.protocol === "file:";
  const API = IS_LOCAL ? "https://api.mangadex.org" : "/api/mangadex";
  const RAW_COVER_BASE = "https://uploads.mangadex.org/covers";
  const DEFAULT_LANG = "en";
  const APP_VERSION = "2.0-stable-reader";

  function proxiedImage(url) {
    if (!url || url.startsWith("data:")) return url;
    // Langsung ke Netlify Function agar tidak bergantung pada redirect /api/image.
    return IS_LOCAL ? url : `/.netlify/functions/image?url=${encodeURIComponent(url)}`;
  }

  function imageTag(url, alt = "Gambar", loading = "lazy", className = "") {
    const safeUrl = url || PLACEHOLDER;
    const fallback = proxiedImage(safeUrl);
    const cls = className ? ` class="${escapeHTML(className)}"` : "";
    return `<img${cls} src="${escapeHTML(safeUrl)}" data-fallback-src="${escapeHTML(fallback)}" alt="${escapeHTML(alt)}" loading="${loading}" decoding="async" />`;
  }
  const PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#312e81"/>
          <stop offset="1" stop-color="#0f172a"/>
        </linearGradient>
      </defs>
      <rect width="400" height="600" fill="url(#g)"/>
      <text x="200" y="292" fill="#e5e7eb" font-size="34" font-family="Arial" text-anchor="middle" font-weight="700">No Cover</text>
      <text x="200" y="330" fill="#94a3b8" font-size="18" font-family="Arial" text-anchor="middle">Ryuu Reader</text>
    </svg>`);

  const state = {
    currentManga: null,
    chapters: [],
    pageMode: false,
    pageIndex: 0,
    currentPages: [],
    currentReader: null,
    quality: localStorage.getItem("ryuu_quality") || "dataSaver",
    readerWidth: Number(localStorage.getItem("ryuu_reader_width") || 980),
  };

  const els = {
    view: document.getElementById("appView"),
    navItems: [...document.querySelectorAll(".nav-item")],
    globalSearchForm: document.getElementById("globalSearchForm"),
    globalSearchInput: document.getElementById("globalSearchInput"),
    languageSelect: document.getElementById("languageSelect"),
    themeToggle: document.getElementById("themeToggle"),
    menuBtn: document.getElementById("menuBtn"),
    sidebar: document.getElementById("sidebar"),
    toast: document.getElementById("toast"),
    cardTemplate: document.getElementById("mangaCardTemplate"),
  };

  const store = {
    get(key, fallback) {
      try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  function escapeHTML(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function titleOf(manga) {
    const title = manga?.attributes?.title || {};
    return title.en || title.id || Object.values(title)[0] || "Tanpa Judul";
  }

  function descriptionOf(manga) {
    const desc = manga?.attributes?.description || {};
    return desc.id || desc.en || Object.values(desc)[0] || "Tidak ada deskripsi.";
  }

  function relationshipOf(item, type) {
    return item?.relationships?.find((rel) => rel.type === type);
  }

  function coverOf(manga, size = "512") {
    const cover = relationshipOf(manga, "cover_art");
    const file = cover?.attributes?.fileName;
    if (!file) return PLACEHOLDER;
    return `${RAW_COVER_BASE}/${manga.id}/${file}.${size}.jpg`;
  }

  function mangaFromChapter(chapter) {
    return relationshipOf(chapter, "manga");
  }

  function getLangs() {
    const value = els.languageSelect.value;
    localStorage.setItem("ryuu_lang", value);
    if (value === "all") return [];
    return value.split(",").filter(Boolean);
  }

  function languageParams() {
    const langs = getLangs();
    if (!langs.length) return "";
    return langs.map((lang) => `translatedLanguage[]=${encodeURIComponent(lang)}`).join("&");
  }

  function availableLanguageParams() {
    const langs = getLangs();
    if (!langs.length) return "";
    return langs.map((lang) => `availableTranslatedLanguage[]=${encodeURIComponent(lang)}`).join("&");
  }

  function contentRatingParams() {
    return "contentRating[]=safe&contentRating[]=suggestive";
  }

  async function api(path, params = "") {
    const glue = path.includes("?") ? "&" : "?";
    const url = `${API}${path}${params ? glue + params : ""}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MangaDex API error ${res.status}: ${text || res.statusText}`);
    }

    return res.json();
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function setActiveNav(route) {
    els.navItems.forEach((btn) => {
      const target = btn.dataset.route;
      btn.classList.toggle("is-active", route.startsWith(target));
    });
  }

  function navigate(hash) {
    window.location.hash = hash;
    els.sidebar.classList.remove("open");
  }

  function setLoading(text = "Memuat data...") {
    els.view.innerHTML = `<div class="loader"><div>${escapeHTML(text)}</div></div>`;
  }

  function setError(title, message) {
    els.view.innerHTML = `
      <div class="error-state">
        <div>
          <h2>${escapeHTML(title)}</h2>
          <p>${escapeHTML(message)}</p>
          <button class="primary-btn" data-action="home">Kembali ke Beranda</button>
        </div>
      </div>`;
  }

  function renderSectionHead(title, subtitle = "") {
    return `
      <div class="section-head">
        <div>
          <h2>${escapeHTML(title)}</h2>
          ${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ""}
        </div>
      </div>`;
  }

  function makeMangaCard(manga) {
    const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
    const title = titleOf(manga);
    const type = manga.attributes?.publicationDemographic || manga.attributes?.contentRating || "manga";
    const coverUrl = coverOf(manga, "256");
    const cardImg = node.querySelector("img");
    cardImg.src = coverUrl;
    cardImg.dataset.fallbackSrc = proxiedImage(coverUrl);
    cardImg.alt = title;
    node.querySelector("h3").textContent = title;
    node.querySelector(".meta").textContent = [manga.attributes?.status, manga.attributes?.year].filter(Boolean).join(" • ") || "MangaDex";
    node.querySelector(".desc").textContent = descriptionOf(manga);
    node.querySelector(".type-badge").textContent = type;
    node.addEventListener("click", () => navigate(`#/manga/${manga.id}`));
    return node;
  }

  function renderGrid(mangas, targetId = "mangaGrid") {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = "";

    if (!mangas.length) {
      target.innerHTML = `<div class="empty-state"><p>Tidak ada data yang bisa ditampilkan.</p></div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    mangas.forEach((manga) => frag.appendChild(makeMangaCard(manga)));
    target.appendChild(frag);
  }

  async function renderHome() {
    setActiveNav("#/home");
    setLoading("Menyiapkan halaman beranda...");

    try {
      const availableLang = availableLanguageParams();
      const [popular, latest] = await Promise.all([
        api("/manga", `limit=18&includes[]=cover_art&order[followedCount]=desc&${contentRatingParams()}&hasAvailableChapters=true${availableLang ? "&" + availableLang : ""}`),
        api("/manga", `limit=18&includes[]=cover_art&order[latestUploadedChapter]=desc&${contentRatingParams()}&hasAvailableChapters=true${availableLang ? "&" + availableLang : ""}`),
      ]);

      const favorites = store.get("ryuu_favorites", []);
      const history = store.get("ryuu_history", []);

      els.view.innerHTML = `
        <section class="hero">
          <div class="hero-card">
            <span class="pill">Siap Deploy • Netlify Static</span>
            <h2>Baca manga/manhwa langsung di website kamu.</h2>
            <p>Pencarian, detail manga, daftar chapter, mode scroll, mode halaman, bookmark, dan riwayat baca. Versi ini memakai proxy Netlify Functions supaya akses API lebih stabil setelah deploy.</p>
            <div class="hero-actions">
              <button class="primary-btn" data-action="focus-search">Mulai Cari</button>
              <button class="secondary-btn" data-route="#/library">Buka Koleksi</button>
              <button class="ghost-btn" data-route="#/about">Baca Catatan Legal</button>
            </div>
          </div>
          <div class="stat-grid">
            <div class="stat-card"><strong>${popular.data.length}</strong><span>Rekomendasi populer dimuat</span></div>
            <div class="stat-card"><strong>${favorites.length}</strong><span>Favorit di browser ini</span></div>
            <div class="stat-card"><strong>${history.length}</strong><span>Riwayat baca lokal</span></div>
          </div>
        </section>

        ${renderSectionHead("Populer di MangaDex", "Diurutkan berdasarkan jumlah follower di MangaDex.")}
        <div class="grid" id="popularGrid"></div>

        ${renderSectionHead("Update Terbaru", "Judul dengan chapter terbaru.")}
        <div class="grid" id="latestGrid"></div>
      `;

      renderGrid(popular.data, "popularGrid");
      renderGrid(latest.data, "latestGrid");
    } catch (error) {
      console.error(error);
      renderHomeFallback(error);
    }
  }

  function renderHomeFallback(error) {
    console.warn("Home API fallback:", error);
    const favorites = store.get("ryuu_favorites", []);
    const history = store.get("ryuu_history", []);

    els.view.innerHTML = `
      <section class="hero">
        <div class="hero-card">
          <span class="pill">Online • Netlify Proxy</span>
          <h2>Ryuu Reader sudah online.</h2>
          <p>Beranda tidak berhasil mengambil daftar populer otomatis, tetapi fitur pencarian tetap bisa digunakan. Coba cari judul seperti One Piece, Naruto, Jujutsu Kaisen, atau Solo Leveling.</p>
          <div class="hero-actions">
            <button class="primary-btn" data-action="focus-search">Cari Manga Sekarang</button>
            <button class="secondary-btn" data-route="#/search">Buka Halaman Cari</button>
            <button class="ghost-btn" data-route="#/about">Catatan Legal</button>
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat-card"><strong>${favorites.length}</strong><span>Favorit lokal</span></div>
          <div class="stat-card"><strong>${history.length}</strong><span>Riwayat lokal</span></div>
          <div class="stat-card"><strong>Proxy</strong><span>API via Netlify Functions</span></div>
        </div>
      </section>

      ${renderSectionHead("Mulai dari Pencarian", "Ketik judul di kolom pencarian atas. Jika tetap gagal, buka Netlify → Functions/Logs untuk melihat error proxy.")}
      <div class="quick-grid">
        <button class="quick-card" data-search="One Piece">One Piece</button>
        <button class="quick-card" data-search="Naruto">Naruto</button>
        <button class="quick-card" data-search="Jujutsu Kaisen">Jujutsu Kaisen</button>
        <button class="quick-card" data-search="Solo Leveling">Solo Leveling</button>
        <button class="quick-card" data-search="Chainsaw Man">Chainsaw Man</button>
        <button class="quick-card" data-search="Berserk">Berserk</button>
      </div>
    `;
  }

  function renderSearch(query = "") {
    setActiveNav("#/search");
    els.view.innerHTML = `
      <div class="page-title">
        <span class="pill">Pencarian</span>
        <h2>Cari Manga / Manhwa</h2>
        <p>Masukkan judul lalu pilih hasil untuk membuka detail dan chapter. Filter bahasa chapter ada di kanan atas.</p>
      </div>
      <form class="filters" id="searchPageForm">
        <input id="searchPageInput" type="search" value="${escapeHTML(query)}" placeholder="Contoh: Jujutsu Kaisen" />
        <select id="typeFilter">
          <option value="">Semua tipe</option>
          <option value="manga">Manga</option>
          <option value="manhwa">Manhwa</option>
          <option value="manhua">Manhua</option>
        </select>
        <select id="statusFilter">
          <option value="">Semua status</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
          <option value="hiatus">Hiatus</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button class="primary-btn" type="submit">Cari</button>
      </form>
      <div class="grid" id="mangaGrid"></div>
    `;

    document.getElementById("searchPageForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = document.getElementById("searchPageInput").value.trim();
      searchManga(value);
    });

    if (query) searchManga(query);
  }

  async function searchManga(query) {
    if (!query) {
      showToast("Masukkan judul manga dulu.");
      return;
    }

    const grid = document.getElementById("mangaGrid");
    if (grid) grid.innerHTML = `<div class="loader"><div>Mencari “${escapeHTML(query)}”...</div></div>`;

    try {
      const type = document.getElementById("typeFilter")?.value || "";
      const status = document.getElementById("statusFilter")?.value || "";
      const params = [
        `title=${encodeURIComponent(query)}`,
        "limit=48",
        "includes[]=cover_art",
        "hasAvailableChapters=true",
        "order[relevance]=desc",
        contentRatingParams(),
      ];
      const availableLang = availableLanguageParams();
      if (availableLang) params.push(availableLang);
      if (type) params.push(`originalLanguage[]=${type === "manhwa" ? "ko" : type === "manhua" ? "zh" : "ja"}`);
      if (status) params.push(`status[]=${encodeURIComponent(status)}`);

      const result = await api("/manga", params.join("&"));
      renderGrid(result.data);
    } catch (error) {
      console.error(error);
      if (grid) grid.innerHTML = `<div class="error-state"><p>Gagal mencari manga. Coba lagi sebentar.</p></div>`;
    }
  }

  async function renderMangaDetail(id) {
    setActiveNav("#/search");
    setLoading("Mengambil detail manga...");

    try {
      const result = await api(`/manga/${id}`, "includes[]=cover_art&includes[]=author&includes[]=artist");
      const manga = result.data;
      state.currentManga = manga;
      const title = titleOf(manga);
      const desc = descriptionOf(manga);
      const favs = store.get("ryuu_favorites", []);
      const isFav = favs.some((item) => item.id === manga.id);
      const tags = (manga.attributes?.tags || [])
        .slice(0, 18)
        .map((tag) => tag.attributes?.name?.en || tag.attributes?.name?.id)
        .filter(Boolean);

      els.view.innerHTML = `
        <section class="detail-grid">
          <div class="detail-cover">
            ${imageTag(coverOf(manga, "512"), title, "lazy")}
          </div>
          <div class="panel detail-info">
            <span class="pill">${escapeHTML(manga.attributes?.status || "MangaDex")}</span>
            <h2>${escapeHTML(title)}</h2>
            <div class="tag-list">
              <span class="tag">Rating: ${escapeHTML(manga.attributes?.contentRating || "safe")}</span>
              <span class="tag">Tahun: ${escapeHTML(manga.attributes?.year || "-")}</span>
              <span class="tag">Bahasa asli: ${escapeHTML(manga.attributes?.originalLanguage || "-")}</span>
              ${tags.map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}
            </div>
            <p class="detail-description">${escapeHTML(desc)}</p>
            <div class="hero-actions">
              <button class="primary-btn" data-action="load-chapters" data-id="${manga.id}">Muat Chapter</button>
              <button class="secondary-btn" data-action="toggle-favorite" data-id="${manga.id}">${isFav ? "Hapus Favorit" : "Tambah Favorit"}</button>
              <a class="ghost-btn" href="https://mangadex.org/title/${manga.id}" target="_blank" rel="noopener noreferrer">Buka di MangaDex</a>
            </div>
          </div>
        </section>

        ${renderSectionHead("Daftar Chapter", "Pilih chapter untuk membuka reader langsung di website ini.")}
        <div class="chapter-tools">
          <input id="chapterSearch" type="search" placeholder="Filter chapter..." />
          <select id="chapterOrder">
            <option value="desc">Terbaru dulu</option>
            <option value="asc">Awal dulu</option>
          </select>
          <button class="secondary-btn" data-action="load-chapters" data-id="${manga.id}">Refresh</button>
        </div>
        <div class="chapter-list" id="chapterList">
          <div class="empty-state"><p>Klik “Muat Chapter” untuk menampilkan daftar chapter.</p></div>
        </div>
      `;
    } catch (error) {
      console.error(error);
      setError("Manga tidak ditemukan", "ID manga tidak valid atau MangaDex API sedang tidak bisa diakses.");
    }
  }

  async function fetchChapterFeed(mangaId, baseParams) {
    const collected = [];
    let offset = 0;
    let total = Infinity;
    const maxToLoad = 500;

    while (offset < total && offset < maxToLoad) {
      const params = [...baseParams, "limit=100", `offset=${offset}`].join("&");
      const result = await api(`/manga/${mangaId}/feed`, params);
      const batch = result.data || [];
      collected.push(...batch);
      total = Number(result.total || collected.length);
      if (!batch.length) break;
      offset += batch.length;
    }

    return collected;
  }

  async function loadChapters(mangaId) {
    const list = document.getElementById("chapterList");
    const order = document.getElementById("chapterOrder")?.value || "desc";
    if (list) list.innerHTML = `<div class="loader"><div>Mengambil daftar chapter...</div></div>`;

    try {
      const params = [
        "includes[]=scanlation_group",
        "order[volume]=desc",
        `order[chapter]=${order}`,
      ];
      const lang = languageParams();
      if (lang) params.push(lang);

      const chapters = await fetchChapterFeed(mangaId, params);
      state.chapters = chapters.filter((chapter) => {
        const attr = chapter.attributes || {};
        return Number(attr.pages || 0) > 0 && !attr.externalUrl;
      });
      renderChapterList(state.chapters);

      document.getElementById("chapterSearch")?.addEventListener("input", (event) => {
        const q = event.target.value.toLowerCase();
        renderChapterList(state.chapters.filter((ch) => chapterLabel(ch).toLowerCase().includes(q)));
      });
    } catch (error) {
      console.error(error);
      if (list) list.innerHTML = `<div class="error-state"><p>Gagal mengambil chapter. Coba ganti filter bahasa atau refresh.</p></div>`;
    }
  }

  function chapterLabel(chapter) {
    const attr = chapter.attributes || {};
    const chapterNo = attr.chapter || "?";
    const title = attr.title || "";
    return `Chapter ${chapterNo}${title ? ` - ${title}` : ""}`;
  }

  function renderChapterList(chapters) {
    const list = document.getElementById("chapterList");
    if (!list) return;

    if (!chapters.length) {
      list.innerHTML = `<div class="empty-state"><p>Chapter tidak ditemukan untuk bahasa yang dipilih. Coba pilih “Semua” atau “Indonesia”.</p></div>`;
      return;
    }

    const history = store.get("ryuu_history", []);
    list.innerHTML = chapters
      .map((chapter) => {
        const read = history.some((item) => item.chapterId === chapter.id);
        const group = relationshipOf(chapter, "scanlation_group")?.attributes?.name || "Unknown group";
        return `
          <button class="chapter-row" data-chapter-id="${chapter.id}">
            <span>
              <strong>${read ? "✅ " : ""}${escapeHTML(chapterLabel(chapter))}</strong>
              <span>${escapeHTML(chapter.attributes?.translatedLanguage || "-")} • ${escapeHTML(chapter.attributes?.pages || "?")} halaman • ${escapeHTML(group)} • ${new Date(chapter.attributes?.publishAt || chapter.attributes?.createdAt || Date.now()).toLocaleDateString("id-ID")}</span>
            </span>
            <span>Baca →</span>
          </button>`;
      })
      .join("");
  }

  async function renderReader(chapterId) {
    setActiveNav("#/search");
    setLoading("Membuka reader...");

    try {
      let chapter = state.chapters.find((item) => item.id === chapterId);
      if (!chapter) {
        const chapterResult = await api(`/chapter/${chapterId}`, "includes[]=manga");
        chapter = chapterResult.data;
      }

      const mangaRel = mangaFromChapter(chapter);
      let mangaTitle = state.currentManga ? titleOf(state.currentManga) : mangaRel?.attributes?.title?.en || mangaRel?.attributes?.title?.id || "Manga";
      if (!state.currentManga && mangaRel?.id) {
        try {
          const mangaResult = await api(`/manga/${mangaRel.id}`, "includes[]=cover_art");
          state.currentManga = mangaResult.data;
          mangaTitle = titleOf(state.currentManga);
        } catch {}
      }

      const pageResult = await api(`/at-home/server/${chapterId}`);
      const baseUrl = pageResult.baseUrl;
      const hash = pageResult.chapter.hash;
      const highFiles = pageResult.chapter.data || [];
      const saverFiles = pageResult.chapter.dataSaver || [];
      const preferSaver = state.quality !== "data";
      const files = preferSaver ? (saverFiles.length ? saverFiles : highFiles) : (highFiles.length ? highFiles : saverFiles);
      const folder = preferSaver && saverFiles.length ? "data-saver" : "data";
      if (!baseUrl || !hash || !files.length) {
        throw new Error("Chapter ini tidak memiliki file halaman yang bisa dibaca.");
      }
      const pages = files.map((file) => `${baseUrl}/${folder}/${hash}/${file}`);

      state.currentPages = pages;
      state.pageIndex = 0;
      state.currentReader = { chapter, chapterId, mangaTitle };
      saveHistory(chapter, mangaTitle);

      document.documentElement.style.setProperty("--reader-width", `${state.readerWidth}px`);

      els.view.innerHTML = `
        <section class="reader-shell">
          <div class="reader-panel">
            <div class="reader-title">
              <h2>${escapeHTML(mangaTitle)} — ${escapeHTML(chapterLabel(chapter))}</h2>
              <p>${pages.length} halaman • Kualitas: ${state.quality === "data" ? "tinggi" : "hemat data"} • Gunakan tombol ← → untuk mode halaman.</p>
            </div>
            <div class="reader-controls">
              <button class="reader-action" data-action="back-detail">Detail</button>
              <button class="reader-action" data-action="toggle-page-mode">${state.pageMode ? "Scroll" : "Page"}</button>
              <button class="reader-action" data-action="reader-quality">${state.quality === "data" ? "Hemat" : "HQ"}</button>
              <button class="reader-action" data-action="reader-width-minus">-</button>
              <button class="reader-action" data-action="reader-width-plus">+</button>
            </div>
          </div>
          <div class="reader-pages ${state.pageMode ? "page-mode" : ""}" id="readerPages"></div>
          <div class="reader-panel">
            <button class="reader-action" data-action="prev-chapter">← Chapter Sebelumnya</button>
            <button class="reader-action" data-action="next-page">Halaman Berikutnya →</button>
            <button class="reader-action" data-action="next-chapter">Chapter Berikutnya →</button>
          </div>
        </section>
      `;

      renderReaderPages();
      window.scrollTo(0, 0);
    } catch (error) {
      console.error(error);
      setError("Gagal membuka chapter", "Chapter ini tidak bisa dimuat. Biasanya karena file halaman kosong, chapter sudah dihapus, atau gambar dari MangaDex sedang tidak bisa diakses. Coba chapter lain atau ganti bahasa chapter.");
    }
  }

  function renderReaderPages() {
    const target = document.getElementById("readerPages");
    if (!target) return;
    target.classList.toggle("page-mode", state.pageMode);

    if (state.pageMode) {
      const src = state.currentPages[state.pageIndex];
      target.innerHTML = src ? imageTag(src, `Halaman ${state.pageIndex + 1}`, "eager") : `<div class="empty-state"><p>Halaman kosong.</p></div>`;
      return;
    }

    target.innerHTML = state.currentPages
      .map((src, index) => imageTag(src, `Halaman ${index + 1}`, index < 2 ? "eager" : "lazy"))
      .join("");
  }

  function nextPage() {
    if (!state.pageMode) {
      const next = nextChapterId();
      if (next) renderReader(next);
      return;
    }
    state.pageIndex = Math.min(state.currentPages.length - 1, state.pageIndex + 1);
    renderReaderPages();
  }

  function prevPage() {
    if (!state.pageMode) return;
    state.pageIndex = Math.max(0, state.pageIndex - 1);
    renderReaderPages();
  }

  function currentChapterIndex() {
    if (!state.currentReader) return -1;
    return state.chapters.findIndex((chapter) => chapter.id === state.currentReader.chapterId);
  }

  function nextChapterId() {
    const index = currentChapterIndex();
    return index >= 0 ? state.chapters[index + 1]?.id : null;
  }

  function prevChapterId() {
    const index = currentChapterIndex();
    return index > 0 ? state.chapters[index - 1]?.id : null;
  }

  function saveHistory(chapter, mangaTitle) {
    const mangaId = state.currentManga?.id || mangaFromChapter(chapter)?.id || null;
    const record = {
      mangaId,
      mangaTitle,
      chapterId: chapter.id,
      chapterLabel: chapterLabel(chapter),
      cover: state.currentManga ? coverOf(state.currentManga, "256") : PLACEHOLDER,
      time: Date.now(),
    };
    const history = store.get("ryuu_history", []).filter((item) => item.chapterId !== chapter.id);
    history.unshift(record);
    store.set("ryuu_history", history.slice(0, 80));
  }

  function toggleFavorite() {
    if (!state.currentManga) return;
    const manga = state.currentManga;
    const favs = store.get("ryuu_favorites", []);
    const exists = favs.some((item) => item.id === manga.id);

    if (exists) {
      store.set("ryuu_favorites", favs.filter((item) => item.id !== manga.id));
      showToast("Dihapus dari favorit.");
    } else {
      favs.unshift({ id: manga.id, title: titleOf(manga), cover: coverOf(manga, "256"), status: manga.attributes?.status || "-", addedAt: Date.now() });
      store.set("ryuu_favorites", favs);
      showToast("Ditambahkan ke favorit.");
    }

    renderMangaDetail(manga.id);
  }

  function renderLibrary() {
    setActiveNav("#/library");
    const favs = store.get("ryuu_favorites", []);
    els.view.innerHTML = `
      <div class="page-title">
        <span class="pill">Koleksi Lokal</span>
        <h2>Favorit Kamu</h2>
        <p>Data ini hanya tersimpan di browser/perangkat ini, bukan di server.</p>
      </div>
      <div class="grid" id="libraryGrid"></div>
    `;

    const grid = document.getElementById("libraryGrid");
    if (!favs.length) {
      grid.innerHTML = `<div class="empty-state"><p>Belum ada favorit. Buka detail manga lalu klik “Tambah Favorit”.</p></div>`;
      return;
    }

    grid.innerHTML = favs
      .map((item) => `
        <article class="manga-card" data-manga-id="${item.id}">
          <div class="cover-wrap">${imageTag(item.cover, item.title, "lazy", "cover")}</div>
          <div class="card-body"><h3>${escapeHTML(item.title)}</h3><p class="meta">${escapeHTML(item.status)}</p></div>
        </article>`)
      .join("");
  }

  function renderHistory() {
    setActiveNav("#/history");
    const history = store.get("ryuu_history", []);
    els.view.innerHTML = `
      <div class="page-title">
        <span class="pill">Riwayat</span>
        <h2>Lanjutkan Membaca</h2>
        <p>Klik salah satu riwayat untuk membuka chapter terakhir yang kamu baca.</p>
      </div>
      <div class="chapter-list" id="historyList"></div>
    `;

    const list = document.getElementById("historyList");
    if (!history.length) {
      list.innerHTML = `<div class="empty-state"><p>Belum ada riwayat baca.</p></div>`;
      return;
    }

    list.innerHTML = history
      .map((item) => `
        <button class="chapter-row" data-history-chapter="${item.chapterId}" data-history-manga="${item.mangaId || ""}">
          <span>
            <strong>${escapeHTML(item.mangaTitle)}</strong>
            <span>${escapeHTML(item.chapterLabel)} • ${new Date(item.time).toLocaleString("id-ID")}</span>
          </span>
          <span>Lanjut →</span>
        </button>`)
      .join("");
  }

  function renderAbout() {
    setActiveNav("#/about");
    els.view.innerHTML = `
      <div class="page-title">
        <span class="pill">Penting</span>
        <h2>Catatan Deploy & Legal</h2>
        <p>Project ini dibuat sebagai reader berbasis API publik MangaDex. Jangan pakai MangaPlus sebagai reader langsung di website sendiri.</p>
      </div>
      <div class="panel detail-info legal-list">
        <p><strong>Sumber data:</strong> website ini mengambil manga, cover, chapter, dan halaman chapter dari MangaDex API. Website ini tidak menyimpan file manga di server kamu.</p>
        <p><strong>MangaPlus:</strong> untuk MangaPlus, gunakan link resmi saja. Jangan mengambil gambar chapter untuk ditampilkan ulang di reader website kamu.</p>
        <p><strong>Konten:</strong> banyak konten MangaDex merupakan scanlation/fan translation dan bisa terkena klaim hak cipta. Untuk project publik serius, tambahkan halaman DMCA/contact dan dukung rilis resmi.</p>
        <p><strong>Netlify:</strong> project ini static, jadi bisa deploy tanpa build command. Publish directory cukup root folder project.</p>
        <p><strong>Shortcut reader:</strong> saat mode halaman aktif, tekan <span class="kbd">→</span> untuk halaman berikutnya dan <span class="kbd">←</span> untuk halaman sebelumnya.</p>
      </div>
    `;
  }

  function handleRoute() {
    const hash = window.location.hash || "#/home";
    const [path, queryString] = hash.split("?");
    const parts = path.split("/").filter(Boolean);

    if (path === "#/home" || path === "#") return renderHome();
    if (path.startsWith("#/search")) {
      const params = new URLSearchParams(queryString || "");
      return renderSearch(params.get("q") || "");
    }
    if (parts[0] === "#" && parts[1] === "manga" && parts[2]) return renderMangaDetail(parts[2]);
    if (parts[0] === "#" && parts[1] === "read" && parts[2]) return renderReader(parts[2]);
    if (path === "#/library") return renderLibrary();
    if (path === "#/history") return renderHistory();
    if (path === "#/about") return renderAbout();

    renderHome();
  }

  document.addEventListener("click", (event) => {
    const routeBtn = event.target.closest("[data-route]");
    if (routeBtn) {
      navigate(routeBtn.dataset.route);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action) {
      const name = action.dataset.action;
      if (name === "home") navigate("#/home");
      if (name === "focus-search") els.globalSearchInput.focus();
      if (name === "load-chapters") loadChapters(action.dataset.id);
      if (name === "toggle-favorite") toggleFavorite();
      if (name === "back-detail" && state.currentManga) navigate(`#/manga/${state.currentManga.id}`);
      if (name === "toggle-page-mode") {
        state.pageMode = !state.pageMode;
        renderReaderPages();
        action.textContent = state.pageMode ? "Scroll" : "Page";
      }
      if (name === "reader-quality") {
        state.quality = state.quality === "data" ? "dataSaver" : "data";
        localStorage.setItem("ryuu_quality", state.quality);
        if (state.currentReader) renderReader(state.currentReader.chapterId);
      }
      if (name === "reader-width-minus") {
        state.readerWidth = Math.max(620, state.readerWidth - 80);
        localStorage.setItem("ryuu_reader_width", state.readerWidth);
        document.documentElement.style.setProperty("--reader-width", `${state.readerWidth}px`);
      }
      if (name === "reader-width-plus") {
        state.readerWidth = Math.min(1320, state.readerWidth + 80);
        localStorage.setItem("ryuu_reader_width", state.readerWidth);
        document.documentElement.style.setProperty("--reader-width", `${state.readerWidth}px`);
      }
      if (name === "next-page") nextPage();
      if (name === "next-chapter") {
        const next = nextChapterId();
        next ? renderReader(next) : showToast("Ini chapter terakhir di daftar saat ini.");
      }
      if (name === "prev-chapter") {
        const prev = prevChapterId();
        prev ? renderReader(prev) : showToast("Ini chapter pertama di daftar saat ini.");
      }
      return;
    }

    const quickCard = event.target.closest("[data-search]");
    if (quickCard) {
      const q = quickCard.dataset.search;
      els.globalSearchInput.value = q;
      navigate(`#/search?q=${encodeURIComponent(q)}`);
      return;
    }

    const chapterRow = event.target.closest("[data-chapter-id]");
    if (chapterRow) {
      navigate(`#/read/${chapterRow.dataset.chapterId}`);
      return;
    }

    const favCard = event.target.closest("[data-manga-id]");
    if (favCard) {
      navigate(`#/manga/${favCard.dataset.mangaId}`);
      return;
    }

    const historyRow = event.target.closest("[data-history-chapter]");
    if (historyRow) {
      if (historyRow.dataset.historyManga) {
        state.currentManga = null;
      }
      navigate(`#/read/${historyRow.dataset.historyChapter}`);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!window.location.hash.startsWith("#/read")) return;
    if (event.key === "ArrowRight") nextPage();
    if (event.key === "ArrowLeft") prevPage();
  });

  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const fallback = img.dataset.fallbackSrc;
    if (fallback && img.src !== fallback && !img.dataset.fallbackUsed) {
      img.dataset.fallbackUsed = "1";
      img.src = fallback;
      return;
    }
    img.classList.add("is-broken");
    img.alt = img.alt || "Gambar gagal dimuat";
  }, true);

  els.globalSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = els.globalSearchInput.value.trim();
    if (!q) return showToast("Masukkan judul manga dulu.");
    navigate(`#/search?q=${encodeURIComponent(q)}`);
  });

  els.navItems.forEach((btn) => btn.addEventListener("click", () => navigate(btn.dataset.route)));

  els.menuBtn.addEventListener("click", () => els.sidebar.classList.toggle("open"));

  els.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = current;
    localStorage.setItem("ryuu_theme", current);
    els.themeToggle.textContent = current === "light" ? "☀️" : "🌙";
  });

  const lastVersion = localStorage.getItem("ryuu_app_version");
  if (lastVersion !== APP_VERSION) {
    localStorage.setItem("ryuu_lang", DEFAULT_LANG);
  }
  localStorage.setItem("ryuu_app_version", APP_VERSION);
  els.languageSelect.value = localStorage.getItem("ryuu_lang") || DEFAULT_LANG;
  const savedTheme = localStorage.getItem("ryuu_theme") || "dark";
  document.documentElement.dataset.theme = savedTheme;
  els.themeToggle.textContent = savedTheme === "light" ? "☀️" : "🌙";
  document.documentElement.style.setProperty("--reader-width", `${state.readerWidth}px`);

  window.addEventListener("hashchange", handleRoute);
  if (!window.location.hash) window.location.hash = "#/home";
  handleRoute();
})();

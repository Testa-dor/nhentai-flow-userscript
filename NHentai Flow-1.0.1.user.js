// ==UserScript==
// @name         NHentai Flow
// @namespace    NEnhanced
// @version      1.0.1
// @description  Several Quality of Life features: Quick Preview, Queue System, Smart Scroll, Tag Selector, and more.
// @author       Testador
// @match        https://nhentai.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      nhentai.net
// @connect      i.nhentai.net
// @icon         https://external-content.duckduckgo.com/ip3/nhentai.net.ico
// @license      MIT
// @downloadURL https://update.sleazyfork.org/scripts/557178/NHentai%20Flow.user.js
// @updateURL https://update.sleazyfork.org/scripts/557178/NHentai%20Flow.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================================================
    // CONFIG & SHARED UTILS
    // ==========================================================================
    const EXT_MAP = { 'j': 'jpg', 'p': 'png', 'g': 'gif', 'w': 'webp' };
    const cache = new Map();
    const states = new Map();
    let hoveredGallery = null;
    let hoverTimeout = null;

    // Queue State
    let readingQueue = JSON.parse(localStorage.getItem('nhentai_queue_v1') || '[]');

    const SMART_NAV_THRESHOLD = 600;

    const isReader = !!document.querySelector('#image-container');
    if (!isReader) document.body.classList.add('is-gallery-page');

    const css = `
        /* --- PREVIEW STYLES --- */
        .gallery { position: relative; vertical-align: top; }
        .gallery.is-previewing .cover { padding-bottom: 0 !important; height: auto !important; display: flex; flex-direction: column; }
        .gallery.is-previewing .cover img { position: relative !important; height: auto !important; width: 100% !important; max-height: none !important; object-fit: contain; }
        .inline-preview-ui { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; }
        .gallery:hover .inline-preview-ui, .gallery.is-previewing .inline-preview-ui { display: block; }
        .gallery a:visited .caption { background: #900c2a; }
        .gallery { vertical-align: bottom !important; }

        .hotzone { position: absolute; top: 0; height: calc(100% - 15px); width: 40%; cursor: default; z-index: 20; }
        .hotzone-left { left: 0; } .hotzone-right { right: 0; }
        .seek-container { position: absolute; bottom: 0; left: 0; width: 100%; height: 20px; z-index: 40; cursor: pointer; display: flex; align-items: flex-end; }
        .seek-bg { width: 100%; height: 3px; background: rgba(255,255,255,0.2); transition: height 0.1s; position: relative; backdrop-filter: blur(2px); }
        .seek-container:hover .seek-bg { height: 15px; background: rgba(255,255,255,0.3); }
        .seek-fill { height: 100%; background: #ed2553; width: 0%; transition: width 0.1s; }
        .seek-tooltip { position: absolute; bottom: 17px; transform: translateX(-50%); background: #ed2553; color: #fff; font-size: 10px; padding: 2px 4px; border-radius: 3px; opacity: 0; pointer-events: none; white-space: nowrap; font-weight: bold; transition: opacity 0.1s; }
        .seek-container:hover .seek-tooltip { opacity: 1; }
        .tag-trigger, .queue-trigger { position: absolute; top: 5px; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer; z-index: 50; font-family: sans-serif; opacity: 0.7; border: 1px solid rgba(255,255,255,0.2); transition: all 0.2s; }
        .tag-trigger { left: 5px; cursor: help; }
        .queue-trigger { right: 5px; }
        .tag-trigger:hover, .queue-trigger:hover { opacity: 1; background: #ed2553; border-color: #ed2553; }
        .queue-trigger.in-queue { background: #ed2553; border-color: #ed2553; opacity: 1; }

        .tag-popup { display: none; position: absolute; top: 25px; left: 5px; width: 215px; max-height: 250px; overflow-y: auto; background: rgba(15,15,15,0.95); color: #ddd; border: 1px solid #333; border-radius: 4px; padding: 8px; font-size: 11px; z-index: 60; box-shadow: 0 4px 10px rgba(0,0,0,0.5); text-align: left; line-height: 1.4; }
        .tag-trigger:hover + .tag-popup, .tag-popup:hover { display: block; }
        .tag-category { color: #ed2553; font-weight: bold; margin-bottom: 2px; margin-top: 6px; font-size: 10px; text-transform: uppercase; }
        .tag-category:first-child { margin-top: 0; }
        .tag-pill { display: inline-block; transition: all 0.2s; background: #333; padding: 1px 4px; margin: 1px; border-radius: 3px; color: #ccc; }
        .tag-pill.tier-mythic { border: 1px solid #b655f7; color: #d6a0fb; text-shadow: 0 0 5px rgba(168, 85, 247, 0.8); }
        .tag-pill.tier-rare { border: 1px solid #eab308; color: #fef08a; }
        .tag-pill.tier-uncommon { border: 1px solid #0740EB; }
        .tag-pill.style-lgbt {  border: none !important; background-image: linear-gradient(144deg, rgba(231, 0, 0, 1) 0%, rgba(255, 140, 0, 1) 20%, rgba(255, 239, 0, 1) 40%, rgba(0, 129, 31, 1) 60%, rgba(0, 68, 255, 1) 80%, rgba(118, 0, 137, 1) 100%); color: #000000 !important; font-weight: 900; text-shadow: 0 0 2px rgba(255,255,255,0.8), 0 0 5px rgba(255,255,255,1); }

        /* --- READER STYLES --- */
        #image-container { cursor: pointer; }
        .exit-fs-indicator { display: none; }
        :fullscreen .exit-fs-indicator { display: block;position: fixed; top: 0 ; left: 50%; transform: translateX(-50%); font-size: 40px; cursor: pointer; transition: all 0.2s; text-shadow: 0 2px 5px rgba(0,0,0,0.8); padding: 20px 65px; opacity: 0; }
        :fullscreen .exit-fs-indicator:hover { color: #ed2553; transform: translateX(-50%) scale(1.4); opacity: 1; }

        /* --- SMART NAVIGATION --- */
        .smart-nav-bar { position: fixed; bottom: 0; left: 0; height: 5px; background: #ed2553; width: 0%; z-index: 9999; transition: width 0.1s linear; box-shadow: 0 -2px 10px rgba(237, 37, 83, 0.5); pointer-events: none; }
        body.is-gallery-page #content { padding-bottom: 200px !important; }
        @media (min-width: 900px) {
            body.is-gallery-page .pagination { position: fixed !important; left: 8px !important; top: 50% !important; transform: translateY(-50%) !important; display: flex !important; flex-direction: column !important; }
            body.is-gallery-page a.first, body.is-gallery-page a.previous, body.is-gallery-page a.last, body.is-gallery-page a.next { transform: rotate(90deg); }
        }

        /* --- TAG SELECTOR & QUEUE BTN --- */
        @media (min-width: 900px) { #info { width: 570px; } }
        .btn-tag-selector.is-active, .btn-queue-add.in-queue { background-color: #ed2553 !important; }
        .tag-container .tag.tag-selected .name { background: #ed2553 !important; opacity: 1 !important; }
        .tags-selecting-mode .tag:not(.tag-selected) { opacity: 0.6; }

        /* --- SEARCH SHORTCUT HINT --- */
        .search-slash-hint { position: absolute; right: 50px; top: 50%; transform: translateY(-50%); color: #999; font-size: 12px; pointer-events: none; font-family: Consolas, monospace; transition: opacity 0.2s; }
        form.search input:focus ~ .search-slash-hint, form.search input:not(:placeholder-shown) ~ .search-slash-hint { opacity: 0; }
        form.search { position: relative; }

        /* --- QUEUE DOCK --- */
        .queue-dock { position: fixed; bottom: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; align-items: flex-end; }
        .queue-toggle-btn { width: 40px; height: 40px; border-radius: 50%; background: #1f1f1f; border: 2px solid #333; color: #fff; font-size: 15px; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; transition: all 0.2s; position: relative; }
        .queue-toggle-btn:hover { background: #ed2553; border-color: #ed2553; transform: scale(1.1); }
        .queue-count { position: absolute; top: -5px; right: -5px; background: #ed2553; color: #fff; font-size: 10px; font-weight: bold; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #1f1f1f; }

        .queue-panel { display: none; width: 300px; background: #1f1f1f; border: 1px solid #333; border-radius: 8px; overflow: hidden; margin-bottom: 15px; box-shadow: 0 5px 20px rgba(0,0,0,0.6); animation: slideUp 0.2s ease-out; }
        .queue-panel.is-visible { display: block; }
        .queue-header { padding: 10px 15px; background: #222; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #eee; font-size: 13px; }
        .queue-clear { cursor: pointer; color: #888; font-size: 11px; transition: color 0.2s; }
        .queue-clear:hover { color: #ed2553; }
        .queue-list { max-height: 350px; overflow-y: auto; padding: 0; margin: 0; list-style: none; }
        .queue-item { display: flex; padding: 8px; border-bottom: 1px solid #2a2a2a; transition: background 0.2s; position: relative; content-visibility: auto; contain-intrinsic-size: 75px; }
        .queue-item:hover { background: #2a2a2a; }
        .queue-item img { width: 40px; height: 58px; object-fit: cover; border-radius: 3px; margin-right: 10px; }
        .queue-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .queue-title { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; margin-bottom: 4px; }
        .queue-title:hover { color: #ed2553; }
        .queue-id { font-size: 10px; color: #666; }
        .queue-remove { margin: 8px; color: #555; cursor: pointer; padding: 5px; display: flex; align-items: center; }
        .queue-remove:hover { color: #ed2553; }
        .queue-empty { padding: 20px; text-align: center; color: #666; font-size: 12px; font-style: italic; }

        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    `;

    (typeof GM_addStyle !== "undefined") ? GM_addStyle(css) : document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

    // ==========================================================================
    // QUEUE LOGIC
    // ==========================================================================

    function saveQueue() {
        localStorage.setItem('nhentai_queue_v1', JSON.stringify(readingQueue));
        updateQueueWidget();
        updateAllQueueButtons();
    }

    function toggleQueueItem(id, title, coverUrl, galleryUrl) {
        const index = readingQueue.findIndex(i => i.id == id);
        if (index > -1) {
            readingQueue.splice(index, 1);
        } else {
            readingQueue.push({ id, title, coverUrl, galleryUrl, addedAt: Date.now() });
        }
        saveQueue();
    }

    function isQueued(id) {
        return readingQueue.some(i => i.id == id);
    }

    function clearQueue() {
        if(confirm('Clear reading queue?')) {
            readingQueue = [];
            saveQueue();
        }
    }

    function updateAllQueueButtons() {
        document.querySelectorAll('.gallery[data-gid]').forEach(gallery => {
            const id = gallery.dataset.gid;
            const btn = gallery.querySelector('.queue-trigger');
            if (btn) {
                if (isQueued(id)) {
                    btn.classList.add('in-queue');
                    btn.innerHTML = '<i class="fa fa-check"></i>';
                } else {
                    btn.classList.remove('in-queue');
                    btn.innerHTML = '<i class="fa fa-plus"></i>';
                }
            }
        });

        const pageBtn = document.querySelector('.btn-queue-add');
        if (pageBtn) {
            const id = window.location.href.match(/\/g\/(\d+)/)?.[1];
            if (id && isQueued(id)) {
                pageBtn.innerHTML = '<i class="fa fa-check"></i> Saved';
                pageBtn.classList.add('in-queue');
            } else {
                pageBtn.innerHTML = '<i class="fa fa-plus"></i> Queue';
                pageBtn.classList.remove('in-queue');
            }
        }
    }

    function updateQueueWidget() {
        const list = document.querySelector('.queue-list');
        const count = document.querySelector('.queue-count');
        const panel = document.querySelector('.queue-panel');
        if (!list || !count) return;

        count.textContent = readingQueue.length;
        count.style.display = readingQueue.length > 0 ? 'flex' : 'none';

        if (readingQueue.length === 0) {
            list.innerHTML = '<li class="queue-empty">Queue is empty.</li>';
        } else {
            list.innerHTML = readingQueue.map(item => `
                <li class="queue-item">
                    <a href="${item.galleryUrl}">
                        <img src="${item.coverUrl}" loading="lazy">
                    </a>
                    <div class="queue-info">
                        <a href="${item.galleryUrl}" class="queue-title" title="${item.title}">${item.title}</a>
                        <div class="queue-id">#${item.id}</div>
                    </div>
                    <div class="queue-remove" data-id="${item.id}" title="Remove"><i class="fa fa-times"></i></div>
                </li>
            `).join('');

            list.querySelectorAll('.queue-remove').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const item = readingQueue.find(i => i.id == btn.dataset.id);
                    if(item) toggleQueueItem(item.id, item.title, item.coverUrl, item.galleryUrl);
                };
            });
        }
    }

    function initQueueWidget() {
        if (isReader) return;
        if (document.querySelector('.queue-dock')) return;

        const dock = document.createElement('div');
        dock.className = 'queue-dock';

        dock.innerHTML = `
            <div class="queue-panel">
                <div class="queue-header">
                    <span><i class="fa fa-book"></i> Reading Queue</span>
                    <span class="queue-clear">Clear All</span>
                </div>
                <ul class="queue-list"></ul>
            </div>
            <div class="queue-toggle-btn" title="Toggle Queue">
                <i class="fa fa-list-ul"></i>
                <div class="queue-count">0</div>
            </div>
        `;

        document.body.appendChild(dock);

        const toggle = dock.querySelector('.queue-toggle-btn');
        const panel = dock.querySelector('.queue-panel');
        const clearBtn = dock.querySelector('.queue-clear');

        toggle.onclick = () => {
            panel.classList.toggle('is-visible');
        };

        clearBtn.onclick = clearQueue;

        updateQueueWidget();
    }

    // ==========================================================================
    // PREVIEW LOGIC
    // ==========================================================================

    function getMeta(id) {
        if (cache.has(id)) return Promise.resolve(cache.get(id));
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET', url: `/api/gallery/${id}`,
                onload: (res) => {
                    if (res.status === 200) {
                        try {
                            const data = JSON.parse(res.responseText);
                            const meta = {
                                id: data.media_id,
                                pages: data.images.pages,
                                total: data.num_pages,
                                tags: data.tags,
                                title: data.title.english || data.title.japanese || data.title.pretty,
                                cover_type: data.images.cover.t
                            };
                            cache.set(id, meta);
                            resolve(meta);
                        } catch(e) {}
                    }
                }
            });
        });
    }

    function buildTagList(tags) {
        const groups = { artist: [], parody: [], character: [], tag: [] };
        const fmt = (n) => n >= 1000 ? (n/1000).toFixed(1) + 'k' : n;
        const getTier = (c) => {
            if (c < 1000) return 'tier-mythic';
            if (c < 5000) return 'tier-rare';
            if (c < 20000) return 'tier-uncommon';
            return '';
        };
        const getGenreStyle = (name) => {
            if (['yaoi', 'males only', 'bara', 'yuri', 'females only', 'lesbian', 'futanari', 'tomgirl', 'otokonoko', 'dickgirl', 'shemale'].includes(name)) return 'style-lgbt';
            return '';
        };

        tags.forEach(t => {
            const count = t.count || 0;
            let className = '';
            if (t.type === 'tag') {
                className = `${getTier(count)} ${getGenreStyle(t.name)}`;
            }
            const html = `<span class="tag-pill ${className}" title="${t.name} (${fmt(count)})">${t.name}</span>`;
            if (groups[t.type]) groups[t.type].push(html);
            else if (t.type === 'group') groups.artist.push(`<span class="tag-pill">[${t.name}]</span>`);
        });

        let html = '';
        const addGroup = (title, list) => { if (list.length) html += `<div class="tag-category">${title}</div>` + list.join(''); };
        addGroup('Artists', groups.artist); addGroup('Parodies', groups.parody); addGroup('Characters', groups.character); addGroup('Tags', groups.tag);
        return html || '<div style="padding:5px">No tags</div>';
    }

    function update(gallery, val, isJump = false) {
        const id = gallery.dataset.gid;
        const state = states.get(id) || { curr: 1, req: 0 };
        states.set(id, state);

        getMeta(id).then(meta => {
            let next = isJump ? val : state.curr + val;
            if (next < 1) next = 1; if (next > meta.total) next = meta.total;

            const popup = gallery.querySelector('.tag-popup');
            if (popup && !popup.innerHTML) popup.innerHTML = buildTagList(meta.tags);

            if (next === state.curr && !isJump && val !== 0) return;
            state.curr = next;
            const reqId = ++state.req;

            if (state.curr !== 1) gallery.classList.add('is-previewing');

            const barFill = gallery.querySelector('.seek-fill');
            if (barFill) barFill.style.width = `${(state.curr / meta.total) * 100}%`;

            const pageData = meta.pages[state.curr - 1];
            const src = `https://i.nhentai.net/galleries/${meta.id}/${state.curr}.${EXT_MAP[pageData.t]}`;
            const img = gallery.querySelector('a.cover img');
            const loader = new Image();
            loader.onload = () => { if (state.req === reqId) { img.style.aspectRatio = `${pageData.w}/${pageData.h}`; img.src = src; } };
            loader.src = src;
        });
    }

    function initPreviewUI(gallery) {
        const link = gallery.querySelector('a.cover');
        if (!link) return;
        const id = link.href.match(/\/g\/(\d+)\//)?.[1];
        if (!id) return;
        gallery.dataset.gid = id; gallery.dataset.init = '1';

        const ui = document.createElement('div');
        ui.className = 'inline-preview-ui';

        ui.innerHTML = `
            <div class="tag-trigger">TAGS</div>
            <div class="tag-popup"></div>
            <div class="queue-trigger" title="Add/Remove from Queue (Q)"><i class="fa fa-plus"></i></div>
            <div class="hotzone hotzone-left"></div>
            <div class="hotzone hotzone-right"></div>
            <div class="seek-container"><div class="seek-bg"><div class="seek-fill"></div></div><div class="seek-tooltip">Pg 1</div></div>
        `;

        const qBtn = ui.querySelector('.queue-trigger');
        if (isQueued(id)) {
            qBtn.classList.add('in-queue');
            qBtn.innerHTML = '<i class="fa fa-check"></i>';
        }

        qBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();

            if (cache.has(id)) {
                const meta = cache.get(id);
                const coverUrl = gallery.querySelector('a.cover img').dataset.src || gallery.querySelector('a.cover img').src;
                toggleQueueItem(id, meta.title, coverUrl, link.href);
            } else {
                qBtn.innerHTML = '<i class="fas fa-ellipsis-h"></i>';
                getMeta(id).then(meta => {
                    const coverUrl = gallery.querySelector('a.cover img').dataset.src || gallery.querySelector('a.cover img').src;
                    toggleQueueItem(id, meta.title, coverUrl, link.href);
                });
            }
        };

        ui.querySelector('.hotzone-left').onclick = (e) => { e.preventDefault(); e.stopPropagation(); update(gallery, -1); };
        ui.querySelector('.hotzone-right').onclick = (e) => { e.preventDefault(); e.stopPropagation(); update(gallery, 1); };

        const seek = ui.querySelector('.seek-container');
        const tip = ui.querySelector('.seek-tooltip');
        seek.onmousemove = (e) => {
            if (!cache.has(id)) return;
            const meta = cache.get(id); const rect = seek.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            tip.style.left = `${e.clientX - rect.left}px`; tip.textContent = Math.ceil(pct * meta.total) || 1;
        };

        seek.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!cache.has(id)) {
                 update(gallery, 0).then(() => {
                     const rect = seek.getBoundingClientRect();
                     const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                     const meta = cache.get(id);
                     update(gallery, Math.ceil(pct * meta.total) || 1, true);
                 });
                 return;
            }
            const rect = seek.getBoundingClientRect();
            update(gallery, Math.ceil(((e.clientX - rect.left) / rect.width) * cache.get(id).total) || 1, true);
        };

        gallery.onmouseenter = () => {
            hoveredGallery = gallery;
            if (!cache.has(id)) {
                hoverTimeout = setTimeout(() => { update(gallery, 0); }, 300);
            } else { update(gallery, 0); }
        };

        gallery.onmouseleave = () => {
            hoveredGallery = null;
            if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
        };

        link.style.position = 'relative'; link.appendChild(ui);
    }

    // ==========================================================================
    // READER LOGIC (Fullscreen + Container Nav)
    // ==========================================================================

    function initReaderMode() {
        const imageContainer = document.querySelector('#image-container');
        if (!imageContainer || imageContainer.dataset.readerInit) return;
        imageContainer.dataset.readerInit = '1';

        const exitIcon = document.createElement('div');
        exitIcon.className = 'exit-fs-indicator';
        exitIcon.innerHTML = '<i class="fa fa-times"></i>';

        exitIcon.onclick = (e) => {
            e.stopPropagation();
            if (document.fullscreenElement) { document.exitFullscreen(); }
        };
        imageContainer.appendChild(exitIcon);

        imageContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG' || e.target.tagName === 'A') return;
            const rect = imageContainer.getBoundingClientRect();
            if (e.clientX - rect.left > rect.width / 2) {
                const nextBtn = document.querySelector('.reader-pagination .next');
                if (nextBtn) nextBtn.click();
            } else {
                const prevBtn = document.querySelector('.reader-pagination .previous');
                if (prevBtn) prevBtn.click();
            }
        });

        if (document.querySelector('.btn-fullscreen-custom')) return;
        const toolbars = document.querySelectorAll('.reader-buttons-right');
        if (toolbars.length === 0) return;
        const toolbar = toolbars[toolbars.length - 1];

        const btn = document.createElement('button');
        btn.className = 'btn btn-unstyled btn-fullscreen-custom';
        btn.innerHTML = '<i class="fa fa-expand"></i>';
        btn.title = "Fullscreen (T)";
        const toggleFS = () => {
            if (!document.fullscreenElement) { imageContainer.requestFullscreen().catch(err => console.log(err)); }
            else { document.exitFullscreen(); }
        };
        btn.onclick = toggleFS;
        toolbar.insertBefore(btn, toolbar.firstChild);

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 't' || e.key === 'T') { e.preventDefault(); toggleFS(); }
        });
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) { btn.innerHTML = '<i class="fa fa-expand"></i>'; }
        });
    }

    // ==========================================================================
    // SMART NAVIGATION
    // ==========================================================================

    function initSmartNavigation() {
        if (isReader) return;

        const navBar = document.createElement('div');
        navBar.className = 'smart-nav-bar';
        document.body.appendChild(navBar);

        let accumulatedDelta = 0;
        let isNavigating = false;

        window.addEventListener('wheel', (e) => {
            const nextLink = document.querySelector('.pagination .next');
            if (!nextLink || isNavigating) return;

            const scrollBottom = window.scrollY + window.innerHeight;
            const docHeight = document.body.scrollHeight;
            const isAtBottom = Math.abs(docHeight - scrollBottom) < 50;

            if (isAtBottom && e.deltaY > 0) {
                accumulatedDelta += e.deltaY;
                const percent = Math.min(100, (accumulatedDelta / SMART_NAV_THRESHOLD) * 100);
                navBar.style.width = `${percent}%`;

                if (accumulatedDelta > SMART_NAV_THRESHOLD) {
                    isNavigating = true;
                    navBar.style.background = "#fff";
                    window.location.href = nextLink.href;
                }
            } else {
                accumulatedDelta = 0;
                navBar.style.width = '0%';
            }
        }, { passive: true });
    }

    // ==========================================================================
    // GALLERY PAGE FEATURES (Tag Select + Queue Btn)
    // ==========================================================================

    function initGalleryPageFeatures() {
        const btnContainer = document.querySelector('#info-block .buttons');
        const searchInput = document.querySelector('form.search input[name="q"]');
        if (!btnContainer) return;

        // --- 1. Queue Button ---
        if (!document.querySelector('.btn-queue-add')) {
            const qBtn = document.createElement('button');
            qBtn.className = 'btn btn-secondary btn-queue-add';
            qBtn.innerHTML = '<i class="fa fa-plus"></i> Queue';

            const galleryId = window.location.href.match(/\/g\/(\d+)/)?.[1];

            if (galleryId) {
                if (isQueued(galleryId)) {
                    qBtn.innerHTML = '<i class="fa fa-check"></i> Saved';
                    qBtn.classList.add('in-queue');
                }

                qBtn.onclick = () => {
                   const title = document.querySelector('h1.title').textContent;
                   const coverImg = document.querySelector('#cover img');
                   const coverUrl = coverImg ? (coverImg.dataset.src || coverImg.src) : '';
                   toggleQueueItem(galleryId, title, coverUrl, window.location.href);
                };
                btnContainer.appendChild(qBtn);
            }
        }

        // --- 2. Tag Selector ---
        if (!searchInput || document.querySelector('.btn-tag-selector')) return;

        let isSelectionMode = false;
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-secondary btn-tag-selector';
        toggleBtn.innerHTML = '<i class="fa fa-tags"></i> Tag Select';
        toggleBtn.type = 'button';
        btnContainer.appendChild(toggleBtn);

        const tagsContainer = document.querySelector('#tags');
        tagsContainer.addEventListener('click', (e) => {
            if (!isSelectionMode) return;
            const tagLink = e.target.closest('a.tag');
            if (tagLink) {
                e.preventDefault(); e.stopPropagation();
                if (!tagLink.href.includes('q=pages')) {
                    tagLink.classList.toggle('tag-selected');
                    updateSearchBar();
                }
            }
        }, true);

        toggleBtn.onclick = () => {
            isSelectionMode = !isSelectionMode;
            if (isSelectionMode) {
                toggleBtn.classList.add('is-active');
                tagsContainer.classList.add('tags-selecting-mode');
                toggleBtn.innerHTML = '<i class="fa fa-check"></i> Done';
            } else {
                toggleBtn.classList.remove('is-active');
                tagsContainer.classList.remove('tags-selecting-mode');
                toggleBtn.innerHTML = '<i class="fa fa-tags"></i> Tag Select';
            }
        };

        function updateSearchBar() {
            const selectedTags = tagsContainer.querySelectorAll('.tag.tag-selected');
            const queryTerms = Array.from(selectedTags).map(tag => {
                const nameSpan = tag.querySelector('.name');
                let tagName = nameSpan ? nameSpan.textContent.trim() : '';
                const href = tag.getAttribute('href');

                if (tagName.includes(' ')) tagName = `"${tagName}"`;
                if (href.includes('/artist/')) return `artist:${tagName}`;
                if (href.includes('/group/')) return `group:${tagName}`;
                if (href.includes('/parody/')) return `parody:${tagName}`;
                if (href.includes('/character/')) return `character:${tagName}`;
                return tagName;
            });
            searchInput.value = queryTerms.join(' ');
        }
    }

    // ==========================================================================
    // GLOBAL SHORTCUTS
    // ==========================================================================

    function initGlobalShortcuts() {
        if (document.body.dataset.shortcutsInit) return;
        document.body.dataset.shortcutsInit = '1';

        const searchForm = document.querySelector('form.search');
        const searchInput = document.querySelector('form.search input[name="q"]');

        if (searchForm && searchInput) {
            if (!searchForm.querySelector('.search-slash-hint')) {
                const hint = document.createElement('div');
                hint.className = 'search-slash-hint';
                hint.textContent = 'Type / to search';
                searchForm.insertBefore(hint, searchInput.nextSibling);
            }
        }

        document.addEventListener('keydown', (e) => {
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                if (e.key === 'Escape') target.blur();
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            if (e.key === '/') {
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    searchInput.select();
                }
            }
        });
    }

    // ==========================================================================
    // INIT & OBSERVERS
    // ==========================================================================

    function scan() {
        document.querySelectorAll('.gallery:not([data-init])').forEach(initPreviewUI);
        initReaderMode();
        initGalleryPageFeatures();
        initGlobalShortcuts();
        initQueueWidget();
    }

    document.addEventListener('keydown', (e) => {
        if (hoveredGallery && !document.fullscreenElement) {
            if (e.key === 'ArrowRight') { e.preventDefault(); update(hoveredGallery, 1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); update(hoveredGallery, -1); }
            else if (e.key === 'q') {
                const btn = hoveredGallery.querySelector('.queue-trigger');
                if (btn) btn.click();
            }
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { scan(); initSmartNavigation(); });
    } else {
        scan();
        initSmartNavigation();
    }

    const observer = new MutationObserver(scan);
    observer.observe(document.getElementById('content') || document.body, { childList: true, subtree: true });

})();

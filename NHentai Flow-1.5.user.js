// ==UserScript==
// @name         NHentai Flow
// @namespace    NEnhanced
// @version      1.5
// @description  Enhances the site with instant previews, visual markers for favorites, a reading queue, tag tools, smart navigation, and more.
// @author       Testador
// @match        https://nhentai.net/*
// @grant        GM_addStyle
// @grant        GM_openInTab
// @icon         https://i.imgur.com/11yLO04.png
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================================================
    // 0. SETTINGS & CONFIGURATION MANAGER
    // ==========================================================================

    const DEFAULT_SETTINGS = {
        previewNav: true,
        highlightVisited: true,
        showTagOverlay: true,
        enableQueue: true,
        enableTagSelect: true,
        enableSavedSearch: true,
        smartNav: true,
        smartNavSensitivity: 1.5,
        paginationRight: false,
        enableContextMenu: true
    };

    let settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('nhentai_flow_settings') || '{}') };

    function saveSettings() {
        localStorage.setItem('nhentai_flow_settings', JSON.stringify(settings));
        applySettings();
    }

    function applySettings() {
        const body = document.body;

        settings.highlightVisited ? body.classList.add('f-visited') : body.classList.remove('f-visited');
        settings.paginationRight ? body.classList.add('f-pag-right') : body.classList.remove('f-pag-right');
        settings.showTagOverlay ? body.classList.add('f-tags') : body.classList.remove('f-tags');
        settings.enableQueue ? body.classList.add('f-queue') : body.classList.remove('f-queue');
        settings.enableTagSelect ? body.classList.add('f-tag-select') : body.classList.remove('f-tag-select');
        settings.enableSavedSearch ? body.classList.add('f-saved-search') : body.classList.remove('f-saved-search');
        settings.previewNav ? body.classList.remove('disable-preview-nav') : body.classList.add('disable-preview-nav');
    }

    applySettings();

    // ==========================================================================
    // 1. SHARED UTILS & CSS
    // ==========================================================================
    const EXT_MAP = { 'j': 'jpg', 'p': 'png', 'g': 'gif', 'w': 'webp' };
    const stopEvent = (e) => { e.preventDefault(); e.stopPropagation(); };
    const stopPropOnly = (e) => { e.stopPropagation(); };
    const DOM_PARSER = new DOMParser();
    const CACHE_LIMIT = 5;
    const cache = new Map();
    const states = new Map();
    let hoveredGallery = null;
    let hoverTimeout = null;
    let readingQueue = JSON.parse(localStorage.getItem('nhentai_queue_v1') || '[]');
    let favCache = new Set(JSON.parse(localStorage.getItem('nhentai_flow_favs') || '[]'));
    const SMART_NAV_THRESHOLD = 600;
    let saveQueueTimeout;
    let currentSortMode = localStorage.getItem('nhentai_queue_sort') || 'newest';
    let dockCurrentPage = 1;
    const DOCK_ITEMS_PER_PAGE = 12;

    const isReader = !!document.querySelector('#image-container');
    if (!isReader) document.body.classList.add('is-gallery-page');

    const css = `
        /* --- CORE PREVIEW STYLES  --- */
        .gallery, .gallery-favorite { position: relative; vertical-align: bottom; }
        .gallery:hover, .gallery.is-previewing { z-index: 150; }
        .gallery.is-previewing { display: inline-flex !important; flex-direction: column; justify-content: flex-end; }
        .gallery.is-previewing .cover { padding-bottom: 0 !important; height: auto !important; display: block; flex-grow: 0; }
        .gallery.is-previewing .cover img { position: relative !important; height: auto !important; width: 100% !important; max-height: none !important; object-fit: contain; }
        .inline-preview-ui { opacity: 0; pointer-events: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; }
        .gallery:hover .inline-preview-ui { opacity: 1; pointer-events: auto; }
        @media (min-width: 600px) { .username { display: none } }

        /* --- HIGHLIGHT VISITED --- */
        body.f-visited .gallery a:visited .caption { background: #900c2a !important; color: #ecc !important; }

        /* --- MARKERS SYSTEM --- */
        .reading-marker { position: absolute; top: -2px; z-index: 5; pointer-events: none; filter: drop-shadow(0 0 1px #000); }
        .marker-queue { left: 35px; }
        .marker-fav { left: 10px; }
        .marker-progress { right: 10px; }
        .marker-yellow i { color: #ed7c26; }
        .marker-blue i { color: #5b26ed; }
        .marker-pink i { color: #ed2553; }
        .gallery:hover .reading-marker { opacity: 0; }

        /* --- CONTEXT MENU --- */
        .nh-context-menu { position: fixed; z-index: 10000; width: 160px; background: #1f1f1f; border-radius: 5px; box-shadow: 0 2px 6px rgba(0,0,0,0.5); display: none; flex-direction: column; padding: 5px 0 0 0 ; font-size: 12px; }
        .nh-context-menu.is-visible { display: flex; }
        .nh-cm-item { padding: 8px 15px; cursor: pointer; display: flex; color: #ddd; }
        .nh-cm-item:hover { background: #4d4d4d; }
        .nh-cm-footer { margin-top: 5px; padding: 8px 0; border-top: 1px solid #333; color: #666; font-size: 0.7em; cursor: default; background: #1a1a1a; border-radius: 0 0 5px 5px; }
        .nh-cm-separator { height: 1px; background: #333; margin: 5px 5px}

        /* --- UI ELEMENTS (Hotzones/Seek) --- */
        .hotzone { position: absolute; top: 0; height: calc(100% - 15px); width: 40%; cursor: default; z-index: 20; }
        .hotzone-left { left: 0; } .hotzone-right { right: 0; }
        .seek-container { position: absolute; bottom: 0; left: 0; width: 100%; height: 20px; z-index: 40; cursor: pointer; display: flex; align-items: flex-end; }
        .seek-bg { width: 100%; height: 3px; background: rgba(31,31,31,0.5); transition: height 0.1s; position: relative; }
        .seek-container:hover .seek-bg { height: 15px; }
        .seek-fill { height: 100%; background: #ed2553; width: 0%; transition: width 0.1s; }
        .seek-tooltip { position: absolute; bottom: 17px; transform: translateX(-50%); background: #ed2553; color: #fff; font-size: 10px; padding: 2px 4px; border-radius: .3em; opacity: 0; pointer-events: none; white-space: nowrap; font-weight: bold; transition: opacity 0.1s; }
        .seek-container:hover .seek-tooltip { opacity: 1; }

        /* --- PREVIEW NAV SETTINGS --- */
        body.disable-preview-nav .hotzone,
        body.disable-preview-nav .seek-container { display: none !important; }

        /* --- TAGS & QUEUE TRIGGERS --- */
        .tag-trigger, .queue-trigger { width: 18%; position: absolute; background: rgba(31,31,31,0.5); color: #fff; font-size: 10px; font-weight: 700; padding: 4px 0px; }
        .tag-trigger { border-radius: .3em 0 .3em 0; z-index: 50; cursor: default; }
        .tag-trigger::after { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
        .tag-trigger:hover::after { width: 275%; background: #404040; border-radius: .3em 0 .3em 0; z-index:-1; }
        .queue-trigger { right: 0; border-radius: 0 .3em 0 .3em; z-index: 50; cursor: pointer; }
        .queue-trigger:hover, .tag-trigger:hover { background: #404040; }
        .queue-trigger.in-queue { background: #5b26ed; }
        body:not(.f-tags) .tag-trigger { display: none !important; }
        body:not(.f-queue) .queue-trigger { display: none !important; }

        /* --- TAG POPUP --- */
        .tag-popup { opacity: 0; pointer-events: none; transition: opacity 0.2s ease; position: absolute; top: 22px; left: 0px; width: 100%; max-height: 80%; overflow-y: auto; overscroll-behavior: contain; background: #1f1f1f; border-radius: 0 0 .3em .3em; padding: 2px 2px 10px; z-index: 60; cursor: default; font-weight: bold; text-align: left; }
        .tag-trigger:hover + .tag-popup, .tag-popup:hover { opacity: 1; pointer-events: auto; }
        .tag-category { margin-bottom: 2px; margin-top: 6px; font-size: 10px; text-transform: uppercase; }
        .tag-pill { display: inline-block; background: #4d4d4d; padding: .13em .39em; margin: 1px; border-radius: .3em; font-size: 12px; }
        .tag-pill.tier-mythic { border: 1px solid #b655f7; color: #d6a0fb; text-shadow: 0 0 5px rgba(168, 85, 247, 0.8); }
        .tag-pill.tier-rare { border: 1px solid #eab308; color: #fef08a; }
        .tag-pill.tier-uncommon { border: 1px solid #0740EB; }
        .tag-pill.style-lgbt { border: none !important; background-image: linear-gradient(144deg, rgba(231, 0, 0, 1) 0%, rgba(255, 140, 0, 1) 20%, rgba(255, 239, 0, 1) 40%, rgba(0, 129, 31, 1) 60%, rgba(0, 68, 255, 1) 80%, rgba(118, 0, 137, 1) 100%); color: #000000 !important; font-weight: 900; text-shadow: 0 0 2px rgba(255,255,255,0.8); }
        @media (max-width: 600px) {
        .tag-pill { font-size: 11px; }
        .tag-trigger::after { display: none; }
        .tag-trigger, .queue-trigger { width: 21%; padding: 6px 0px; }}

        /* --- READER STYLES --- */
        #image-container { cursor: default; }
        .exit-fs-indicator { display: none; }
        :fullscreen .exit-fs-indicator { display: block; position: fixed; top: 0; left: 50%; transform: translateX(-50%); font-size: 40px; cursor: pointer; transition: transform 0.2s, opacity 0.2s, color 0.2s; padding: 20px 65px; opacity: 0; }
        :fullscreen .exit-fs-indicator:hover { color: #ed2553; transform: translateX(-50%) scale(1.4); opacity: 1; }
        .reader-bar:last-of-type .reader-buttons-right .zoom-buttons, .reader-bar:last-of-type .reader-buttons-right .reader-settings { display: none !important; }
        @media (max-width: 600px) {
            .reader-bar:last-of-type { flex-wrap: wrap !important; height: auto !important; padding-bottom: 8px !important; gap: 5px; }
            .reader-bar:last-of-type .reader-buttons-right { width: 100% !important; justify-content: center !important; padding-top: 8px; }
            .reader-bar:last-of-type .reader-buttons-right .btn { background: #4d4d4d; border-radius: 5px; }
        }

        /* --- SMART NAVIGATION & PAGINATION --- */
        .smart-nav-bar { position: fixed; bottom: 0; left: 0; height: 12px; background: #ed2553; width: 0%; z-index: 9999; transition: width 0.1s linear; pointer-events: none; }
        body.is-gallery-page #content { padding-bottom: 200px !important; }
        @media (min-width: 1300px) {
            body.is-gallery-page .pagination { position: fixed !important; top: 50% !important; transform: translateY(-50%) !important; display: flex !important; flex-direction: column !important; z-index: 4; left: 8px !important; right: auto !important; }
            body.is-gallery-page a.first, body.is-gallery-page a.previous, body.is-gallery-page a.last, body.is-gallery-page a.next { transform: rotate(90deg); }
            body.f-pag-right.is-gallery-page .pagination { left: auto !important; right: 16px !important; }
        }

        /* --- TAG SELECTOR & QUEUE BTN --- */
        @media (min-width: 1300px) { #info { width: 580px; } }
        .btn-tag-selector { background: #4d4d4d !important; }
        .btn-queue-add { background: #5b26ed !important; }
        .btn-tag-selector:hover{ background: #595959 !important; }
        .btn-queue-add:hover { background: #7f55f1 !important; }
        .tag-container .tag.tag-selected .name { background: #3d643f !important; opacity: 1 !important; }
        .tags-selecting-mode .tag:not(.tag-selected) { opacity: .5; }
        body:not(.f-queue) .btn-queue-add, body:not(.f-queue) .btn-next-queue { display: none !important; }
        body:not(.f-tag-select) .btn-tag-selector { display: none !important; }
        body.tag-select-active #info > :not(#tags):not(.buttons), body.tag-select-active #cover { display: none !important; }
        body.tag-select-active #info-block, body.tag-select-active #info {width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }

        /* --- QUEUE --- */
        .queue-dock { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; align-items: flex-end; z-index: 160; pointer-events: none; }
        body:not(.f-queue) .queue-dock { display: none !important; }
        .queue-toggle-btn { padding: .7em; border-radius: 5px; background: #1a1a1a; color: #fff; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; pointer-events: auto; }
        .queue-toggle-btn:hover { background: #333; }
        .queue-toggle-btn.active { background: #2e2e2e; }
        .queue-count { position: absolute; user-select: none; top: -2px; right: 0px; background: #5b26ed; color: #fff; font-size: 10px; font-weight: bold; width: 20px; height: 20px; border-radius: .3em; display: flex; align-items: center; justify-content: center; }
        .queue-panel { background: #1f1f1f; max-width: 95vw; width: 350px; border-radius: 5px; overflow: hidden; margin-bottom: 10px; box-shadow: 0 0 5px rgba(0,0,0,.5); display: block; visibility: hidden; opacity: 0; transform: translateX(100%); transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s; pointer-events: auto; }
        .queue-panel.is-visible { visibility: visible; opacity: 1; transform: translateX(0); }
        .queue-header, .queue-dock-pagination { padding: 10px; background: #383838; display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
        .queue-header-actions .is-hidden { display: none !important; }
        .queue-btn-action, .queue-dock-btn { cursor: pointer; user-select: none; font-size: 12px; color: #fff !important; background: #4d4d4d; padding: 4px 10px; border-radius: 3px; }
        .queue-dock-btn { border: none; padding: 4px 18px; }
        .queue-btn-action:hover, .queue-dock-btn:hover:not(:disabled) { background: #595959; }
        .queue-done { background: #ed2553; }
        .queue-done:hover { background: #f15478; }
        .queue-dock-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .queue-list { display: grid; grid-template-columns: repeat(4, 1fr); scrollbar-width: none; touch-action: pan-y; touch-action: pan-x; gap: 6px; padding: 8px; max-height: 430px; overflow-y: auto; overscroll-behavior: contain; margin: 0; list-style: none; content-visibility: auto; contain-intrinsic-size: 430px; }
        .queue-item { border-radius: .3em; background: #404040; animation: queue-fade-in 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .queue-item:hover { background: #3d643f; }
        .queue-image-wrapper { position: relative; display: block; border-radius: .3em .3em 0 0; overflow: hidden; }
        .queue-item img { width: 100%; aspect-ratio: 100/141; object-fit: cover; display: block; content-visibility: auto; contain-intrinsic-size: 111.38px; }
        .queue-id { font-size: 11px; padding: 3px; }
        .queue-remove { position: absolute; top: 0; right: 0; background: rgba(31, 31, 31, .5); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; font-size: 24px; }
        .queue-list:not(.is-editing) .queue-remove { display: none; }
        .queue-list.is-editing .queue-item { background: #404040 !important; }
        .queue-list.is-editing .queue-item:hover { background: rgba(100, 61, 61, .9) !important; }
        .queue-list.is-editing .queue-item img { opacity: 0.6; filter: grayscale(40%); }
        .queue-list.is-editing .cover-link { pointer-events: none; }
        @keyframes queue-fade-in {
            0% { transform: translateY(20px); }
            100% { transform: translateY(0); }
        }
        @media (max-width: 1200px) {
        .btn-q-tool, .q-discover, .q-sort-label { font-size: 16px; }
        .q-discover { min-width: 121px !important }
        .queue-dock { bottom: 0; right: 0; }
        .queue-toggle-btn { font-size: 20px;; border-radius: 5px 0 0 0; }
        .queue-toggle-btn:hover, .queue-toggle-btn.active { background: #1a1a1a; }
        .queue-panel { margin-right: 10px; }
        .queue-list.is-editing .queue-item:hover { background: #404040 !important; }
        @keyframes queue-fade-in {
            0% { transform: translateX(10px); }
            100% { transform: translateX(0); }
        }
        }

        /* --- QUEUE PAGE --- */
        .queue-empty { padding: 20px; text-align: center; color: #666; font-size: 12px; font-style: italic; }
        .queue-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; margin-top: -15px; margin-bottom: -4px; }
        .queue-group { display: flex; margin: 10px; flex-wrap: wrap;}
        .queue-group.segmented { border-radius: 5px; overflow: hidden; }
        .queue-group.segmented .btn-q-tool { border-radius: 0; }
        .queue-group.segmented .btn-q-tool + .btn-q-tool { border-left: 1px solid #0d0d0d; }
        .queue-group.segmented .q-sort-label + .btn-q-tool { border-left: 1px solid #0d0d0d; }
        .btn-q-tool, .q-sort-label, .q-discover { background: #1a1a1a; color: #d9d9d9; border: none; border-radius: 5px; padding: .5em; font-size: 20px; line-height: 1.42857143; cursor: pointer; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; }
        .btn-q-tool::after { content: attr(data-text); font-weight: bold; height: 0; visibility: hidden; overflow: hidden; user-select: none; pointer-events: none; }
        .btn-q-tool.active { background: #2e2e2e; font-weight: bold; }
        .q-sort-label { border-radius: 0; cursor: default; }
        .q-discover {background: linear-gradient(45deg, #5b26ed, #ed2553); min-width: 151px; }
        .btn-q-tool:hover { background: #333; }

        /* --- SAVED SEARCHES STYLES  --- */
        .search-saved-trigger { position: absolute; right: 45px; top: 0; height: 100%; width: 35px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #888; z-index: 5; }
        .search-saved-trigger:hover, .search-saved-trigger.is-active { color: #999; }
        .saved-search-extension { position: relative; width: 100%; background: #1f1f1f; box-sizing: border-box; z-index: 5; display: block; overflow: hidden; max-height: 0; contain: layout paint; }
        .saved-search-extension.is-visible { max-height: 500px; }
        .sse-inner { padding: 0 20px; opacity: 0; transform: translateY(-5%); transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .saved-search-extension.is-visible .sse-inner { opacity: 1; transform: translateY(0); }
        .sse-header { display: flex; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #2e2e2e; padding: 8px 0; flex-wrap: wrap; }
        .sse-actions { margin-left: auto; }
        .btn-sse-save, .btn-sse-edit { background: #4d4d4d; color: #fff; border: none; padding: 0 12px; border-radius: 3px; line-height: 40px; cursor: pointer; font-weight: bold; }
        .btn-sse-save:hover, .btn-sse-edit:hover { background: #595959; }
        #btn-confirm-del, #btn-finish-reorder { background: #ed2553; }
        #btn-confirm-del:hover, #btn-finish-reorder:hover { background: #f15478; }
        .sse-empty { color: #999; font-style: italic; }
        .sse-list { display: flex; flex-wrap: wrap; gap: 8px; padding-bottom: 20px; padding-right: 5px; overflow-y: auto; overscroll-behavior: contain; max-height: 40vh; }
        .ss-pill { font-weight: 700; display: inline-flex; align-items: stretch; border-radius: .3em; overflow: hidden; }
        .ss-pill.is-current .ss-text { background: #3d643f; }
        .ss-part { padding: .13em .39em; cursor: pointer; display: flex; align-items: center; background: #4d4d4d }
        .ss-add { padding: .13em .69em; background: #333; color: grey; box-shadow: inset 0 0 .4em #2b2b2b; }
        .ss-add:hover { background: #404040; color: #fff; }
        .ss-text:hover { background: #595959; color: #fff; }
        .sse-list.delete-mode .ss-add, .sse-list.reorder-mode .ss-add { display: none }
        .ss-pill.to-delete .ss-text, .ss-separator.to-delete { background: #643d3d; color: #d9d9d9; text-decoration: line-through; }
        .sse-list.reorder-mode .ss-pill { cursor: grab; }
        .sse-list.reorder-mode .ss-pill:active, .sse-list.reorder-mode .ss-separator:active { cursor: grabbing; }
        .sse-list.reorder-mode .ss-text { pointer-events: none; }
        .ss-pill.is-dragging, .ss-separator.is-dragging { opacity: 0.4; transform: scale(0.90); transition: transform 0.2s; }
        .ss-pill.is-pressing, .ss-separator.is-pressing { transform: scale(0.95); transition: transform 0.2s; opacity: 0.8; }
        .ss-pill.drag-over { box-shadow: 5px 5px #ed2553; }
        .ss-separator { flex-basis: 100%; height: 2px; background: #2e2e2e; margin: 4px 0; position: relative; }
        .sse-list.reorder-mode .ss-separator { cursor: grab; height: 12px; background: transparent; border: 1px dashed #555; }
        .ss-separator.drag-over { border: 2px solid #ed2553 !important; }
        .sse-list.delete-mode .ss-separator { cursor: pointer; height: 8px; }
        body:not(.f-saved-search) .search-saved-trigger,
        body:not(.f-saved-search) .saved-search-extension { display: none !important; }
        @media (max-width: 600px) { .sse-list { max-height: 410px; } }

        /* --- SEARCH SHORTCUT HINT --- */
        .search-slash-hint { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #999; font-size: 12px; pointer-events: none; font-family: Consolas, monospace; }
        form.search input:focus ~ .search-slash-hint, form.search input:not(:placeholder-shown) ~ .search-slash-hint { opacity: 0; }
        form.search { position: relative; }
        @media (max-width: 1000px) { .search-slash-hint { opacity: 0 } }

        /* --- SETTINGS PAGE STYLES --- */
        .settings-container { max-width: 800px; margin: 0 auto; }
        .settings-item { display: flex; justify-content: space-between; align-items: center; padding: 20px; text-align: left; }
        .settings-item:hover { background: #262626; }
        .settings-label { font-weight: bold; }
        .settings-desc { font-size: 0.8em; color: #888; margin-top: 4px; }
        .nh-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .nh-switch input { opacity: 0; width: 0; height: 0; }
        .nh-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #333; transition: .2s; border-radius: 24px; }
        .nh-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: #888; transition: .2s; border-radius: 50%; }
        input:checked + .nh-slider { background-color: #ed2553; }
        input:checked + .nh-slider:before { transform: translateX(20px); background-color: #fff; }
        .settings-actions { margin: 20px; display: flex; justify-content: end; flex-wrap: wrap; }
        .btn-setting-action { padding: 0px 12px; border: none; border-radius: 3px; line-height: 40px; cursor: pointer; font-weight: bold; color: #fff; background: #4d4d4d; margin: 3px; }
        .btn-setting-action:hover { background: #595959; }
        #btn-sync-favs { background: #ed2553; margin-right: auto; min-width: 124px; }
        #btn-sync-favs:hover { background: #f15478; }
        @media (max-width: 600px) {
        .settings-actions { margin: 5px; justify-content: center; }
        #btn-sync-favs { margin-right: 3px; }
        .settings-desc { max-width: 60vw; }
        .settings-item { padding: 15px 5px; }
        }

    `;

    (typeof GM_addStyle !== "undefined") ? GM_addStyle(css) : document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

    // ==========================================================================
    // 2. QUEUE LOGIC
    // ==========================================================================

    function saveQueue() {
        updateQueueWidget();
        updateAllQueueButtons();

        clearTimeout(saveQueueTimeout);
        saveQueueTimeout = setTimeout(() => {
            localStorage.setItem('nhentai_queue_v1', JSON.stringify(readingQueue));
        }, 1000);
    }

    function toggleQueueItem(id, title, coverUrl, galleryUrl) {
        const index = readingQueue.findIndex(i => i.id == id);

        if (index > -1) {
            readingQueue.splice(index, 1);
        } else {
            const newItem = { id, title, coverUrl, galleryUrl, addedAt: Date.now() };

            readingQueue.push(newItem);

            if (currentSortMode === 'newest') {
                readingQueue.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
            } else if (currentSortMode === 'oldest') {
                readingQueue.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
            }
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
            if (window.location.search.includes('view=queue')) renderQueuePage();
        }
    }

    function updateAllQueueButtons() {
        if (!settings.enableQueue) return;

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

            if (gallery.updateMarkersFn) {
                gallery.updateMarkersFn();
            }
        });

        const pageBtn = document.querySelector('.btn-queue-add');
        if (pageBtn) {
            const id = window.location.href.match(/\/g\/(\d+)/)?.[1];
            if (id && isQueued(id)) {
                pageBtn.innerHTML = '<i class="far fa-clock"></i> Remove';
                pageBtn.classList.add('in-queue');
            } else {
                pageBtn.innerHTML = '<i class="fa fa-clock"></i> Queue';
                pageBtn.classList.remove('in-queue');
            }
        }
    }

    function updateQueueWidget() {
        if (!settings.enableQueue) return;

        const list = document.querySelector('.queue-list');
        const count = document.querySelector('.queue-count');
        const paginationContainer = document.querySelector('.queue-dock-pagination');
        if (!list || !count) return;

        const totalItems = readingQueue.length;
        count.textContent = totalItems;
        count.style.display = totalItems > 0 ? 'flex' : 'none';

        if (totalItems === 0) {
            list.innerHTML = '<li style="grid-column: 1 / -1; padding: 20px; color: #999; font-size: 12px; font-style: italic;">Queue is empty.<p>Looking for inspiration?</p></li>';
            if (paginationContainer) paginationContainer.style.display = 'none';
            return;
        }

        const totalPages = Math.ceil(totalItems / DOCK_ITEMS_PER_PAGE);

        if (dockCurrentPage > totalPages) dockCurrentPage = Math.max(1, totalPages);

        const startIdx = (dockCurrentPage - 1) * DOCK_ITEMS_PER_PAGE;
        const currentItems = readingQueue.slice(startIdx, startIdx + DOCK_ITEMS_PER_PAGE);

        list.innerHTML = currentItems.map(item => `
            <li class="queue-item" data-id="${item.id}">
              <div class="queue-image-wrapper">
                <div class="queue-remove" data-id="${item.id}"><i class="fa fa-times"></i></div>
                <a href="${item.galleryUrl}" class="cover-link">
                    <img src="${item.coverUrl}" loading="lazy">
                </a>
              </div>
                <a title="${item.title}">
                    <div class="queue-id">#${item.id}</div>
                </a>
            </li>
        `).join('');

        if (paginationContainer) {
            if (totalPages > 1) {
                paginationContainer.style.display = 'flex';
                paginationContainer.innerHTML = `
                    <button class="queue-dock-btn queue-dock-prev" ${dockCurrentPage === 1 ? 'disabled' : ''}><i class="fa fa-chevron-left"></i></button>
                    <span class="queue-page-info">${dockCurrentPage} / ${totalPages}</span>
                    <button class="queue-dock-btn queue-dock-next" ${dockCurrentPage === totalPages ? 'disabled' : ''}><i class="fa fa-chevron-right"></i></button>
                `;
            } else {
                paginationContainer.style.display = 'none';
            }
        }
    }

    function initQueueWidget() {
        if (!settings.enableQueue) return;
        if (isReader) return;
        if (document.querySelector('.queue-dock')) return;

        const dock = document.createElement('div');
        dock.className = 'queue-dock';

        dock.innerHTML = `
            <div class="queue-panel">
                <div class="queue-header">
                    <span>Reading queue</span>
                    <div class="queue-header-actions">
                        <span class="queue-btn-action queue-edit-mode">Edit</span>
                        <a href="/?view=queue" class="queue-btn-action queue-view-full">View Page</a>
                        <span class="queue-btn-action queue-done is-hidden">Save</span>
                        <span class="queue-btn-action queue-clear is-hidden">Clear All</span>
                    </div>
                </div>
                <ul class="queue-list"></ul>
                <div class="queue-dock-pagination" style="display: none;"></div>
            </div>
            <div class="queue-toggle-btn" title="Toggle Queue">
                <i class="fa fa-clock"></i>
                <div class="queue-count">0</div>
            </div>
        `;

        document.body.appendChild(dock);

        const toggle = dock.querySelector('.queue-toggle-btn');
        const panel = dock.querySelector('.queue-panel');
        const list = dock.querySelector('.queue-list');
        const paginationContainer = dock.querySelector('.queue-dock-pagination');

        const viewBtn = dock.querySelector('.queue-view-full');
        const editBtn = dock.querySelector('.queue-edit-mode');
        const clearBtn = dock.querySelector('.queue-clear');
        const doneBtn = dock.querySelector('.queue-done');

        let isEditingQueue = false;
        const toggleEditMode = (forceState = null) => {
            isEditingQueue = forceState !== null ? forceState : !isEditingQueue;
            if (isEditingQueue) {
                list.classList.add('is-editing');
                editBtn.classList.add('is-hidden');
                viewBtn.classList.add('is-hidden');
                clearBtn.classList.remove('is-hidden');
                doneBtn.classList.remove('is-hidden');
            } else {
                list.classList.remove('is-editing');
                editBtn.classList.remove('is-hidden');
                viewBtn.classList.remove('is-hidden');
                clearBtn.classList.add('is-hidden');
                doneBtn.classList.add('is-hidden');
            }
        };

        editBtn.onclick = () => toggleEditMode(true);
        doneBtn.onclick = () => toggleEditMode(false);
        clearBtn.onclick = () => { clearQueue(); toggleEditMode(false); };

        list.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.queue-remove');
            if (removeBtn) {
                e.stopPropagation();
                const id = removeBtn.dataset.id;
                toggleQueueItem(id);

                if (readingQueue.length === 0) toggleEditMode(false);
            }
        });

        paginationContainer.addEventListener('click', (e) => {
            if (e.target.closest('.queue-dock-prev')) {
                if (dockCurrentPage > 1) {
                    dockCurrentPage--;
                    updateQueueWidget();
                    list.scrollTop = 0;
                }
            } else if (e.target.closest('.queue-dock-next')) {
                const totalPages = Math.ceil(readingQueue.length / DOCK_ITEMS_PER_PAGE);
                if (dockCurrentPage < totalPages) {
                    dockCurrentPage++;
                    updateQueueWidget();
                    list.scrollTop = 0;
                }
            }
        });

        let isScrollOnCooldown = false;

        list.addEventListener('wheel', (e) => {
            e.preventDefault();

            if (isScrollOnCooldown) return;

            const totalPages = Math.ceil(readingQueue.length / DOCK_ITEMS_PER_PAGE);
            if (totalPages <= 1) return;

            isScrollOnCooldown = true;

            if (e.deltaY > 0) {
                if (dockCurrentPage < totalPages) {
                    dockCurrentPage++;
                    updateQueueWidget();
                }
            } else if (e.deltaY < 0) {
                if (dockCurrentPage > 1) {
                    dockCurrentPage--;
                    updateQueueWidget();
                }
            }
            setTimeout(() => { isScrollOnCooldown = false; }, 300);

        }, { passive: false });

        let touchStartX = 0;
        let touchStartY = 0;

        list.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        list.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;

            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) {
                const totalPages = Math.ceil(readingQueue.length / DOCK_ITEMS_PER_PAGE);

                if (deltaX < 0) {
                    if (dockCurrentPage < totalPages) {
                        dockCurrentPage++;
                        updateQueueWidget();
                    }
                } else {
                    if (dockCurrentPage > 1) {
                        dockCurrentPage--;
                        updateQueueWidget();
                    }
                }
            }
        }, { passive: true });

        toggle.onclick = (e) => {
            const isVisible = panel.classList.toggle('is-visible');
            toggle.classList.toggle('active', isVisible);

            if (!isVisible) toggleEditMode(false);

            if (isVisible) {
                const currentId = window.location.pathname.match(/\/g\/(\d+)/)?.[1];

                if (currentId) {
                    const itemIndex = readingQueue.findIndex(item => item.id === currentId);

                    if (itemIndex > -1) {
                        const targetPage = Math.floor(itemIndex / DOCK_ITEMS_PER_PAGE) + 1;

                        if (dockCurrentPage !== targetPage) {
                            dockCurrentPage = targetPage;
                            updateQueueWidget();
                        }

                        const activeItem = list.querySelector(`.queue-item[data-id="${currentId}"]`);

                        if (activeItem) {
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    activeItem.scrollIntoView;
                                    const originalBg = activeItem.style.background;
                                activeItem.style.background = '#3d643f';
                                });
                            });
                        }
                    }
                }
            }
        };

        updateQueueWidget();
    }

    function createPagination(totalItems, currentPage, itemsPerPage) {
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        if (totalPages <= 1) return '';

        let html = '<section class="pagination">';

        if (currentPage > 1) {
            html += `<a href="/?view=queue&page=1" class="first"><i class="fa fa-chevron-left"></i><i class="fa fa-chevron-left"></i></a>`;
            html += `<a href="/?view=queue&page=${currentPage - 1}" class="previous"><i class="fa fa-chevron-left"></i></a>`;
        }

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || (i >= currentPage - 5 && i <= currentPage + 5)) {
                const isCurrent = i === currentPage ? 'current' : '';
                html += `<a href="/?view=queue&page=${i}" class="page ${isCurrent}">${i}</a>`;
            }
        }

        if (currentPage < totalPages) {
            html += `<a href="/?view=queue&page=${currentPage + 1}" class="next"><i class="fa fa-chevron-right"></i></a>`;
            html += `<a href="/?view=queue&page=${totalPages}" class="last"><i class="fa fa-chevron-right"></i><i class="fa fa-chevron-right"></i></a>`;
        }

        html += '</section>';
        return html;
    }

    function applyQueueSort(mode) {
        currentSortMode = mode;
        localStorage.setItem('nhentai_queue_sort', mode);

        if (mode === 'shuffle') {
            for (let i = readingQueue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [readingQueue[i], readingQueue[j]] = [readingQueue[j], readingQueue[i]];
            }
        } else if (mode === 'newest') {
            readingQueue.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        } else if (mode === 'oldest') {
            readingQueue.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        }

        saveQueue();
        renderQueuePage();
    }

    function renderQueuePage() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('view') !== 'queue') return;

        document.title = "Reading Queue";
        const content = document.getElementById('content');
        if (!content) return;
        content.innerHTML = '';

        const ITEMS_PER_PAGE = 25;
        const currentPage = parseInt(params.get('page')) || 1;
        const totalItems = readingQueue.length;

        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        const currentItems = readingQueue.slice(startIndex, endIndex);

        const header = document.createElement('div');
        header.innerHTML = `
            <h1>
                <span>
                <i class="fa fa-clock color-icon"></i> Reading queue
                </span>
                <span class="count">(${totalItems})</span>
            </h1>
        `;
        content.appendChild(header);

        if (totalItems >= 0) {
            const toolbar = document.createElement('div');
            toolbar.className = 'queue-toolbar';

            const leftGroup = document.createElement('div');
            leftGroup.className = 'queue-group';
            leftGroup.className = 'queue-group segmented';

            const rightGroup = document.createElement('div');
            rightGroup.className = 'queue-group right';

            const buttons = [
                { id: 'newest', label: 'newest' },
                { id: 'oldest', label: 'oldest' },
                { id: 'shuffle', label: 'shuffle' }
            ];

            if (totalItems > 1) {
                const sortLabel = document.createElement('span');
                sortLabel.className = 'q-sort-label';
                sortLabel.textContent = 'Sort:';
                leftGroup.appendChild(sortLabel);

                buttons.forEach(btn => {
                    const buttonEl = document.createElement('button');
                    const isActive = currentSortMode === btn.id ? 'active' : '';
                    buttonEl.className = `btn-q-tool ${isActive}`;
                    buttonEl.setAttribute('data-text', btn.label);
                    buttonEl.innerHTML = `${btn.label}`;
                    buttonEl.onclick = () => applyQueueSort(btn.id);
                    leftGroup.appendChild(buttonEl);
                });
            }

            const discoverBtn = document.createElement('button');
            discoverBtn.className = 'q-discover';
            discoverBtn.innerHTML = 'Discover & Fill';
            discoverBtn.title = "Let the script pick new galleries for your queue based on your favorites.";

            discoverBtn.onclick = async (e) => {
                const originalText = 'Discover & Fill';
                const allButtons = toolbar.querySelectorAll('button');

                allButtons.forEach(btn => {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'not-allowed';
                });

                discoverBtn.style.opacity = '1';

                try {
                    await runDiscoverFlow((status) => {
                        discoverBtn.innerHTML = `${status}`;
                    });

                    discoverBtn.innerHTML = 'Completed';
                    discoverBtn.style.background = '#3c763d';

                    setTimeout(() => {
                        renderQueuePage()
                    }, 1000);

                } catch (err) {
                    console.error(err);
                    discoverBtn.innerHTML = 'Login required';
                    discoverBtn.style.background = '#a94442';

                    setTimeout(() => {
                        discoverBtn.innerHTML = originalText;
                        discoverBtn.style.background = 'linear-gradient(45deg, #5b26ed, #ed2553)';

                        allButtons.forEach(btn => {
                            btn.disabled = false;
                            btn.style.opacity = '1';
                            btn.style.cursor = 'pointer';
                        });
                    }, 3000);
                }
            };

            rightGroup.appendChild(discoverBtn);
            toolbar.appendChild(leftGroup);
            toolbar.appendChild(rightGroup);
            content.appendChild(toolbar);
        }

        const grid = document.createElement('div');
        grid.className = 'container index-container';

        if (totalItems === 0) {
            grid.innerHTML = '<div style="padding: 50px; text-align: center; font-size: 18px; color: #666;">Your queue is empty.<p>Time to find some inspiration for the task ahead.</p></div>';
        } else {
            const fragment = document.createDocumentFragment();

            currentItems.forEach(item => {
                const galleryDiv = document.createElement('div');
                galleryDiv.className = 'gallery';
                galleryDiv.setAttribute('data-gid', item.id);

                const defaultPadding = '145.6%';

                galleryDiv.innerHTML = `
                    <a href="${item.galleryUrl}" class="cover" style="padding:0 0 ${defaultPadding} 0; position: relative; display: block;">
                        <img class="lazyload"
                             src="${item.coverUrl}"
                             data-src="${item.coverUrl}"
                             loading="lazy"
                             style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" />
                        <div class="caption">${item.title}</div>
                    </a>
                `;

                const img = galleryDiv.querySelector('img');
                const setRatio = function() {
                    if (this.naturalWidth && this.naturalHeight) {
                        const aspectRatio = (this.naturalHeight / this.naturalWidth) * 100;
                        const coverLink = galleryDiv.querySelector('.cover');
                        coverLink.style.padding = `0 0 ${aspectRatio}% 0`;
                        this.onload = null;
                    }
                };

                img.onload = setRatio;
                if (img.complete) setRatio.call(img);

                fragment.appendChild(galleryDiv);
            });

            grid.appendChild(fragment);
        }

        content.appendChild(grid);

        if (totalItems > ITEMS_PER_PAGE) {
            const paginationHTML = createPagination(totalItems, currentPage, ITEMS_PER_PAGE);
            const pagContainer = document.createElement('div');
            pagContainer.innerHTML = paginationHTML;
            content.appendChild(pagContainer);
        }

        if (typeof initPreviewUI === 'function') {
            grid.querySelectorAll('.gallery').forEach(initPreviewUI);
        }
    }

    function areTitlesSimilar(title1, title2) {
        const tokenize = (str) => {
            return new Set(
                str.toLowerCase()
                   .replace(/[\(\[\{].*?[\)\]\}]/g, '')
                   .replace(/[^\w\s]|_/g, "")
                   .split(/\s+/)
                   .filter(w => w.length > 2)
            );
        };

        const t1 = tokenize(title1);
        const t2 = tokenize(title2);

        if (t1.size < 2 || t2.size < 2) return false;

        let matches = 0;
        t1.forEach(word => {
            if (t2.has(word)) matches++;
        });

        const minSize = Math.min(t1.size, t2.size);
        const similarity = matches / minSize;

        return similarity >= 0.75;
    }

    async function runDiscoverFlow(updateStatus) {
        const IGNORE_TAGS = [
            'sole male', 'sole female', 'males only', 'big breasts', 'nakadashi', 'ahegao',
            'full color', 'full censorship', 'uncensored', 'mosaic censorship',
        ];

        updateStatus("Processing…");
        const p1Response = await fetch('/favorites/');
        const p1Html = await p1Response.text();

        if (p1Html.includes('login_form')) throw new Error("Not logged in");

        const parser = DOM_PARSER;
        const doc1 = parser.parseFromString(p1Html, 'text/html');

        let totalPages = 1;
        const lastPageBtn = doc1.querySelector('.pagination .last');

        if (lastPageBtn) {
            const match = lastPageBtn.href.match(/page=(\d+)/);
            if (match) totalPages = parseInt(match[1], 10);
        } else {
            const pages = doc1.querySelectorAll('.pagination .page');
            if (pages.length > 0) {
                const lastNum = pages[pages.length - 1].textContent;
                if (!isNaN(lastNum)) totalPages = parseInt(lastNum, 10);
            }
        }

        let targetHtml = p1Html;
        if (totalPages > 1) {
            const randomPage = Math.floor(Math.random() * totalPages) + 1;
            if (randomPage > 1) {
                const randomResp = await fetch(`/favorites/?page=${randomPage}`);
                targetHtml = await randomResp.text();
            }
        }

        const targetDoc = parser.parseFromString(targetHtml, 'text/html');
        const favGalleries = Array.from(targetDoc.querySelectorAll('.gallery a.cover'))
            .map(a => a.href.match(/\/g\/(\d+)/)?.[1])
            .filter(Boolean);

        if (favGalleries.length === 0) throw new Error("No favorites found on this page");

        const sampleSize = Math.min(5, favGalleries.length);
        const shuffledFavs = favGalleries.sort(() => 0.5 - Math.random()).slice(0, sampleSize);

        const tagCounts = {};

        await Promise.all(shuffledFavs.map(async (id) => {
            const meta = await getMeta(id);
            if (meta && meta.tags) {
                meta.tags.forEach(t => {
                    if (t.type === 'tag' && !IGNORE_TAGS.includes(t.name)) {
                        tagCounts[t.name] = (tagCounts[t.name] || 0) + 1;
                    }
                });
            }
        }));

        const sortedTags = Object.entries(tagCounts)
            .sort(([,a], [,b]) => b - a)
            .map(([tag]) => tag);

        if (sortedTags.length === 0) throw new Error("Not enough data");

        const topTags = sortedTags.slice(0, 2);
        const spiceTag = sortedTags.slice(2, 10)[Math.floor(Math.random() * Math.min(8, sortedTags.length - 2))];
        if (spiceTag) topTags.push(spiceTag);

        const queryStr = topTags.map(t => `tag:"${t}"`).join(' ');
        const encodedQuery = encodeURIComponent(queryStr);


        const [resWeek, resAll] = await Promise.all([
            fetch(`/search/?q=${encodedQuery}+uploaded%3A%3E6d&sort=popular-week`),
            fetch(`/search/?q=${encodedQuery}&sort=popular`)
        ]);

        const htmlWeek = await resWeek.text();
        const htmlAll = await resAll.text();

        const parseGalleries = (html) => {
            const doc = parser.parseFromString(html, 'text/html');
            return Array.from(doc.querySelectorAll('.gallery')).map(gal => {
                const link = gal.querySelector('a.cover');
                const id = gal.dataset.id || (link.href.match(/\/g\/(\d+)/) || [])[1];
                const title = gal.querySelector('.caption').textContent;
                const img = gal.querySelector('img');
                const coverUrl = img.dataset.src || img.src;
                return { id, title, coverUrl, galleryUrl: link.href };
            });
        };

        const candidatesWeek = parseGalleries(htmlWeek);
        const candidatesAll = parseGalleries(htmlAll);

        const newItems = [];
        const processedIds = new Set();
        readingQueue.forEach(q => processedIds.add(String(q.id)));

        const tryAddCandidate = async (candidate) => {
            if (!candidate) return false;

            if (processedIds.has(String(candidate.id))) return false;

            const allTitles = [...readingQueue, ...newItems];

            const isTitleDup = allTitles.some(item => areTitlesSimilar(item.title, candidate.title));

            if (isTitleDup) {
                console.log(`Skipping ${candidate.id} (Similar Title: "${candidate.title}")`);
                return false;
            }

            processedIds.add(String(candidate.id));

            const isFav = favCache.has(String(candidate.id));
            if (isFav) {
                console.log(`Skipping ${candidate.id} (Already in Fav Cache)`);
                return false;
            }

            newItems.push(candidate);
            return true;
        };

        let weekAdded = 0;
        let allTimeAdded = 0;
        let attempts = 0;

        while (newItems.length < 5 && attempts < 30) {
            attempts++;

            let success = false;

            if (weekAdded < 3 && candidatesWeek.length > 0) {
                const cand = candidatesWeek.shift();
                success = await tryAddCandidate(cand);
                if (success) weekAdded++;
            } else if (candidatesAll.length > 0) {
                const cand = candidatesAll.shift();
                success = await tryAddCandidate(cand);
                if (success) allTimeAdded++;
            } else if (candidatesWeek.length > 0) {
                const cand = candidatesWeek.shift();
                success = await tryAddCandidate(cand);
                if (success) weekAdded++;
            } else {
                break;
            }
        }

        if (newItems.length === 0) throw new Error("No new galleries found");

        newItems.forEach(item => {
            toggleQueueItem(item.id, item.title, item.coverUrl, item.galleryUrl);
        });

        await new Promise(r => setTimeout(r, 1000));
    }

    // ==========================================================================
    // 3. FAVORITES MANAGER
    // ==========================================================================

    function saveFavCache() {
        localStorage.setItem('nhentai_flow_favs', JSON.stringify([...favCache]));
    }

    function addFav(id) {
        if (!favCache.has(String(id))) {
            favCache.add(String(id));
            saveFavCache();
            updateAllMarkers();
        }
    }

    function removeFav(id) {
        if (favCache.has(String(id))) {
            favCache.delete(String(id));
            saveFavCache();
            updateAllMarkers();
        }
    }

    function updateAllMarkers() {
        document.querySelectorAll('.gallery').forEach(g => {
             if (g.updateMarkersFn) g.updateMarkersFn();
        });
    }

    function initFavoritesPage() {
        if (window.location.pathname.includes('/favorites/')) {
            const galleries = document.querySelectorAll('.gallery');
            let count = 0;
            galleries.forEach(g => {
                const id = g.dataset.id || g.querySelector('a.cover').href.match(/\/g\/(\d+)/)[1];
                if (id) {
                    favCache.add(String(id));
                    count++;
                }
            });
            if (count > 0) {
                saveFavCache();
            }
        }
    }

    async function syncFavorites(updateStatus) {

        const p1Res = await fetch('/favorites/?page=1');
        const p1Html = await p1Res.text();

        if (p1Html.includes('login_form')) {
            throw new Error("Login required");
        }

        const parser = new DOMParser();
        const doc1 = parser.parseFromString(p1Html, 'text/html');

        let totalPages = 1;
        const lastPageBtn = doc1.querySelector('.pagination .last');
        if (lastPageBtn) {
            const match = lastPageBtn.href.match(/page=(\d+)/);
            if (match) totalPages = parseInt(match[1], 10);
        }

        const extractIds = (doc) => {
            const ids = [];
            doc.querySelectorAll('.gallery').forEach(g => {
                const id = g.dataset.id || g.querySelector('a.cover').href.match(/\/g\/(\d+)/)[1];
                if (id) ids.push(id);
            });
            return ids;
        };

        const initialIds = extractIds(doc1);
        initialIds.forEach(id => favCache.add(String(id)));
        saveFavCache();

        let totalAdded = initialIds.length;

        for (let i = 2; i <= totalPages; i++) {
            updateStatus(`${i}/${totalPages} (${totalAdded} IDs)`);

            await new Promise(r => setTimeout(r, 1000));

            try {
                const res = await fetch(`/favorites/?page=${i}`);
                const html = await res.text();
                const doc = parser.parseFromString(html, 'text/html');
                const ids = extractIds(doc);

                ids.forEach(id => favCache.add(String(id)));
                totalAdded += ids.length;
                saveFavCache();

            } catch (err) {
                console.error(`Error on page ${i}`, err);
            }
        }

        updateAllMarkers();
        return totalAdded;
    }

    // ==========================================================================
    // 4. PREVIEW LOGIC
    // ==========================================================================

    function getMeta(id) {
        if (cache.has(id)) return Promise.resolve(cache.get(id));

        return fetch(`/api/gallery/${id}`)
            .then(res => {
                if (!res.ok) throw new Error('API Error');
                return res.json();
            })
            .then(data => {
                const meta = {
                    id: data.media_id,
                    pages: data.images.pages,
                    total: data.num_pages,
                    tags: data.tags,
                    title: data.title.english || data.title.japanese || data.title.pretty,
                    cover_type: data.images.cover.t
                };

                if (cache.size >= CACHE_LIMIT) {
                    const oldestKey = cache.keys().next().value;
                    cache.delete(oldestKey);
                }

                cache.set(id, meta);
                return meta;
            })
            .catch(e => {
                console.error("NH Flow: Meta fetch failed", e);
                return null;
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
            if (['yaoi', 'males only', 'bara', 'yuri', 'females only', 'lesbian', 'futanari', 'tomgirl', 'otokonoko', 'dickgirl', 'shemale', 'bisexual'].includes(name)) return 'style-lgbt';
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
            if (!meta) return;

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

            if (!img.dataset.originalSrc) {
                img.dataset.originalSrc = img.src;
            }

            const loader = new Image();

            loader.onload = () => {
                if (state.req === reqId && hoveredGallery === gallery) {
                    img.style.aspectRatio = `${pageData.w}/${pageData.h}`;
                    img.src = src;
                }
                loader.onload = null;
                loader.onerror = null;
            };

            loader.onerror = () => {
                loader.onload = null;
                loader.onerror = null;
            };

            loader.src = src;
        });
    }

    function initPreviewUI(gallery) {
        const link = gallery.querySelector('a.cover');
        if (!link || gallery.dataset.init === '1') return;

        const id = link.href.match(/\/g\/(\d+)\//)?.[1];
        if (!id) return;

        gallery.dataset.gid = id;
        gallery.dataset.init = '1';

        // 1. Visual Markers
        const progressMarker = document.createElement('div');
        progressMarker.className = 'reading-marker marker-progress marker-yellow';
        progressMarker.style.display = 'none';
        progressMarker.innerHTML = `<span class="fa-stack"><i class="fas fa-bookmark fa-stack-2x"></i><strong class="fa-stack-1x pg-num" style="color: #fff; font-size: 11px !important; margin-top: -3px;"></strong></span>`;
        gallery.appendChild(progressMarker);

        const queueMarker = document.createElement('div');
        queueMarker.className = 'reading-marker marker-queue marker-blue';
        queueMarker.style.display = 'none';
        queueMarker.innerHTML = `<span class="fa-stack"><i class="fas fa-bookmark fa-stack-2x"></i><i class="fas fa-clock fa-stack-1x" style="color:#fff; font-size:10px; margin-top:-3px;"></i></span>`;
        gallery.appendChild(queueMarker);

        const favMarker = document.createElement('div');
        favMarker.className = 'reading-marker marker-fav marker-pink';
        favMarker.style.display = 'none';
        favMarker.innerHTML = `<span class="fa-stack"><i class="fas fa-bookmark fa-stack-2x"></i><i class="fas fa-heart fa-stack-1x" style="color:#fff; font-size:10px; margin:-3px 0 0 0;"></i></span>`;
        gallery.appendChild(favMarker);

        const ctx = {
            isQueue: new URLSearchParams(window.location.search).get('view') === 'queue',
            isFavorites: window.location.pathname.includes('/favorites')
        };

        const updateMarkers = () => {
            queueMarker.style.display = (!ctx.isQueue && settings.enableQueue && isQueued(id)) ? 'block' : 'none';
            favMarker.style.display = (!ctx.isFavorites && favCache.has(String(id))) ? 'block' : 'none';
            const state = states.get(id);
            if (state?.curr > 1) {
                progressMarker.style.display = 'block';
                progressMarker.querySelector('.pg-num').textContent = state.curr;
            } else {
                progressMarker.style.display = 'none';
            }
        };
        gallery.updateMarkersFn = updateMarkers;
        updateMarkers();

        let isUiInjected = false;

        // 2. Hover Events
        gallery.onmouseenter = () => {
            hoveredGallery = gallery;

            if (!gallery.dataset.fixedDimensions) {
                const rect = gallery.getBoundingClientRect();
                gallery.style.width = `${rect.width}px`;
                gallery.style.height = `${rect.height}px`;
                gallery.dataset.fixedDimensions = '1';
            }

            if (!isUiInjected) {
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
                if (isQueued(id)) { qBtn.classList.add('in-queue'); qBtn.innerHTML = '<i class="fa fa-check"></i>'; }

                qBtn.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const imgEl = gallery.querySelector('a.cover img');
                    const coverUrl = imgEl.dataset.src || imgEl.dataset.originalSrc || imgEl.src;

                    if (cache.has(id)) {
                        toggleQueueItem(id, cache.get(id).title, coverUrl, link.href);
                    } else {
                        qBtn.innerHTML = '<i class="fas fa-ellipsis-h"></i>';
                        getMeta(id).then(meta => {
                            if (!meta) { qBtn.innerHTML = '<i class="fa fa-exclamation"></i>'; return; }
                            toggleQueueItem(id, meta.title, coverUrl, link.href);
                        });
                    }
                    setTimeout(updateMarkers, 50);
                };

                const tagTrigger = ui.querySelector('.tag-trigger');
                if (tagTrigger) {
                    tagTrigger.addEventListener('click', stopEvent);
                    tagTrigger.addEventListener('touchstart', stopPropOnly, { passive: true });
                }

                const tagPopup = ui.querySelector('.tag-popup');
                if (tagPopup) {
                    tagPopup.addEventListener('click', stopEvent);
                    tagPopup.addEventListener('touchstart', stopPropOnly, { passive: true });
                }

                ui.querySelector('.hotzone-left').onclick = (e) => { stopEvent(e); update(gallery, -1); };
                ui.querySelector('.hotzone-right').onclick = (e) => { stopEvent(e); update(gallery, 1); };

                const seek = ui.querySelector('.seek-container');
                const tip = ui.querySelector('.seek-tooltip');
                let seekRect = null;

                seek.onmouseenter = () => { seekRect = seek.getBoundingClientRect(); };
                seek.onclick = (e) => {
                    stopEvent(e);
                    if (!seekRect) seekRect = seek.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - seekRect.left) / seekRect.width));
                    if (!cache.has(id)) {
                        update(gallery, 0).then(() => { update(gallery, Math.ceil(pct * cache.get(id).total) || 1, true); });
                    } else {
                        update(gallery, Math.ceil(pct * cache.get(id).total) || 1, true);
                    }
                };
                seek.onmousemove = (e) => {
                    if (!cache.has(id)) return;
                    if (!seekRect) seekRect = seek.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - seekRect.left) / seekRect.width));
                    tip.style.left = `${e.clientX - seekRect.left}px`;
                    tip.textContent = Math.ceil(pct * cache.get(id).total) || 1;
                };

                link.style.position = 'relative';
                link.appendChild(ui);
                isUiInjected = true;
            }

            if (!cache.has(id)) {
                hoverTimeout = setTimeout(() => { update(gallery, 0); }, 300);
            } else { update(gallery, 0); }
        };

        gallery.onmouseleave = () => {
            hoveredGallery = null;
            if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
            gallery.classList.remove('is-previewing');

            const img = link.querySelector('img');
            if (img && img.dataset.originalSrc) {
                img.src = img.dataset.originalSrc;
                img.style.aspectRatio = '';
            }

            updateMarkers();
            gallery.style.width = '';
            gallery.style.height = '';
            gallery.dataset.fixedDimensions = '';
        };
    }

    // ==========================================================================
    // 5. READER LOGIC
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
            if (document.fullscreenElement) document.exitFullscreen();
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

        const toolbars = document.querySelectorAll('.reader-bar');
        if (toolbars.length === 0) return;

        const bottomToolbar = toolbars[toolbars.length - 1];
        const containerRight = bottomToolbar.querySelector('.reader-buttons-right');

        if (!containerRight) return;

        // 1. Fullscreen
        if (!document.querySelector('.btn-fullscreen-custom')) {
            const fsBtn = document.createElement('button');
            fsBtn.className = 'btn btn-unstyled btn-fullscreen-custom';
            fsBtn.innerHTML = '<i class="fa fa-expand"></i> Fullscreen';
            fsBtn.title = "Toggle Fullscreen (T)";
            fsBtn.style.marginRight = '5px';

            const toggleFS = () => {
                if (!document.fullscreenElement) {
                    imageContainer.requestFullscreen().catch(err => console.log(err));
                } else {
                    document.exitFullscreen();
                }
            };
            fsBtn.onclick = toggleFS;

            containerRight.insertBefore(fsBtn, containerRight.firstChild);

            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (e.key === 't' || e.key === 'T') { e.preventDefault(); toggleFS(); }
            });

            document.addEventListener('fullscreenchange', () => {
                if (!document.fullscreenElement) {
                    fsBtn.innerHTML = '<i class="fa fa-expand"></i> Fullscreen';
                    setTimeout(() => {
                        imageContainer.scrollIntoView({ behavior: 'auto' });
                    });
                }
            });
        }

        // 2. Next Queue
        if (settings.enableQueue) {
            const fsBtn = document.querySelector('.btn-fullscreen-custom');
            const currentId = window.location.pathname.match(/\/g\/(\d+)/)?.[1];

            if (currentId && readingQueue.length > 0) {
                const currentIndex = readingQueue.findIndex(i => i.id == currentId);
                if (currentIndex > -1 && currentIndex < readingQueue.length - 1) {
                    const nextItem = readingQueue[currentIndex + 1];

                    const nextQBtn = document.createElement('a');
                    nextQBtn.className = 'btn btn-unstyled btn-next-queue';
                    nextQBtn.innerHTML = `<i class="fa fa-step-forward"></i> Next in queue`;
                    nextQBtn.href = `/g/${nextItem.id}/1/`;
                    nextQBtn.title = `Read Next in Queue: ${nextItem.title}`;

                    if (fsBtn) {
                        fsBtn.parentNode.insertBefore(nextQBtn, fsBtn.nextSibling);
                    } else {
                        containerRight.appendChild(nextQBtn);
                    }
                }
            }
        }

        // 3. Random Favorite
        const hasFavorites = !!document.querySelector('nav a[href*="/favorites/"]');

        if (hasFavorites) {
            const randFavBtn = document.createElement('a');
            randFavBtn.className = 'btn btn-unstyled btn-random-fav';

            randFavBtn.innerHTML = '<i class="fa fa-circle-notch fa-spin"></i>';
            randFavBtn.style.marginRight = '5px';
            randFavBtn.style.cursor = 'wait';
            randFavBtn.style.opacity = '0.5';

            containerRight.insertBefore(randFavBtn, containerRight.firstChild);

            fetch('/favorites/random')
                .then(response => {
                    const finalUrl = response.url;

                    if (finalUrl && finalUrl.includes('/g/')) {
                        let cleanUrl = finalUrl.split('?')[0];
                        if (!cleanUrl.endsWith('/')) cleanUrl += '/';

                        randFavBtn.href = `${cleanUrl}1/`;
                        randFavBtn.innerHTML = '<i class="fa fa-random"></i> Fav';
                        randFavBtn.title = "Read Random Favorite";
                        randFavBtn.style.cursor = 'pointer';
                        randFavBtn.style.opacity = '1';
                    } else {
                        randFavBtn.remove();
                    }
                })
                .catch(err => {
                    console.error(err);
                    randFavBtn.remove();
                });
        }

        // 4. Mouse Wheel Navigation (Fullscreen Only)
        let isWheeling = false;

        document.addEventListener('wheel', (e) => {
            if (!document.fullscreenElement) return;
            e.preventDefault();

            if (isWheeling) return;

            isWheeling = true;
            setTimeout(() => { isWheeling = false; }, 25);

            if (e.deltaY > 0) {
                const nextBtn = document.querySelector('.reader-pagination .next');
                if (nextBtn) nextBtn.click();
            } else {
                const prevBtn = document.querySelector('.reader-pagination .previous');
                if (prevBtn) prevBtn.click();
            }
        }, { passive: false });
    }

    // ==========================================================================
    // 6. RANDOM CONTEXTUAL
    // ==========================================================================

    function initRandomContextual() {
        const sortContainer = document.querySelector('.sort');
        if (!sortContainer || sortContainer.querySelector('.btn-random-ctx')) return;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'sort-type';

        const btn = document.createElement('a');
        btn.className = 'btn-random-ctx';
        const ORIGINAL_HTML = '<i class="fa fa-random"></i>';
        btn.innerHTML = ORIGINAL_HTML;
        btn.style.cursor = 'pointer';
        btn.title = "Roll a random gallery from these search results";

        const resetBtn = () => {
            btn.innerHTML = ORIGINAL_HTML;
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        };

        window.addEventListener('pageshow', (event) => {
            if (event.persisted) { resetBtn(); }
        });
        resetBtn();

        btn.onclick = async (e) => {
            e.preventDefault();
            btn.innerHTML = '<i class="fa fa-circle-notch fa-spin"></i>';
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.5';

            try {
                const lastPageBtn = document.querySelector('.pagination .last');
                let totalPages = 1;
                if (lastPageBtn) {
                    const match = lastPageBtn.href.match(/page=(\d+)/);
                    if (match) totalPages = parseInt(match[1], 10);
                } else {
                    const pages = document.querySelectorAll('.pagination .page');
                    if (pages.length > 0) {
                        const lastNum = pages[pages.length - 1].textContent;
                        if (!isNaN(lastNum)) totalPages = parseInt(lastNum, 10);
                    }
                }
                if (totalPages === 1) {
                    const galleries = document.querySelectorAll('.gallery a.cover');
                    if (galleries.length === 0) throw new Error("No galleries found");
                    const randomGallery = galleries[Math.floor(Math.random() * galleries.length)];
                    window.location.href = randomGallery.href;
                    return;
                }

                const randomPage = Math.floor(Math.random() * totalPages) + 1;
                const targetUrl = new URL(window.location.href);
                targetUrl.searchParams.set('page', randomPage);

                const response = await fetch(targetUrl.href);
                const html = await response.text();
                const parser = DOM_PARSER;
                const doc = parser.parseFromString(html, 'text/html');
                const galleries = doc.querySelectorAll('.gallery a.cover');
                if (galleries.length === 0) throw new Error("No galleries found");
                const randomGallery = galleries[Math.floor(Math.random() * galleries.length)];
                window.location.href = randomGallery.href;

            } catch (err) {
                btn.innerHTML = '<i class="fa fa-exclamation-triangle"></i>';
                setTimeout(() => { resetBtn(); }, 2000);
            }
        };

        btnContainer.appendChild(btn);
        sortContainer.appendChild(btnContainer);
    }

    // ==========================================================================
    // 7. POPULAR SHORTCUT BUTTON
    // ==========================================================================

    function initPopularShortcut() {
        const popularContainer = document.querySelector('.index-popular');
        if (!popularContainer || popularContainer.querySelector('.btn-view-all-popular')) return;

        const link = document.createElement('a');
        link.href = '/search/?q=pages%3A%3E0&sort=popular-today';
        link.className = 'btn btn-secondary btn-view-all-popular';
        link.style.display = 'block';
        link.style.marginTop = '5px';
        link.innerHTML = '<i class="fa fa-compass"></i> Explore Today’s Trending';
        popularContainer.appendChild(link);
    }

    // ==========================================================================
    // 8. SMART NAVIGATION
    // ==========================================================================

    function initSmartNavigation() {
        if (!settings.smartNav || isReader) return;

        const nextLink = document.querySelector('.pagination .next');
        if (!nextLink) return;

        if (document.body.dataset.smartNavInit) return;
        document.body.dataset.smartNavInit = '1';

        const navBar = document.createElement('div');
        navBar.className = 'smart-nav-bar';
        document.body.appendChild(navBar);

        let accumulatedDelta = 0;
        let pendingDelta = 0;
        let isNavigating = false;
        let isTicking = false;
        let drainAnimationId = null;

        const resetState = () => {
            isNavigating = false;
            isTicking = false;
            accumulatedDelta = 0;
            pendingDelta = 0;
            navBar.style.width = '0%';
            navBar.style.background = '#ed2553';
            navBar.style.boxShadow = 'none';
            if (drainAnimationId) cancelAnimationFrame(drainAnimationId);
        };

        window.addEventListener('pageshow', resetState);

        const updateVisuals = () => {
            if (isNavigating) return;

            const delta = pendingDelta;
            pendingDelta = 0;

            const currentDocHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            const scrollBottom = window.scrollY + window.innerHeight;

            const isAtBottom = (currentDocHeight - scrollBottom) < 50;

            if (isAtBottom && delta > 0) {
                if (drainAnimationId) {
                    cancelAnimationFrame(drainAnimationId);
                    drainAnimationId = null;
                }

                accumulatedDelta += delta;
                const percent = Math.min(100, (accumulatedDelta / SMART_NAV_THRESHOLD) * 100);
                navBar.style.width = `${percent}%`;

                if (accumulatedDelta > SMART_NAV_THRESHOLD) {
                    isNavigating = true;

                    navBar.style.background = "#dff0d8";
                    navBar.style.boxShadow = "0 0 15px #d6e9c6";

                    window.location.href = nextLink.href;

                    setTimeout(resetState, 3000);
                    return;
                }
            } else if (accumulatedDelta > 0) {
                const reduce = delta < 0 ? Math.abs(delta * 3) : 50;
                accumulatedDelta = Math.max(0, accumulatedDelta - reduce);
                navBar.style.width = `${(accumulatedDelta / SMART_NAV_THRESHOLD) * 100}%`;
            }

            isTicking = false;
        };

        const requestUpdate = (amount) => {
            pendingDelta += amount;
            if (!isTicking) {
                isTicking = true;
                window.requestAnimationFrame(updateVisuals);
            }
        };

        window.addEventListener('wheel', (e) => {
            if (isNavigating) return;
            requestUpdate(e.deltaY);
        }, { passive: true });

        let touchStartY = 0;
        window.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if (isNavigating) return;
            const touchCurrentY = e.touches[0].clientY;
            const diff = touchStartY - touchCurrentY;
            touchStartY = touchCurrentY;
            const multiplier = settings.smartNavSensitivity || 1.5;
            requestUpdate(diff * multiplier);
        }, { passive: true });

        const drainBar = () => {
             if (isNavigating || accumulatedDelta <= 0) {
                 if (!isNavigating) {
                     accumulatedDelta = 0;
                     navBar.style.width = '0%';
                 }
                 drainAnimationId = null;
                 return;
             }

             accumulatedDelta -= 60;
             navBar.style.width = `${(accumulatedDelta / SMART_NAV_THRESHOLD) * 100}%`;
             drainAnimationId = requestAnimationFrame(drainBar);
        };

        window.addEventListener('touchend', () => {
             if (!isNavigating && accumulatedDelta > 0 && accumulatedDelta < SMART_NAV_THRESHOLD) {
                 if (!drainAnimationId) drainAnimationId = requestAnimationFrame(drainBar);
             }
        });
    }

    // ==========================================================================
    // 9. GALLERY PAGE FEATURES
    // ==========================================================================

    function initGalleryPageFeatures() {
        const btnContainer = document.querySelector('#info-block .buttons');
        const searchInput = document.querySelector('form.search input[name="q"]');
        if (!btnContainer) return;

        // 1. Queue Button
        if (settings.enableQueue && !document.querySelector('.btn-queue-add')) {
            const qBtn = document.createElement('button');
            qBtn.className = 'btn btn-secondary btn-queue-add';
            qBtn.innerHTML = '<i class="fa fa-clock"></i> Queue';

            const galleryId = window.location.href.match(/\/g\/(\d+)/)?.[1];

            if (galleryId) {
                if (isQueued(galleryId)) {
                    qBtn.innerHTML = '<i class="far fa-clock"></i> Remove';
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

        // 2. Tag Selector
        if (!searchInput || document.querySelector('.btn-tag-selector') || !settings.enableTagSelect) return;

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
                document.body.classList.add('tag-select-active');
                toggleBtn.innerHTML = '<i class="fa fa-check"></i> Done';
                window.scrollTo({ top: 0 });
            } else {
                toggleBtn.classList.remove('is-active');
                tagsContainer.classList.remove('tags-selecting-mode');
                document.body.classList.remove('tag-select-active');
                toggleBtn.innerHTML = '<i class="fa fa-tags"></i> Tag Select';
            }
        };

        function updateSearchBar() {
            const selectedTags = tagsContainer.querySelectorAll('.tag.tag-selected');
            const queryTerms = Array.from(selectedTags).map(tag => {
                const nameSpan = tag.querySelector('.name');
                let tagName = nameSpan ? nameSpan.textContent.trim() : '';
                const href = tag.getAttribute('href');

                if (href.includes('/tag/')) return `tag:"${tagName}"`;
                if (href.includes('/artist/')) return `artist:"${tagName}"`;
                if (href.includes('/group/')) return `group:"${tagName}"`;
                if (href.includes('/parody/')) return `parody:"${tagName}"`;
                if (href.includes('/character/')) return `character:"${tagName}"`;
                if (href.includes('/language/')) return `language:"${tagName}"`;
                if (href.includes('/category/')) return `category:"${tagName}"`;
                return `"${tagName}"`;
            });
            searchInput.value = queryTerms.join(' ');
            searchInput.dispatchEvent(new Event('input'));
        }

        // 3. Passive Favorites Scanner
        const btnFav = document.querySelector('#favorite');
        const galleryId = window.location.href.match(/\/g\/(\d+)/)?.[1];

        if (btnFav && galleryId) {
            const btnText = btnFav.querySelector('.text');
            if (btnText && btnText.textContent.trim().toLowerCase().includes('unfavorite')) {
                addFav(galleryId);
            } else {
                removeFav(galleryId);
            }

            const btnObserver = new MutationObserver(() => {
                const txt = btnText.textContent.trim().toLowerCase();
                if (txt.includes('unfavorite')) addFav(galleryId);
                else removeFav(galleryId);
            });

            btnObserver.observe(btnText, { childList: true, characterData: true, subtree: true });
        }

    }

    // ==========================================================================
    // 10. SAVED SEARCHES
    // ==========================================================================

    function initSearchFlow() {
        if (!settings.enableSavedSearch) return;
        const form = document.querySelector('form.search');
        const nav = document.querySelector('nav[role="navigation"]');

        if (!form || !nav || form.dataset.savedInit) return;
        form.dataset.savedInit = '1';

        const input = form.querySelector('input[name="q"]');
        if (input) input.style.paddingRight = '40px';

        const SEP_MARKER = '---SEP---';
        let searchData = JSON.parse(localStorage.getItem('nhentai_search_flow') || '{"saved":[]}');

        let isDeleteMode = false;
        let isReorderMode = false;
        let pendingDeletes = new Set();

        const saveSearch = () => localStorage.setItem('nhentai_search_flow', JSON.stringify(searchData));

        const toggleSavedItem = (query) => {
            if (!query) return;
            const idx = searchData.saved.indexOf(query);
            if (idx > -1) searchData.saved.splice(idx, 1);
            else searchData.saved.push(query);
            saveSearch();
            renderBar();
        };

        const addSeparator = () => {
            searchData.saved.push(SEP_MARKER);
            saveSearch();
            renderBar();

            const list = barContainer.querySelector('.sse-list');
            if (list) list.scrollTop = list.scrollHeight;
        };

        const trigger = document.createElement('div');
        trigger.className = 'search-saved-trigger';
        trigger.innerHTML = '<i class="fa fa-folder-plus"></i>';
        trigger.title = "Saved Searches";
        form.appendChild(trigger);

        const barContainer = document.createElement('div');
        barContainer.className = 'saved-search-extension';
        nav.parentNode.insertBefore(barContainer, nav.nextSibling);

        const renderBar = () => {
            let prevScroll = 0;
            const existingList = barContainer.querySelector('.sse-list');
            if (existingList) prevScroll = existingList.scrollTop;

            const currentQ = input ? input.value.trim() : '';
            const isCurrentSaved = currentQ && searchData.saved.includes(currentQ);

            let listClass = 'sse-list';
            if (isDeleteMode) listClass += ' delete-mode';
            if (isReorderMode) listClass += ' reorder-mode';

            let actionButtons = '';
            let saveCurrentBtn = '';

            if (isDeleteMode) {
                const count = pendingDeletes.size;
                actionButtons = `
                    <button class="btn-sse-save" id="btn-confirm-del" style="margin-right: 5px;">
                        Save
                    </button>
                    <button class="btn-sse-edit" id="btn-cancel-del">Cancel</button>
                `;
            } else if (isReorderMode) {
                actionButtons = `
                    <button class="btn-sse-save" id="btn-finish-reorder" style="margin-right: 5px;">
                        Save
                    </button>
                    <button class="btn-sse-edit" id="btn-add-sep">Add Separator</button>
                `;
            } else {
                if (searchData.saved.length > 0) {
                    actionButtons = `
                        <button class="btn-sse-edit" id="btn-toggle-reorder" style="margin-right: 5px;" title="Organize items">
                            <i class="fa fa-sort"></i> Reorder
                        </button>
                        <button class="btn-sse-edit" id="btn-toggle-edit" title="Delete items">
                            <i class="fas fa-eraser"></i> Delete
                        </button>
                    `;
                }

                if (!isCurrentSaved && currentQ) {
                    saveCurrentBtn = `<button class="btn-sse-save" id="btn-save-curr-bar" style="margin-right:5px"><i class="fa fa-plus"></i> Save</button>`;
                }
            }

            let html = `
                <div class="sse-inner">
                    <div class="sse-header">
                        <div style="display:flex; gap:5px; align-items:center;">
                             ${saveCurrentBtn}
                        </div>
                        <div class="sse-actions">
                            ${actionButtons}
                        </div>
                    </div>
                    <div class="${listClass}">
            `;

            if (searchData.saved.length === 0) {
                html += `<div class="sse-empty">No saved searches yet. Build a search and click Save to add it here.</div>`;
            } else {
                searchData.saved.forEach((q, index) => {
                    if (q === SEP_MARKER) {
                         const isMarked = pendingDeletes.has(index.toString());
                         const deleteStyle = isMarked ? 'to-delete' : '';
                         const draggableAttr = isReorderMode ? 'draggable="true"' : '';

                         html += `<div class="ss-separator sse-item ${deleteStyle}" ${draggableAttr} data-index="${index}" data-type="sep"></div>`;
                    }
                    else {
                        const isCurrent = q === currentQ ? 'is-current' : '';
                        const isMarked = pendingDeletes.has(q);
                        const deleteStyle = isMarked ? 'to-delete' : '';
                        const safeQ = q.replace(/"/g, '&quot;');
                        const displayLabel = q.replace(/\b[a-z-]+:/g, '').trim();

                        let tooltip = safeQ;
                        const draggableAttr = isReorderMode ? 'draggable="true"' : '';

                        html += `
                            <div class="ss-pill sse-item ${isCurrent} ${deleteStyle}" ${draggableAttr} data-index="${index}" data-type="pill">
                                <div class="ss-part ss-text" data-full-query="${safeQ}" title="${tooltip}">${displayLabel}</div>
                                <div class="ss-part ss-add" data-q="${safeQ}" title="Add to current input"><i class="fa fa-plus" style="font-size: 10px;"></i></div>
                            </div>
                        `;
                    }
                });
            }
            html += `</div></div>`;

            barContainer.innerHTML = html;

            const newList = barContainer.querySelector('.sse-list');
            if (newList) newList.scrollTop = prevScroll;


            if (isReorderMode) {
                let draggedIndex = null;
                const items = barContainer.querySelectorAll('.sse-item');

                // 1.1 DESKTOP
                items.forEach(item => {
                    item.addEventListener('dragstart', (e) => {
                        draggedIndex = parseInt(item.dataset.index);
                        item.classList.add('is-dragging');
                        e.dataTransfer.effectAllowed = 'move';
                    });

                    item.addEventListener('dragend', () => {
                        item.classList.remove('is-dragging');
                        items.forEach(i => i.classList.remove('drag-over'));
                    });

                    item.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        const targetIndex = parseInt(item.dataset.index);
                        if (targetIndex !== draggedIndex) {
                            item.classList.add('drag-over');
                        }
                    });

                    item.addEventListener('dragleave', () => {
                        item.classList.remove('drag-over');
                    });

                    item.addEventListener('drop', (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        const targetIndex = parseInt(item.dataset.index);

                        if (draggedIndex !== null && draggedIndex !== targetIndex) {
                            const itemToMove = searchData.saved.splice(draggedIndex, 1)[0];
                            searchData.saved.splice(targetIndex, 0, itemToMove);
                            saveSearch();
                            renderBar();
                        }
                        return false;
                    });
                });

                // 1.2 MOBILE
                let touchSourceIndex = null;
                let touchTargetElement = null;
                let longPressTimer = null;
                let isDragActive = false;
                let autoScrollInterval = null;
                let lastTouchY = 0;

                const listElement = barContainer.querySelector('.sse-list');

                const handleAutoScroll = () => {
                    if (!isDragActive || !listElement) return;

                    const rect = listElement.getBoundingClientRect();
                    const threshold = 50;
                    const speed = 10;

                    clearInterval(autoScrollInterval);
                    autoScrollInterval = null;

                    if (lastTouchY < rect.top + threshold) {
                        autoScrollInterval = setInterval(() => { listElement.scrollTop -= speed; }, 16);
                    } else if (lastTouchY > rect.bottom - threshold) {
                        autoScrollInterval = setInterval(() => { listElement.scrollTop += speed; }, 16);
                    }
                };

                const stopAutoScroll = () => {
                    if (autoScrollInterval) { clearInterval(autoScrollInterval); autoScrollInterval = null; }
                };

                items.forEach(item => {
                    item.addEventListener('touchstart', (e) => {
                        touchSourceIndex = parseInt(item.dataset.index);
                        item.classList.add('is-pressing');

                        longPressTimer = setTimeout(() => {
                            isDragActive = true;
                            item.classList.remove('is-pressing');
                            item.classList.add('is-dragging');
                            if (navigator.vibrate) navigator.vibrate(50);
                            document.body.style.overflow = 'hidden';
                        }, 500);

                    }, { passive: true });

                    item.addEventListener('touchmove', (e) => {
                        const touch = e.touches[0];
                        lastTouchY = touch.clientY;

                        if (!isDragActive) {
                            clearTimeout(longPressTimer);
                            item.classList.remove('is-pressing');
                            return;
                        }

                        e.preventDefault();
                        handleAutoScroll();

                        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
                        if (!elementBelow) return;

                        const targetItem = elementBelow.closest('.sse-item');
                        items.forEach(i => i.classList.remove('drag-over'));

                        if (targetItem && targetItem !== item) {
                            touchTargetElement = targetItem;
                            targetItem.classList.add('drag-over');
                        } else {
                            touchTargetElement = null;
                        }
                    }, { passive: false });

                    item.addEventListener('touchend', (e) => {
                        clearTimeout(longPressTimer);
                        stopAutoScroll();

                        item.classList.remove('is-pressing');
                        item.classList.remove('is-dragging');
                        document.body.style.overflow = '';

                        if (isDragActive) {
                            items.forEach(i => i.classList.remove('drag-over'));

                            if (touchSourceIndex !== null && touchTargetElement) {
                                const targetIndex = parseInt(touchTargetElement.dataset.index);
                                if (targetIndex !== touchSourceIndex) {
                                    const itemToMove = searchData.saved.splice(touchSourceIndex, 1)[0];
                                    searchData.saved.splice(targetIndex, 0, itemToMove);
                                    saveSearch();
                                    renderBar();
                                }
                            }
                        }

                        isDragActive = false;
                        touchSourceIndex = null;
                        touchTargetElement = null;
                    });

                    item.addEventListener('touchcancel', () => {
                        clearTimeout(longPressTimer);
                        stopAutoScroll();
                        isDragActive = false;
                        item.classList.remove('is-pressing');
                        item.classList.remove('is-dragging');
                        document.body.style.overflow = '';
                    });
                });
            }

            // 2. Control Buttons Handlers
            const btnDeleteMode = barContainer.querySelector('#btn-toggle-edit');
            if (btnDeleteMode) {
                btnDeleteMode.onclick = (e) => {
                    e.stopPropagation();
                    isDeleteMode = true;
                    isReorderMode = false;
                    pendingDeletes.clear();
                    renderBar();
                };
            }

            const btnReorderMode = barContainer.querySelector('#btn-toggle-reorder');
            if (btnReorderMode) {
                btnReorderMode.onclick = (e) => {
                    e.stopPropagation();
                    isReorderMode = true;
                    isDeleteMode = false;
                    renderBar();
                };
            }

            const btnFinishReorder = barContainer.querySelector('#btn-finish-reorder');
            if (btnFinishReorder) {
                btnFinishReorder.onclick = (e) => {
                    e.stopPropagation();
                    isReorderMode = false;
                    renderBar();
                };
            }

            const btnConfirm = barContainer.querySelector('#btn-confirm-del');
            if (btnConfirm) {
                btnConfirm.onclick = (e) => {
                    e.stopPropagation();
                    if (pendingDeletes.size > 0) {
                        const newSaved = [];
                        searchData.saved.forEach((item, idx) => {
                            if (item === SEP_MARKER) {
                                if (!pendingDeletes.has(idx.toString())) newSaved.push(item);
                            } else {
                                if (!pendingDeletes.has(item)) newSaved.push(item);
                            }
                        });
                        searchData.saved = newSaved;
                        saveSearch();
                    }
                    isDeleteMode = false;
                    pendingDeletes.clear();
                    renderBar();
                };
            }

            const btnCancel = barContainer.querySelector('#btn-cancel-del');
            if (btnCancel) {
                btnCancel.onclick = (e) => {
                    e.stopPropagation();
                    isDeleteMode = false;
                    pendingDeletes.clear();
                    renderBar();
                };
            }

            const btnSave = barContainer.querySelector('#btn-save-curr-bar');
            if (btnSave) {
                btnSave.onclick = (e) => {
                    e.stopPropagation();
                    toggleSavedItem(currentQ);
                };
            }

            const btnAddSep = barContainer.querySelector('#btn-add-sep');
            if (btnAddSep) {
                btnAddSep.onclick = (e) => {
                    e.stopPropagation();
                    addSeparator();
                };
            }

            // 3. Event Delegation
            barContainer.onclick = (e) => {
                const addBtn = e.target.closest('.ss-add');
                if (addBtn) {
                    e.stopPropagation();
                    if (isDeleteMode || isReorderMode) return;
                    const queryToAdd = addBtn.dataset.q;
                    const currentVal = input.value.trim();
                    input.value = currentVal ? currentVal + ' ' + queryToAdd : queryToAdd;
                    input.focus();
                    input.dispatchEvent(new Event('input'));
                    return;
                }

                const itemEl = e.target.closest('.sse-item');
                if (itemEl && !isReorderMode) {
                    e.stopPropagation();
                    const type = itemEl.dataset.type;
                    const index = itemEl.dataset.index;

                    if (isDeleteMode) {
                        const key = type === 'sep' ? index.toString() : itemEl.querySelector('.ss-text').dataset.fullQuery;
                        if (pendingDeletes.has(key)) pendingDeletes.delete(key);
                        else pendingDeletes.add(key);
                        renderBar();
                    } else if (type === 'pill') {
                        const fullQuery = itemEl.querySelector('.ss-text').dataset.fullQuery;
                        if(fullQuery) window.location.href = `/search/?q=${encodeURIComponent(fullQuery)}`;
                    }
                }
            };
        };

        trigger.onclick = (e) => {
            e.stopPropagation();
            const isVisible = barContainer.classList.contains('is-visible');

            if (!isVisible) {
                isDeleteMode = false;
                isReorderMode = false;
                pendingDeletes.clear();
                renderBar();
                barContainer.classList.add('is-visible');
                trigger.classList.add('is-active');
            } else {
                barContainer.classList.remove('is-visible');
                trigger.classList.remove('is-active');
            }
        };

        let renderTimeout;
        if (input) {
            input.addEventListener('input', () => {
                if (!barContainer.classList.contains('is-visible')) return;

                clearTimeout(renderTimeout);
                renderTimeout = setTimeout(() => {
                    renderBar();
                }, 300);
            });
        }
    }

    // ==========================================================================
    // 11. CUSTOM CONTEXT MENU
    // ==========================================================================

    function initContextMenu() {
        if (document.body.dataset.contextMenuInit) return;
        document.body.dataset.contextMenuInit = '1';

        const menu = document.createElement('div');
        menu.className = 'nh-context-menu';
        document.body.appendChild(menu);

        let currentTargetId = null;
        let currentTargetUrl = null;

        document.addEventListener('contextmenu', (e) => {
            if (!settings.enableContextMenu) return;

            const gallery = e.target.closest('.gallery');
            if (!gallery) {
                closeMenu();
                return;
            }

            const link = gallery.querySelector('a.cover');
            if (!link) return;

            e.preventDefault();

            currentTargetId = gallery.dataset.gid;
            currentTargetUrl = link.href;

            renderMenuOptions(menu);
            positionMenu(e.clientX, e.clientY);
            menu.classList.add('is-visible');
        });

        window.addEventListener('click', (e) => {
            if (menu.contains(e.target)) return;
            closeMenu();
        }, true);

        ['scroll', 'resize'].forEach(evt => window.addEventListener(evt, closeMenu));

        function closeMenu() {
            menu.classList.remove('is-visible');
        }

        function positionMenu(x, y) {
            const w = 165, h = 173;
            if (x + w > window.innerWidth) x -= w;
            if (y + h > window.innerHeight) y -= h;
            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
        }

        function renderMenuOptions(menuElement) {

            const galleryState = states.get(currentTargetId);

            const currentPage = galleryState ? galleryState.curr : 1;

            const readUrl = `/g/${currentTargetId}/${currentPage}/`;

            const readLabel = currentPage > 1 ? `Read from page ${currentPage}` : `Read now`;

            menuElement.innerHTML = `
            <div class="nh-cm-item" id="cm-new-tab">
                Open in new tab
            </div>
            <div class="nh-cm-item" id="cm-read-now">
                ${readLabel}
            </div>
            <div class="nh-cm-separator"></div>
            <div class="nh-cm-item" id="cm-copy-id">
                Copy ID: ${currentTargetId}
            </div>
            <div class="nh-cm-item" id="cm-favorite">
                Favorite
            </div>
            <div class="nh-cm-footer" id="cm-close-hint">
                Shift + right-click to open system menu
            </div>
        `;

            menuElement.querySelector('#cm-read-now').onclick = () => {
                window.location.href = readUrl;
                closeMenu();
            };

            menuElement.querySelector('#cm-new-tab').onclick = () => {
                if (typeof GM_openInTab !== 'undefined') {
                    GM_openInTab(currentTargetUrl, { active: false, insert: true });
                } else {
                    window.open(currentTargetUrl, '_blank');
                }
                closeMenu();
            };

            const favBtn = menuElement.querySelector('#cm-favorite');
            favBtn.onclick = (e) => {
                e.stopPropagation();
                handleApiFavorite(currentTargetId, favBtn);
            };

            menuElement.querySelector('#cm-copy-id').onclick = () => {
                navigator.clipboard.writeText(currentTargetId);
                closeMenu();
            };

            menuElement.querySelector('#cm-close-hint').onclick = () => {
                closeMenu();
            };
        }

        function handleApiFavorite(id, btnElement) {
            const originalText = btnElement.textContent;

            btnElement.textContent = 'Saving…';
            btnElement.style.pointerEvents = 'none';
            btnElement.style.opacity = '0.7';

            const apiUrl = `/api/gallery/${id}/favorite`;
            const csrfToken = getCookie('csrftoken') || document.querySelector('input[name="csrfmiddlewaretoken"]')?.value;

            fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken,
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({})
            })
                .then(response => {
                if (response.ok) return response.json();
                if (response.status === 403 || response.status === 401) throw new Error('Login required');
                throw new Error('Network error');
            })
                .then(data => {
                btnElement.textContent = 'Added to favorites';
                btnElement.style.background = '#dff0d8';
                btnElement.style.opacity = '.9';
                btnElement.style.color = '#3c763d';
                addFav(id);
            })
                .catch(err => {
                console.error(err);
                btnElement.textContent = 'Login required';
                btnElement.style.background = '#f2dede';
                btnElement.style.opacity = '.9';
                btnElement.style.color = '#a94442';
                btnElement.style.pointerEvents = 'auto';

                setTimeout(() => {
                    btnElement.textContent = originalText;
                    btnElement.style.color = '';
                    btnElement.style.background = '';
                    btnElement.style.opacity = '1';
                }, 2000);
            });
        }

        function getCookie(name) {
            let v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
            return v ? v[2] : null;
        }
    }

    // ==========================================================================
    // 12. GLOBAL SHORTCUTS
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
    // 13. DATA MANAGEMENT (BACKUP/RESTORE)
    // ==========================================================================

    function exportData() {
        const data = {
            settings: JSON.parse(localStorage.getItem('nhentai_flow_settings') || '{}'),
            queue: JSON.parse(localStorage.getItem('nhentai_queue_v1') || '[]'),
            savedSearches: JSON.parse(localStorage.getItem('nhentai_search_flow') || '{"saved":[]}')
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `nh-flow-backup-${timestamp}.json`;
        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const data = JSON.parse(event.target.result);

                    if (data.settings) localStorage.setItem('nhentai_flow_settings', JSON.stringify(data.settings));
                    if (data.queue) localStorage.setItem('nhentai_queue_v1', JSON.stringify(data.queue));
                    if (data.savedSearches) localStorage.setItem('nhentai_search_flow', JSON.stringify(data.savedSearches));

                    alert('Imported data successfully! The page will reload.');
                    window.location.reload();
                } catch (err) {
                    alert('Failed to read file: invalid or corrupted JSON.');
                    console.error(err);
                }
            };
            reader.readAsText(file);
        };

        input.click();
    }

    // ==========================================================================
    // 14. SETTINGS MENU UI
    // ==========================================================================

    function initSettingsMenu() {
        const navContainer = document.querySelector('nav.menu .right') || document.querySelector('ul.menu.right');
        if (!navContainer || document.querySelector('.nav-settings-btn')) return;

        const btnLi = document.createElement('li');
        btnLi.className = 'nav-settings-btn';

        btnLi.innerHTML = `
            <a href="/?view=settings">
                <i class="fa fa-cog"></i> Flow
            </a>
        `;

        navContainer.insertBefore(btnLi, navContainer.firstChild);
    }

    function renderSettingsPage() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('view') !== 'settings') return;

        document.title = "NHentai Flow Settings";
        const content = document.getElementById('content');
        if (!content) return;
        content.innerHTML = '';

        const options = [
            { key: 'previewNav', label: 'Hover Preview (Thumbnails)', desc: 'Show gallery pages when hovering over covers.' },
            { key: 'highlightVisited', label: 'Highlight Read Galleries', desc: 'Change the color of galleries you’ve already visited.' },
            { key: 'showTagOverlay', label: 'Show Tags on Hover', desc: 'Display a popup with tags when hovering over covers.' },
            { key: 'enableQueue', label: 'Enable Reading Queue', desc: 'Save galleries to read later.' },
            { key: 'enableTagSelect', label: 'Enable Tag Selector', desc: 'Allow multi-tag selection on gallery pages.' },
            { key: 'enableSavedSearch', label: 'Enable Saved Searches', desc: 'Save your favorite search queries for quick access.' },
            { key: 'smartNav', label: 'Smart Navigation', desc: 'Automatically load the next page when scrolling to the bottom.' },
            { key: 'smartNavSensitivity', label: 'Smart Nav Sensitivity', desc: 'Adjust how easily the next page is triggered on touch devices.', type: 'range', min: 1.0, max: 5.0, step: 0.1 },
            { key: 'enableContextMenu', label: 'Custom Context Menu', desc: 'Replace the browser right-click menu with the NHentai Flow menu.' },
            { key: 'paginationRight', label: 'Right-Side Pagination', desc: 'Move pagination buttons to the right side (desktop only).' }
        ];

        const container = document.createElement('div');
        container.className = 'container';

        let html = `
            <span style="font-size: 12px; float: right; color: #666; font-weight: normal; margin-right: 10px;">v${GM_info.script.version}</span>
                <h1><i class="fa fa-cog color-icon"></i> NHentai Flow Settings</h1>
                <div class="settings-container">
                <div class="settings-group">
        `;

        options.forEach(opt => {
            if (opt.type === 'range') {
                const val = settings[opt.key];
                html += `
                    <div class="settings-item">
                        <div>
                            <div class="settings-label">${opt.label}</div>
                            <div class="settings-desc">${opt.desc}</div>
                        </div>
                        <div>
                            <input type="range" class="nh-range"
                                data-key="${opt.key}"
                                min="${opt.min}" max="${opt.max}" step="${opt.step}" value="${val}"
                                style="width: 100px; cursor: pointer;">
                        </div>
                    </div>
                `;
            } else {
                const isChecked = settings[opt.key] ? 'checked' : '';
                html += `
                    <div class="settings-item">
                        <div>
                            <div class="settings-label">${opt.label}</div>
                            <div class="settings-desc">${opt.desc}</div>
                        </div>
                        <label class="nh-switch">
                            <input type="checkbox" data-key="${opt.key}" ${isChecked}>
                            <span class="nh-slider"></span>
                        </label>
                    </div>
                `;
            }
        });

        html += `
                </div>
                <div class="settings-actions">
                    <button id="btn-sync-favs" class="btn-setting-action">Sync Favorites</button>
                    <button id="btn-export-data" class="btn-setting-action">Export Data</button>
                    <button id="btn-import-data" class="btn-setting-action">Import Data</button>
                </div>
            </div>
            <span style="font-size: 11px;color: #666; font-weight: normal;">Designed to make things easier… even with one hand.</span>
        `;

        container.innerHTML = html;
        content.appendChild(container);

        const btnSync = container.querySelector('#btn-sync-favs');
        btnSync.onclick = async () => {
            if (!confirm("To display the Heart marker (❤️) and help Discover & Fill avoid duplicates, this script builds a local cache of your favorites.\n\nIt will scan your favorites page by page with a small delay to avoid rate limits.\n\nStart indexing?")) return;

            const originalText = btnSync.innerHTML;
            btnSync.disabled = true;
            btnSync.style.opacity = "0.7";

            try {
                const total = await syncFavorites((status) => {
                    btnSync.innerHTML = `${status}`;
                });

                btnSync.innerHTML = `${total} IDs`;
                btnSync.style.background = "#3c763d";

                setTimeout(() => {
                    btnSync.innerHTML = originalText;
                    btnSync.disabled = false;
                    btnSync.style.background = "#ed2553";
                    btnSync.style.opacity = "1";
                }, 3000);

            } catch (err) {
                alert("Error: " + err.message);
                btnSync.innerHTML = `Failed`;
                setTimeout(() => {
                    btnSync.innerHTML = originalText;
                    btnSync.disabled = false;
                    btnSync.style.opacity = "1";
                }, 3000);
            }
        };

        container.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.onchange = (e) => {
                settings[e.target.dataset.key] = e.target.checked;
                saveSettings();
            };
        });

        container.querySelectorAll('input[type="range"]').forEach(input => {
            input.onchange = (e) => {
                settings[e.target.dataset.key] = parseFloat(e.target.value);
                saveSettings();
            };
        });

        container.querySelector('#btn-export-data').onclick = exportData;
        container.querySelector('#btn-import-data').onclick = importData;
    }

    // ==========================================================================
    // 15. INIT & OBSERVERS
    // ==========================================================================

    function scan() {
        const params = new URLSearchParams(window.location.search);

        if (params.get('view') === 'settings') return;

        initSearchFlow();
        document.querySelectorAll('.gallery:not([data-init])').forEach(initPreviewUI);
        initReaderMode();
        initGalleryPageFeatures();
        initGlobalShortcuts();
        initQueueWidget();
        initRandomContextual();
        initFavoritesPage()

        if (typeof initContextMenu === 'function') initContextMenu();
    }

    document.addEventListener('keydown', (e) => {
        if (hoveredGallery && !document.fullscreenElement) {
            if (e.key === 'ArrowRight') { e.preventDefault(); update(hoveredGallery, 1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); update(hoveredGallery, -1); }
            else if (e.key === 'q') {
                if (!settings.enableQueue) return;
                const btn = hoveredGallery.querySelector('.queue-trigger');
                if (btn) btn.click();
            }
        }
    });

    function boot() {
        const params = new URLSearchParams(window.location.search);
        const view = params.get('view');

        initSettingsMenu();

        if (view === 'settings') {
            renderSettingsPage();
            return;
        }

        if (view === 'queue') {
            renderQueuePage();
        }

        scan();

        initSmartNavigation();
        if (window.location.pathname === '/') initPopularShortcut();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

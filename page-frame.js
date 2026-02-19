/* ── OrderSkew Page Frame (single source of truth) ──
   This file and page-frame.css are the only frame implementation. Do not
   duplicate nav bar, footer, or commit-stamp logic elsewhere.

   Drop-in nav bar + commit-stamp footer for every page. Config is centralised
   here; all main and subpages use the same behaviour.

   Usage — add ONE script tag (JS auto-injects companion CSS). Prefer root-relative
   when served from site root: <script src="/page-frame.js"></script>
   Or relative: <script src="../../page-frame.js"></script>

   Page type is auto-detected from location.pathname. Optional overrides:
   data-page-type="main"|"tools-hub"|"tool"  data-repo="owner/repo"
*/
(function () {
    'use strict';

    var script = document.currentScript;
    if (!script) return;

    var CONFIG = {
        brand: 'OrderSkew',
        repo: 'yanniedog/orderskew',
        pathnames: {
            main: [ '', '/' ],
            toolsHub: [ '/pages', '/pages/' ]
        },
        commitLabel: 'Latest commit (main)',
        commitLoading: 'Loading latest commit\u2026',
        commitUnavailable: 'Latest commit (main): unavailable',
        commitUnavailableStatus: 'Latest commit (main): unavailable ('
    };

    var pageType = script.getAttribute('data-page-type');
    if (!pageType && typeof document !== 'undefined' && document.location && document.location.pathname) {
        var path = document.location.pathname.replace(/\/index\.html$/i, '') || '/';
        if (CONFIG.pathnames.main.indexOf(path) !== -1) {
            pageType = 'main';
        } else if (CONFIG.pathnames.toolsHub.indexOf(path) !== -1) {
            pageType = 'tools-hub';
        } else if (path.indexOf('/pages/') === 0 && path.length > 7) {
            pageType = 'tool';
        }
    }
    pageType = pageType || 'tool';

    var repo = script.getAttribute('data-repo') || CONFIG.repo;

    var cssHref = script.src.replace(/page-frame\.js(\?.*)?$/, 'page-frame.css');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);

    var rootPath;
    switch (pageType) {
        case 'main':      rootPath = '.';    break;
        case 'tools-hub': rootPath = '..';   break;
        default:          rootPath = '../..'; break;
    }

    var mainHref  = rootPath + '/index.html';
    var toolsHref = rootPath + '/pages/index.html';

    var arrowSvg = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M10 3L5 8l5 5"/></svg>';

    function buildNav() {
        var nav = document.createElement('nav');
        nav.className = 'os-frame-nav';
        nav.setAttribute('aria-label', 'Site navigation');

        var links = '';

        if (pageType === 'main') {
            links += '<a class="os-frame-link" href="' + toolsHref + '">' + arrowSvg + ' Tools</a>';
        }
        if (pageType === 'tools-hub') {
            links += '<a class="os-frame-link" href="' + mainHref + '">' + arrowSvg + ' OrderSkew Home</a>';
        }
        if (pageType === 'tool') {
            links += '<a class="os-frame-link" href="' + toolsHref + '">' + arrowSvg + ' All Tools</a>';
            links += '<a class="os-frame-link" href="' + mainHref + '">' + arrowSvg + ' OrderSkew Home</a>';
        }

        nav.innerHTML =
            '<div class="os-frame-nav-inner">' +
                '<span class="os-frame-brand">' + CONFIG.brand + '</span>' +
                '<div class="os-frame-nav-links">' + links + '</div>' +
            '</div>';

        return nav;
    }

    function padTwo(n) { return String(n).padStart(2, '0'); }

    function formatLocal(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        var y = d.getFullYear();
        var m = padTwo(d.getMonth() + 1);
        var day = padTwo(d.getDate());
        var h = padTwo(d.getHours());
        var min = padTwo(d.getMinutes());
        var s = padTwo(d.getSeconds());
        return y + '-' + m + '-' + day + ' ' + h + ':' + min + ':' + s + ' (local)';
    }

    function formatUtc(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return d.getUTCFullYear() + '-' + padTwo(d.getUTCMonth() + 1) + '-' + padTwo(d.getUTCDate()) +
            ' ' + padTwo(d.getUTCHours()) + ':' + padTwo(d.getUTCMinutes()) + ':' + padTwo(d.getUTCSeconds()) + ' UTC';
    }

    function buildFooter() {
        var footer = document.createElement('footer');
        footer.className = 'os-frame-footer';
        footer.innerHTML =
            '<div class="os-frame-footer-inner">' +
                '<span class="os-frame-commit" id="os-frame-commit">' + CONFIG.commitLoading + '</span>' +
            '</div>';
        return footer;
    }

    function setCommitStamp(el, label, dateIso, fullSha) {
        el.innerHTML = '';
        el.appendChild(document.createTextNode(label + ': '));
        if (dateIso) {
            var localStr = formatLocal(dateIso);
            var utcStr = formatUtc(dateIso);
            if (localStr && utcStr) {
                var timeSpan = document.createElement('span');
                timeSpan.setAttribute('title', utcStr);
                timeSpan.textContent = localStr;
                el.appendChild(timeSpan);
                el.appendChild(document.createTextNode(' '));
            }
        }
        var shortSha = fullSha ? String(fullSha).slice(0, 7) : '?';
        var link = document.createElement('a');
        link.className = 'os-frame-commit-link';
        link.href = 'https://github.com/' + repo + '/commit/' + (fullSha || '');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = shortSha;
        el.appendChild(link);
    }

    function loadCommitStamp() {
        var el = document.getElementById('os-frame-commit');
        if (!el) return;

        fetch('https://api.github.com/repos/' + repo + '/commits/main', {
            method: 'GET',
            headers: { Accept: 'application/vnd.github+json' }
        })
        .then(function (res) {
            if (!res.ok) {
                el.textContent = CONFIG.commitUnavailableStatus + res.status + ')';
                return null;
            }
            return res.json();
        })
        .then(function (data) {
            if (!data) return;
            var dateIso = data.commit && data.commit.committer ? data.commit.committer.date : null;
            setCommitStamp(el, CONFIG.commitLabel, dateIso, data.sha);
        })
        .catch(function () {
            el.textContent = CONFIG.commitUnavailable;
        });
    }

    function init() {
        document.body.prepend(buildNav());
        document.body.appendChild(buildFooter());
        loadCommitStamp();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

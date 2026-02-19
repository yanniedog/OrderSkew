/* ── OrderSkew Page Frame ──
   Drop-in nav bar + commit-stamp footer for every page in the project.
   Config is centralised here; all main and subpages use the same behaviour.

   Usage — add ONE script tag (JS auto-injects companion CSS). Prefer root-relative
   so the same tag works everywhere when served from site root:

     <script src="/page-frame.js"></script>

   Or use a relative path and optional data-page-type (override for auto-detect):
     <script src="../../page-frame.js" data-page-type="tool"></script>

   data-page-type (optional; auto-detected from location.pathname if omitted):
     "main"       – root index.html  (shows "Tools" button)
     "tools-hub"  – pages/index.html (shows "OrderSkew Home" button)
     "tool"       – pages/<name>/    (shows "All Tools" + "OrderSkew Home")
   data-repo (optional): GitHub owner/repo for commit stamp (default from CONFIG).
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

    function buildFooter() {
        var footer = document.createElement('footer');
        footer.className = 'os-frame-footer';
        footer.innerHTML =
            '<div class="os-frame-footer-inner">' +
                '<span class="os-frame-commit" id="os-frame-commit">' + CONFIG.commitLoading + '</span>' +
            '</div>';
        return footer;
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
            var sha = data.sha ? String(data.sha).slice(0, 7) : '?';
            el.textContent = CONFIG.commitLabel + ': ' + sha;
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

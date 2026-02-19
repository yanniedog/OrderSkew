/* ── OrderSkew Page Frame ──
   Drop-in nav bar + commit-stamp footer for every page in the project.

   Usage — add ONE script tag (the JS auto-injects the companion CSS):

     <script src="../../page-frame.js" data-page-type="tool"></script>

   data-page-type values:
     "main"       – root index.html  (shows "Tools" button)
     "tools-hub"  – pages/index.html (shows "OrderSkew Home" button)
     "tool"       – pages/<name>/    (shows "All Tools" + "OrderSkew Home")

   Optional: data-repo="owner/repo" (default: yanniedog/orderskew)
*/
(function () {
    'use strict';

    var script = document.currentScript;
    if (!script) return;

    var pageType = script.getAttribute('data-page-type') || 'tool';
    var repo = script.getAttribute('data-repo') || 'yanniedog/orderskew';

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
                '<span class="os-frame-brand">OrderSkew</span>' +
                '<div class="os-frame-nav-links">' + links + '</div>' +
                '<span class="os-frame-time" id="os-frame-time" title="">--:--:--</span>' +
            '</div>';

        return nav;
    }

    function buildFooter() {
        var footer = document.createElement('footer');
        footer.className = 'os-frame-footer';
        footer.innerHTML =
            '<div class="os-frame-footer-inner">' +
                '<span class="os-frame-commit" id="os-frame-commit">Loading latest commit\u2026</span>' +
            '</div>';
        return footer;
    }

    function padTwo(n) { return String(n).padStart(2, '0'); }

    function formatLocalTime(d) {
        return padTwo(d.getHours()) + ':' + padTwo(d.getMinutes()) + ':' + padTwo(d.getSeconds());
    }

    function formatUtcTitle(d) {
        return d.getUTCFullYear() + '-' + padTwo(d.getUTCMonth() + 1) + '-' + padTwo(d.getUTCDate()) +
            ' ' + padTwo(d.getUTCHours()) + ':' + padTwo(d.getUTCMinutes()) + ':' + padTwo(d.getUTCSeconds()) + ' UTC';
    }

    function updateFrameTime() {
        var el = document.getElementById('os-frame-time');
        if (!el) return;
        var d = new Date();
        el.textContent = formatLocalTime(d);
        el.setAttribute('title', formatUtcTitle(d));
    }

    function formatUtc(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return d.getUTCFullYear() + '-' + padTwo(d.getUTCMonth() + 1) + '-' + padTwo(d.getUTCDate()) +
            ' ' + padTwo(d.getUTCHours()) + ':' + padTwo(d.getUTCMinutes()) + ':' + padTwo(d.getUTCSeconds()) + ' UTC';
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
                el.textContent = 'Latest commit (main): unavailable (' + res.status + ')';
                return null;
            }
            return res.json();
        })
        .then(function (data) {
            if (!data) return;
            var sha = data.sha ? String(data.sha).slice(0, 7) : '?';
            var dateIso = data.commit && data.commit.committer ? data.commit.committer.date : null;
            var utc = dateIso ? formatUtc(dateIso) : null;
            el.textContent = utc
                ? 'Latest commit (main): ' + utc + ' \u2022 ' + sha
                : 'Latest commit (main): ' + sha;
        })
        .catch(function () {
            el.textContent = 'Latest commit (main): unavailable';
        });
    }

    function init() {
        document.body.prepend(buildNav());
        document.body.appendChild(buildFooter());
        updateFrameTime();
        setInterval(updateFrameTime, 1000);
        loadCommitStamp();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

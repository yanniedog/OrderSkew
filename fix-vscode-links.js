// Fix pages/ links when opened from VSCode (file:// or vscode-resource)
(function () {
    var host = window.location.host || '';
    var pathname = window.location.pathname || '';
    if (host.indexOf('vscode-resource') !== -1 || host.indexOf('vscode-cdn') !== -1) {
        if (pathname) {
            try {
                var path = decodeURIComponent(pathname);
                var base = path.replace(/\/[^/]*$/, '');
                var links = document.querySelectorAll('a[href^="pages/"]');
                links.forEach(function (link) {
                    var href = link.getAttribute('href');
                    if (!href) return;
                    link.setAttribute('href', 'file://' + base + '/' + href);
                });
            } catch (e) { }
        }
    }
})();

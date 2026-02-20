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
        commitUnavailableStatus: 'Latest commit (main): unavailable (',
        debugStorageKey: 'orderskew_universal_debug_log_v1',
        debugLabel: 'Download debug log',
        debugCountSuffix: 'entries'
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
    var fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Space+Grotesk:wght@500;600&display=swap';
    document.head.appendChild(fontLink);

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
                '<div class="os-frame-brand-block">' +
                    '<a class="os-frame-brand" href="' + mainHref + '">' + CONFIG.brand + '</a>' +
                '</div>' +
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
                '<span class="os-frame-sep" aria-hidden="true">|</span>' +
                '<a class="os-frame-debug-link" id="os-frame-debug-download" href="#" download="orderskew_debug.log">' + CONFIG.debugLabel + '</a>' +
                '<button class="os-frame-debug-btn" id="os-frame-debug-clear" type="button">Clear</button>' +
                '<span class="os-frame-debug-count" id="os-frame-debug-count">0 ' + CONFIG.debugCountSuffix + '</span>' +
            '</div>';
        return footer;
    }

    function createUniversalLogger() {
        if (window.OrderSkewDebugLogger) return window.OrderSkewDebugLogger;

        var state = {
            sessionId: Math.random().toString(36).slice(2, 10),
            seq: 0,
            maxEntries: 12000,
            maxPersistChars: 3500000,
            entries: [],
            dirty: false,
            saveTimer: null,
            blobUrl: null
        };
        var REDACTED = '[redacted]';
        var SENSITIVE_KEY_RE = /(password|token|secret|auth|api[_-]?key|access[_-]?key|refresh[_-]?token|authorization)/i;

        function safeJson(value) {
            var seen = new WeakSet();
            return JSON.stringify(value, function (key, val) {
                if (typeof val === 'object' && val !== null) {
                    if (seen.has(val)) return '[Circular]';
                    seen.add(val);
                }
                if (typeof val === 'number' && !isFinite(val)) return String(val);
                if (typeof val === 'string' && val.length > 2000) return val.slice(0, 2000) + '...[truncated]';
                return val;
            });
        }

        function targetSummary(target) {
            if (!target || typeof target !== 'object') return 'unknown';
            var el = target;
            if (!el.tagName) return String(el);
            var tag = String(el.tagName).toLowerCase();
            var id = el.id ? ('#' + el.id) : '';
            var cls = '';
            if (typeof el.className === 'string' && el.className.trim()) {
                cls = '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
            }
            var name = el.getAttribute && el.getAttribute('name');
            return tag + id + cls + (name ? ('[name=' + name + ']') : '');
        }

        function redactDeep(value, keyHint) {
            if (keyHint && SENSITIVE_KEY_RE.test(String(keyHint))) return REDACTED;
            if (value === null || value === undefined) return value;
            if (Array.isArray(value)) {
                return value.map(function (item) { return redactDeep(item, keyHint); });
            }
            if (typeof value === 'object') {
                var out = {};
                Object.keys(value).forEach(function (k) {
                    out[k] = redactDeep(value[k], k);
                });
                return out;
            }
            if (typeof value === 'string') {
                if (SENSITIVE_KEY_RE.test(String(keyHint || ''))) return REDACTED;
                return value.length > 5000 ? value.slice(0, 5000) + '...[truncated]' : value;
            }
            return value;
        }

        function redactStringPayload(raw) {
            if (typeof raw !== 'string') return raw;
            try {
                var parsed = JSON.parse(raw);
                return redactDeep(parsed, '');
            } catch (_) {
                return raw.length > 5000 ? raw.slice(0, 5000) + '...[truncated]' : raw;
            }
        }

        function storageLoad() {
            try {
                var raw = localStorage.getItem(CONFIG.debugStorageKey);
                if (!raw) return;
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed.entries)) state.entries = parsed.entries;
                if (typeof parsed.seq === 'number') state.seq = parsed.seq;
            } catch (_) {}
        }

        function trimForLimits() {
            if (state.entries.length > state.maxEntries) {
                state.entries = state.entries.slice(state.entries.length - state.maxEntries);
            }
            var packed = safeJson({ seq: state.seq, entries: state.entries });
            while (packed.length > state.maxPersistChars && state.entries.length > 1000) {
                state.entries = state.entries.slice(Math.floor(state.entries.length * 0.1));
                packed = safeJson({ seq: state.seq, entries: state.entries });
            }
            return packed;
        }

        function storageSaveNow() {
            state.saveTimer = null;
            if (!state.dirty) return;
            try {
                var packed = trimForLimits();
                localStorage.setItem(CONFIG.debugStorageKey, packed);
                state.dirty = false;
            } catch (_) {}
        }

        function scheduleSave() {
            state.dirty = true;
            if (state.saveTimer) return;
            state.saveTimer = window.setTimeout(storageSaveNow, 250);
        }

        function buildLogText() {
            var header = [
                'OrderSkew Universal Debug Log',
                'generated_at=' + new Date().toISOString(),
                'user_agent=' + navigator.userAgent,
                'page_url=' + window.location.href,
                'session_id=' + state.sessionId,
                'entry_count=' + state.entries.length,
                ''
            ].join('\n');
            var lines = state.entries.map(function (entry) { return safeJson(entry); });
            return header + lines.join('\n');
        }

        function updateFooterLink() {
            var link = document.getElementById('os-frame-debug-download');
            var count = document.getElementById('os-frame-debug-count');
            if (!link || !count) return;
            var blob = new Blob([buildLogText()], { type: 'text/plain;charset=utf-8' });
            var nextUrl = URL.createObjectURL(blob);
            if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
            state.blobUrl = nextUrl;
            link.href = nextUrl;
            link.download = 'orderskew_debug_' + new Date().toISOString().replace(/[:.]/g, '-') + '.log';
            count.textContent = state.entries.length + ' ' + CONFIG.debugCountSuffix;
        }

        function log(level, event, details) {
            state.seq += 1;
            state.entries.push({
                seq: state.seq,
                ts: new Date().toISOString(),
                level: level,
                event: event,
                details: redactDeep(details || {}, ''),
                page: {
                    href: window.location.href,
                    path: window.location.pathname,
                    title: document.title
                },
                session_id: state.sessionId
            });
            scheduleSave();
            updateFooterLink();
        }

        function serializeErrorLike(err) {
            if (!err) return null;
            if (typeof err === 'string') return { message: err };
            return {
                name: err.name || undefined,
                message: err.message || String(err),
                stack: err.stack ? String(err.stack).slice(0, 4000) : undefined
            };
        }

        function summarizeArg(arg) {
            if (arg === null || arg === undefined) return arg;
            if (typeof arg === 'string') return arg.length > 1000 ? arg.slice(0, 1000) + '...[truncated]' : arg;
            if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
            if (arg instanceof Error) return serializeErrorLike(arg);
            try {
                return JSON.parse(safeJson(redactDeep(arg, '')));
            } catch (_) {
                return String(arg);
            }
        }

        function clear() {
            state.entries = [];
            state.seq = 0;
            state.dirty = false;
            if (state.saveTimer) {
                window.clearTimeout(state.saveTimer);
                state.saveTimer = null;
            }
            try { localStorage.removeItem(CONFIG.debugStorageKey); } catch (_) {}
            updateFooterLink();
            log('DEBUG', 'logger.cleared', {});
        }

        function attachFooterActions() {
            var clearBtn = document.getElementById('os-frame-debug-clear');
            if (clearBtn && !clearBtn.__osBound) {
                clearBtn.__osBound = true;
                clearBtn.addEventListener('click', function () { clear(); });
            }
            updateFooterLink();
        }

        function installGlobalHooks() {
            if (window.__osUniversalDebugHooksInstalled) return;
            window.__osUniversalDebugHooksInstalled = true;

            window.addEventListener('error', function (event) {
                var target = event.target;
                if (target && target !== window) {
                    log('ERROR', 'resource.error', {
                        target: targetSummary(target),
                        src: target.currentSrc || target.src || target.href || null
                    });
                    return;
                }
                log('ERROR', 'window.error', {
                    message: event.message,
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    error: serializeErrorLike(event.error)
                });
            }, true);

            window.addEventListener('unhandledrejection', function (event) {
                log('ERROR', 'window.unhandledrejection', {
                    reason: summarizeArg(event.reason)
                });
            });

            window.addEventListener('securitypolicyviolation', function (event) {
                log('ERROR', 'security.csp_violation', {
                    blocked_uri: event.blockedURI,
                    violated_directive: event.violatedDirective,
                    effective_directive: event.effectiveDirective,
                    source_file: event.sourceFile,
                    line: event.lineNumber,
                    column: event.columnNumber
                });
            });

            window.addEventListener('offline', function () {
                log('WARN', 'network.offline', { href: window.location.href });
            });

            window.addEventListener('online', function () {
                log('DEBUG', 'network.online', { href: window.location.href });
            });

            document.addEventListener('click', function (event) {
                log('DEBUG', 'dom.click', {
                    target: targetSummary(event.target),
                    x: event.clientX,
                    y: event.clientY
                });
            }, true);

            document.addEventListener('change', function (event) {
                var target = event.target;
                var valueSummary = null;
                if (target && target.tagName) {
                    var tag = String(target.tagName).toLowerCase();
                    var inputType = target.type ? String(target.type).toLowerCase() : '';
                    var fieldKey = (target.name || target.id || inputType || '').toString();
                    var isSensitiveField = SENSITIVE_KEY_RE.test(fieldKey);
                    if (tag === 'select') {
                        valueSummary = isSensitiveField ? REDACTED : target.value;
                    } else if (inputType === 'checkbox' || inputType === 'radio') {
                        valueSummary = isSensitiveField ? REDACTED : { checked: !!target.checked, value: target.value };
                    } else if (inputType === 'password' || isSensitiveField) {
                        valueSummary = '[redacted]';
                    } else if (tag === 'input' || tag === 'textarea') {
                        var v = String(target.value || '');
                        valueSummary = v.length <= 120 ? v : (v.slice(0, 120) + '...[truncated]');
                    }
                }
                log('DEBUG', 'dom.change', {
                    target: targetSummary(event.target),
                    value: valueSummary
                });
            }, true);

            document.addEventListener('submit', function (event) {
                log('DEBUG', 'dom.submit', { target: targetSummary(event.target) });
            }, true);

            window.addEventListener('popstate', function () {
                log('DEBUG', 'nav.popstate', { href: window.location.href });
            });
            window.addEventListener('hashchange', function () {
                log('DEBUG', 'nav.hashchange', { href: window.location.href });
            });
            document.addEventListener('visibilitychange', function () {
                log('DEBUG', 'page.visibility', { state: document.visibilityState });
            });

            var originalPushState = history.pushState;
            history.pushState = function () {
                var out = originalPushState.apply(history, arguments);
                log('DEBUG', 'history.pushState', {
                    url: arguments.length > 2 ? arguments[2] : null
                });
                return out;
            };

            var originalReplaceState = history.replaceState;
            history.replaceState = function () {
                var out = originalReplaceState.apply(history, arguments);
                log('DEBUG', 'history.replaceState', {
                    url: arguments.length > 2 ? arguments[2] : null
                });
                return out;
            };

            if (window.fetch) {
                var nativeFetch = window.fetch.bind(window);
                window.fetch = function (input, init) {
                    var method = (init && init.method) || 'GET';
                    var url = typeof input === 'string' ? input : (input && input.url) || '';
                    var started = performance.now();
                    var bodyPreview = init && typeof init.body === 'string' ? redactStringPayload(init.body) : undefined;
                    log('DEBUG', 'net.fetch.request', { method: method, url: url, body: bodyPreview });
                    return nativeFetch(input, init).then(function (res) {
                        var level = res.ok ? 'DEBUG' : 'ERROR';
                        log(level, res.ok ? 'net.fetch.response' : 'net.fetch.http_error', {
                            method: method,
                            url: url,
                            status: res.status,
                            ok: res.ok,
                            elapsed_ms: Math.round(performance.now() - started)
                        });
                        return res;
                    }).catch(function (err) {
                        log('ERROR', 'net.fetch.error', {
                            method: method,
                            url: url,
                            elapsed_ms: Math.round(performance.now() - started),
                            error: err ? String(err.message || err) : 'unknown'
                        });
                        throw err;
                    });
                };
            }

            if (window.XMLHttpRequest) {
                var open = XMLHttpRequest.prototype.open;
                var send = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function (method, url) {
                    this.__osMethod = method;
                    this.__osUrl = url;
                    this.__osStarted = performance.now();
                    return open.apply(this, arguments);
                };
                XMLHttpRequest.prototype.send = function (body) {
                    log('DEBUG', 'net.xhr.request', {
                        method: this.__osMethod || 'GET',
                        url: this.__osUrl || '',
                        body: typeof body === 'string' ? redactStringPayload(body) : undefined
                    });
                    this.addEventListener('loadend', function () {
                        var ok = this.status >= 200 && this.status < 400;
                        log(ok ? 'DEBUG' : 'ERROR', ok ? 'net.xhr.response' : 'net.xhr.http_error', {
                            method: this.__osMethod || 'GET',
                            url: this.__osUrl || '',
                            status: this.status,
                            elapsed_ms: Math.round(performance.now() - (this.__osStarted || performance.now()))
                        });
                    });
                    this.addEventListener('error', function () {
                        log('ERROR', 'net.xhr.error', {
                            method: this.__osMethod || 'GET',
                            url: this.__osUrl || ''
                        });
                    });
                    this.addEventListener('timeout', function () {
                        log('ERROR', 'net.xhr.timeout', {
                            method: this.__osMethod || 'GET',
                            url: this.__osUrl || ''
                        });
                    });
                    this.addEventListener('abort', function () {
                        log('WARN', 'net.xhr.abort', {
                            method: this.__osMethod || 'GET',
                            url: this.__osUrl || ''
                        });
                    });
                    return send.apply(this, arguments);
                };
            }

            if (window.Worker && !window.Worker.__osWrapped) {
                var NativeWorker = window.Worker;
                var WrappedWorker = function (scriptURL, options) {
                    var worker = options === undefined ? new NativeWorker(scriptURL) : new NativeWorker(scriptURL, options);
                    log('DEBUG', 'worker.create', { script: String(scriptURL || '') });
                    worker.addEventListener('error', function (event) {
                        log('ERROR', 'worker.error', {
                            script: String(scriptURL || ''),
                            message: event && event.message,
                            filename: event && event.filename,
                            lineno: event && event.lineno,
                            colno: event && event.colno
                        });
                    });
                    worker.addEventListener('messageerror', function (event) {
                        log('ERROR', 'worker.messageerror', {
                            script: String(scriptURL || ''),
                            data: summarizeArg(event && event.data)
                        });
                    });
                    return worker;
                };
                WrappedWorker.prototype = NativeWorker.prototype;
                Object.setPrototypeOf(WrappedWorker, NativeWorker);
                WrappedWorker.__osWrapped = true;
                window.Worker = WrappedWorker;
            }

            if (window.console && !window.console.__osWrapped) {
                var originalError = console.error ? console.error.bind(console) : null;
                var originalWarn = console.warn ? console.warn.bind(console) : null;
                if (originalError) {
                    console.error = function () {
                        try {
                            var args = Array.prototype.slice.call(arguments).map(summarizeArg);
                            log('ERROR', 'console.error', { args: args });
                        } catch (_) {}
                        return originalError.apply(console, arguments);
                    };
                }
                if (originalWarn) {
                    console.warn = function () {
                        try {
                            var args = Array.prototype.slice.call(arguments).map(summarizeArg);
                            log('WARN', 'console.warn', { args: args });
                        } catch (_) {}
                        return originalWarn.apply(console, arguments);
                    };
                }
                window.console.__osWrapped = true;
            }

            window.addEventListener('pagehide', function () {
                storageSaveNow();
            });
            window.addEventListener('beforeunload', function () {
                storageSaveNow();
            });
        }

        storageLoad();
        var logger = {
            log: log,
            clear: clear,
            updateFooter: attachFooterActions,
            flush: storageSaveNow
        };
        window.OrderSkewDebugLogger = logger;
        window.OrderSkewLog = function (level, event, details) {
            try { log(level || 'DEBUG', event || 'custom.event', details || {}); } catch (_) {}
        };
        installGlobalHooks();
        log('DEBUG', 'logger.init', {
            persisted_entries: state.entries.length,
            user_agent: navigator.userAgent
        });
        return logger;
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
        var logger = createUniversalLogger();
        logger.updateFooter();
        loadCommitStamp();
    }

    createUniversalLogger();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

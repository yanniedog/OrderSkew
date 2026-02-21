// NAB Homeloan Calculator - pure date/number/format helpers (loaded before app.js)
(function () {
    window.NABUtils = {
        FREQ: {
            monthly: { periodsPerYear: 12, dayStep: 30 },
            fortnightly: { periodsPerYear: 26, dayStep: 14 },
            weekly: { periodsPerYear: 52, dayStep: 7 }
        },
        n: function (v) { var x = Number(v); return Number.isFinite(x) ? x : NaN; },
        optN: function (v) { var x = Number(v); return Number.isFinite(x) ? x : null; },
        isValidDate: function (d) { return d instanceof Date && Number.isFinite(d.getTime()); },
        dateSerial: function (d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); },
        dateCmp: function (a, b) { return Math.sign(window.NABUtils.dateSerial(a) - window.NABUtils.dateSerial(b)); },
        daysBetween: function (a, b) { return Math.max(0, Math.round((window.NABUtils.dateSerial(b) - window.NABUtils.dateSerial(a)) / 86400000)); },
        isLeapYear: function (y) { return ((y % 4 === 0) && (y % 100 !== 0)) || (y % 400 === 0); },
        parseDate: function (s) {
            if (!s || typeof s !== 'string') return null;
            var trimmed = s.trim();
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
            if (m) {
                var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
                return (d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) ? d : null;
            }
            m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2}|\d{4})$/.exec(trimmed);
            if (!m) return null;
            var monthMap = {
                jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
                may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
                september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
            };
            var day = Number(m[1]);
            var month = monthMap[m[2].toLowerCase()];
            if (!Number.isInteger(month)) return null;
            var year = Number(m[3]);
            if (year < 100) year = year >= 70 ? 1900 + year : 2000 + year;
            var d2 = new Date(year, month, day);
            return (d2.getFullYear() === year && d2.getMonth() === month && d2.getDate() === day) ? d2 : null;
        },
        dateKey: function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
        monthKey: function (d) { return window.NABUtils.dateKey(d).slice(0, 7); },
        cloneDate: function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },
        addDays: function (d, days) { var x = window.NABUtils.cloneDate(d); x.setDate(x.getDate() + days); return x; },
        daysInMonth: function (d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); },
        fmtDate: function (d) { return d instanceof Date ? d.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: '2-digit' }) : '-'; },
        money: function (v) {
            var x = Number(v);
            if (!Number.isFinite(x)) return '-';
            return x.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
        compactMoney: function (v) {
            var x = Number(v);
            if (!Number.isFinite(x)) return '-';
            if (Math.abs(x) >= 1000000) return (x / 1000000).toFixed(1) + 'm';
            if (Math.abs(x) >= 1000) return (x / 1000).toFixed(0) + 'k';
            return x.toFixed(0);
        },
        pct: function (v) { return Number.isFinite(v) ? v.toFixed(2) + '%' : '-'; },
        htmlDecode: function (s) {
            if (typeof s !== 'string' || s.indexOf('&') === -1) return s || '';
            var t = document.createElement('textarea');
            t.innerHTML = s;
            return t.value;
        }
    };
})();

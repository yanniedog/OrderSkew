(function () {
    const els = {
        form: document.getElementById('loan-form'),
        loanAmount: document.getElementById('loan-amount'),
        interestRate: document.getElementById('interest-rate'),
        loanTermYears: document.getElementById('loan-term-years'),
        repaymentFrequency: document.getElementById('repayment-frequency'),
        offsetBalance: document.getElementById('offset-balance'),
        extraRepayment: document.getElementById('extra-repayment'),
        startDate: document.getElementById('start-date'),
        resetBtn: document.getElementById('reset-btn'),
        downloadCsvBtn: document.getElementById('download-csv-btn'),
        scheduleBody: document.getElementById('schedule-body'),
        scheduleNote: document.getElementById('schedule-note'),
        errorBox: document.getElementById('error-box'),
        chartCanvas: document.getElementById('balance-chart'),

        minimumRepayment: document.getElementById('minimum-repayment'),
        plannedRepayment: document.getElementById('planned-repayment'),
        payoffDate: document.getElementById('payoff-date'),
        baselineInterest: document.getElementById('baseline-interest'),
        optimizedInterest: document.getElementById('optimized-interest'),
        interestSaved: document.getElementById('interest-saved'),
        termReduction: document.getElementById('term-reduction'),
        totalPaid: document.getElementById('total-paid'),

        pocketsmithFile: document.getElementById('pocketsmithFile'),
        uploadBtn: document.getElementById('uploadBtn'),
        analyzeBtn: document.getElementById('analyzeBtn'),
        selectedFileName: document.getElementById('selectedFileName'),
        uploadStatus: document.getElementById('uploadStatus'),
        groundTruthSection: document.getElementById('groundTruthSection'),
        currentInterestRate: document.getElementById('currentInterestRate'),
        asOfDate: document.getElementById('asOfDate'),
        scheduledMonthlyRepayment: document.getElementById('scheduledMonthlyRepayment'),
        skipGroundTruthBtn: document.getElementById('skipGroundTruthBtn'),
        submitWithGroundTruthBtn: document.getElementById('submitWithGroundTruthBtn'),

        analysisSummary: document.getElementById('analysisSummary'),
        analyzedEffectiveRate: document.getElementById('analyzedEffectiveRate'),
        analyzedPayoffDate: document.getElementById('analyzedPayoffDate'),
        analyzedTransactionCount: document.getElementById('analyzedTransactionCount'),
        analyzedCurrentRate: document.getElementById('analyzedCurrentRate'),
        analyzedCurrentMargin: document.getElementById('analyzedCurrentMargin'),
        analyzedRateChange: document.getElementById('analyzedRateChange'),
        analyzedTotalSavings: document.getElementById('analyzedTotalSavings'),
        analyzedAvgOffset: document.getElementById('analyzedAvgOffset'),
        analyzedProjectedSavings: document.getElementById('analyzedProjectedSavings'),
        analyzedAccounts: document.getElementById('analyzedAccounts')
    };

    const FREQ = {
        monthly: { periodsPerYear: 12, dayStep: 30 },
        fortnightly: { periodsPerYear: 26, dayStep: 14 },
        weekly: { periodsPerYear: 52, dayStep: 7 }
    };

    const state = {
        selectedFile: null,
        transactions: [],
        lastOptimizedSchedule: [],
        lastBaselineSchedule: [],
        lastFrequency: 'monthly'
    };

    function n(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }
    function optN(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
    function isValidDate(d) { return d instanceof Date && Number.isFinite(d.getTime()); }
    function dateSerial(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
    function dateCmp(a, b) { return Math.sign(dateSerial(a) - dateSerial(b)); }
    function daysBetween(a, b) { return Math.max(0, Math.round((dateSerial(b) - dateSerial(a)) / 86400000)); }
    function isLeapYear(y) { return ((y % 4 === 0) && (y % 100 !== 0)) || (y % 400 === 0); }
    function parseDate(s) {
        if (!s || typeof s !== 'string') return null;
        const trimmed = s.trim();
        let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
        if (m) {
            const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            return (d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) ? d : null;
        }

        m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2}|\d{4})$/.exec(trimmed);
        if (!m) return null;
        const monthMap = {
            jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
            may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
            september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
        };
        const day = Number(m[1]);
        const month = monthMap[m[2].toLowerCase()];
        if (!Number.isInteger(month)) return null;
        let year = Number(m[3]);
        if (year < 100) year = year >= 70 ? 1900 + year : 2000 + year;
        const d = new Date(year, month, day);
        return (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) ? d : null;
    }
    function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    function monthKey(d) { return dateKey(d).slice(0, 7); }
    function cloneDate(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function addDays(d, days) { const x = cloneDate(d); x.setDate(x.getDate() + days); return x; }
    function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
    function fmtDate(d) { return d instanceof Date ? d.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: '2-digit' }) : '-'; }
    function money(v) {
        const x = Number(v);
        if (!Number.isFinite(x)) return '-';
        return x.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function compactMoney(v) {
        const x = Number(v);
        if (!Number.isFinite(x)) return '-';
        if (Math.abs(x) >= 1000000) return `${(x / 1000000).toFixed(1)}m`;
        if (Math.abs(x) >= 1000) return `${(x / 1000).toFixed(0)}k`;
        return x.toFixed(0);
    }
    function pct(v) { return Number.isFinite(v) ? `${v.toFixed(2)}%` : '-'; }
    function htmlDecode(s) {
        if (typeof s !== 'string' || !s.includes('&')) return s || '';
        const t = document.createElement('textarea');
        t.innerHTML = s;
        return t.value;
    }

    function setUploadStatus(msg, level) {
        els.uploadStatus.textContent = msg;
        els.uploadStatus.className = 'status-box';
        if (level) els.uploadStatus.classList.add(level);
    }
    function showError(msg) { els.errorBox.textContent = msg; els.errorBox.classList.remove('hidden'); }
    function hideError() { els.errorBox.textContent = ''; els.errorBox.classList.add('hidden'); }

    function setDefaultDate() { els.startDate.value = dateKey(new Date()); }

    function parseCsvRecords(text) {
        if (typeof text !== 'string') return [];
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

        for (let i = 0; i < src.length; i += 1) {
            const ch = src[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (src[i + 1] === '"') {
                        field += '"';
                        i += 1;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += ch;
                }
                continue;
            }

            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(field);
                field = '';
            } else if (ch === '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else if (ch === '\r') {
                // Ignore.
            } else {
                field += ch;
            }
        }

        row.push(field);
        if (!(row.length === 1 && row[0] === '')) rows.push(row);
        return rows;
    }

    function parseAmount(raw) {
        if (raw === undefined || raw === null) return null;
        let s = String(raw).trim();
        if (!s) return null;
        let negative = false;
        if (/^\(.*\)$/.test(s)) {
            negative = true;
            s = s.slice(1, -1);
        }
        s = s.replace(/[\$,\s]/g, '');
        if (s.startsWith('-')) {
            negative = true;
            s = s.slice(1);
        } else if (s.startsWith('+')) {
            s = s.slice(1);
        }
        if (!s || !/^\d*\.?\d+$/.test(s)) return null;
        const x = Number(s);
        if (!Number.isFinite(x)) return null;
        return negative ? -x : x;
    }

    function colIndex(headers, name) {
        const lower = name.toLowerCase();
        const exact = headers.indexOf(name);
        if (exact >= 0) return exact;
        const i = headers.findIndex((h) => h.trim().toLowerCase() === lower);
        return i >= 0 ? i : -1;
    }

    function parsePocketsmithCsv(text) {
        const records = parseCsvRecords(text).filter((r) => r.some((v) => String(v || '').trim() !== ''));
        if (records.length < 2) throw new Error('CSV appears empty.');
        const headers = records[0].map((h) => h.trim());
        const idxDate = colIndex(headers, 'Date');
        if (idxDate < 0) throw new Error("CSV missing 'Date' column.");
        const idxAmount = colIndex(headers, 'Amount');
        if (idxAmount < 0) throw new Error("CSV missing 'Amount' column.");
        const idxAccount = colIndex(headers, 'Account');
        if (idxAccount < 0) throw new Error("CSV missing 'Account' column.");
        const idxClosingBalance = colIndex(headers, 'Closing Balance');
        const idxMerchant = colIndex(headers, 'Merchant');
        const idxMemo = colIndex(headers, 'Memo');
        const idxCategory = colIndex(headers, 'Category');
        const rows = [];
        for (let i = 1; i < records.length; i += 1) {
            const cols = records[i];
            const date = parseDate(cols[idxDate] || '');
            if (!date) continue;
            const amount = parseAmount(idxAmount >= 0 ? cols[idxAmount] : undefined);
            const balance = parseAmount(idxClosingBalance >= 0 ? cols[idxClosingBalance] : undefined);
            const account = htmlDecode((idxAccount >= 0 ? cols[idxAccount] : '').trim());
            if (!account || amount === null) continue;
            const descCol = idxMerchant >= 0 ? cols[idxMerchant] : (idxMemo >= 0 ? cols[idxMemo] : '');
            const catCol = idxCategory >= 0 ? cols[idxCategory] : '';
            rows.push({
                date,
                amount,
                account,
                description: htmlDecode((descCol || '').trim()),
                category: (catCol || '').trim(),
                closing_balance: balance,
                row_index: i + 1
            });
        }
        rows.sort((a, b) => dateCmp(a.date, b.date) || (a.row_index - b.row_index));
        if (!rows.length) throw new Error('No valid transactions found.');
        return rows;
    }

    function classifyAccounts(rows) {
        const stats = new Map();
        rows.forEach((r) => {
            const s = stats.get(r.account) || {
                neg: 0,
                count: 0,
                hasOffsetKeyword: false,
                hasLoanKeyword: false,
                repaymentDebitHits: 0
            };
            const accountLower = r.account.toLowerCase();
            const descLower = (r.description || '').toLowerCase();
            s.count += 1;
            if (Number.isFinite(r.closing_balance) && r.closing_balance < 0) s.neg += 1;
            if (accountLower.includes('offset')) s.hasOffsetKeyword = true;
            if (!accountLower.includes('offset') && (accountLower.includes('mortgage') || accountLower.includes('home loan') || accountLower.includes('loan'))) {
                s.hasLoanKeyword = true;
            }
            if (descLower.startsWith('loan repayment') && r.amount < 0) s.repaymentDebitHits += 1;
            stats.set(r.account, s);
        });
        const accounts = [...stats.keys()];

        let loan = accounts.filter((a) => (stats.get(a) || {}).hasLoanKeyword);
        if (!loan.length) {
            loan = accounts.filter((a) => {
                const s = stats.get(a) || {};
                return (s.neg / Math.max(1, s.count || 0)) >= 0.6;
            });
        }
        if (!loan.length) {
            const ranked = accounts.map((a) => {
                const related = rows.filter((r) => r.account === a && Number.isFinite(r.closing_balance));
                const avgAbs = related.length
                    ? related.reduce((sum, r) => sum + Math.abs(r.closing_balance), 0) / related.length
                    : 0;
                return { account: a, avgAbs };
            }).sort((a, b) => b.avgAbs - a.avgAbs);
            if (ranked.length) loan = [ranked[0].account];
        }

        let offset = accounts.filter((a) => !loan.includes(a) && (stats.get(a) || {}).hasOffsetKeyword);
        if (!offset.length) {
            offset = accounts.filter((a) => !loan.includes(a) && (stats.get(a) || {}).repaymentDebitHits > 0);
        }

        const ignored = accounts.filter((a) => !loan.includes(a) && !offset.includes(a));
        const warning = !offset.length
            ? 'No offset accounts were auto-detected. Offset savings are disabled until an offset account is identified.'
            : null;
        return { loan, offset, ignored, warning };
    }

    function isInterestTxn(r) {
        const desc = (r.description || '').toLowerCase();
        const cat = (r.category || '').toLowerCase();
        return desc.includes('interest charged') || cat === 'interest' || cat.includes('interest');
    }

    function getInterestTxns(rows, loanAccounts) {
        return rows
            .filter((r) => loanAccounts.includes(r.account) && Number.isFinite(r.amount) && Math.abs(r.amount) > 0 && isInterestTxn(r))
            .sort((a, b) => dateCmp(a.date, b.date) || (a.row_index - b.row_index));
    }

    function extractRateNotices(rows, loanAccounts) {
        const notices = [];
        rows.forEach((r) => {
            if (!loanAccounts.includes(r.account)) return;
            const desc = String(r.description || '');
            if (!/interest rate/i.test(desc)) return;
            const match = /interest rate(?:\s+is|\s+to|\s*:)??\s*([0-9]+(?:\.[0-9]+)?)%/i.exec(desc);
            if (!match) return;
            const rate = Number(match[1]);
            if (!Number.isFinite(rate)) return;
            notices.push({ date: cloneDate(r.date), rate });
        });
        notices.sort((a, b) => dateCmp(a.date, b.date));
        return notices;
    }

    function getRateNoticeForDate(rateNotices, targetDate) {
        let latest = null;
        rateNotices.forEach((n) => {
            if (dateCmp(n.date, targetDate) <= 0) latest = n.rate;
        });
        return latest;
    }

    function buildDailyBalances(rows, loanAccounts, offsetAccounts, asOfDate) {
        const relevant = rows.filter((r) => loanAccounts.includes(r.account) || offsetAccounts.includes(r.account));
        if (!relevant.length) return [];

        const interestByDate = {};
        getInterestTxns(rows, loanAccounts).forEach((r) => {
            const key = dateKey(r.date);
            interestByDate[key] = (interestByDate[key] || 0) + Math.abs(r.amount);
        });

        let minDate = cloneDate(relevant[0].date);
        let maxDate = cloneDate(relevant[0].date);
        relevant.forEach((r) => {
            if (dateCmp(r.date, minDate) < 0) minDate = cloneDate(r.date);
            if (dateCmp(r.date, maxDate) > 0) maxDate = cloneDate(r.date);
        });
        if (isValidDate(asOfDate) && dateCmp(asOfDate, maxDate) < 0) maxDate = cloneDate(asOfDate);

        const byAccDate = {};
        [...loanAccounts, ...offsetAccounts].forEach((a) => { byAccDate[a] = {}; });
        relevant.forEach((r) => {
            if (!Number.isFinite(r.closing_balance)) return;
            byAccDate[r.account][dateKey(r.date)] = r.closing_balance;
        });

        const current = {};
        const out = [];
        for (let d = cloneDate(minDate); dateCmp(d, maxDate) <= 0; d = addDays(d, 1)) {
            const dayKey = dateKey(d);
            Object.keys(byAccDate).forEach((a) => {
                if (Number.isFinite(byAccDate[a][dayKey])) current[a] = byAccDate[a][dayKey];
            });

            let loanBal = 0;
            loanAccounts.forEach((a) => { if (Number.isFinite(current[a])) loanBal += Math.abs(current[a]); });
            let offsetBal = 0;
            offsetAccounts.forEach((a) => { if (Number.isFinite(current[a])) offsetBal += current[a]; });

            const adjustedLoan = Math.max(0, loanBal - (interestByDate[dayKey] || 0));
            const net = Math.max(0, adjustedLoan - offsetBal);
            out.push({
                date: cloneDate(d),
                loan_balance: loanBal,
                interest_adjusted_loan_balance: adjustedLoan,
                offset_balance: offsetBal,
                net_balance: net
            });
        }
        return out;
    }

    function buildInterestPeriod(periodStart, periodEnd, interestTxn, dailyMap, lastRatePa, noticeRatePa) {
        let sumNet = 0;
        let sumLoan = 0;
        let sumOffset = 0;
        for (let d = cloneDate(periodStart); dateCmp(d, periodEnd) <= 0; d = addDays(d, 1)) {
            const daily = dailyMap[dateKey(d)];
            if (!daily) continue;
            sumNet += daily.net_balance;
            sumLoan += daily.loan_balance;
            sumOffset += daily.offset_balance;
        }

        const daysInPeriod = Math.max(1, daysBetween(periodStart, addDays(periodEnd, 1)));
        const avgNet = sumNet / daysInPeriod;
        const daysInCurrentMonth = daysInMonth(periodEnd);

        const interestPaid = interestTxn ? Math.abs(interestTxn.amount) : 0;
        let annualRatePa = 0;
        let computedRatePa = 0;
        let interestAccrued = interestPaid;
        let accrualSource = interestPaid > 0 ? 'charged' : 'none';

        if (sumNet > 0 && interestPaid > 0) {
            const dailyRate = interestPaid / sumNet;
            computedRatePa = dailyRate * 365 * 100;
        }
        if (interestPaid <= 0 && sumNet > 0) {
            const baseRatePa = noticeRatePa || lastRatePa || 0;
            if (baseRatePa > 0) {
                const dailyRate = (baseRatePa / 100) / 365;
                interestAccrued = dailyRate * sumNet;
                accrualSource = 'prorated';
            }
        }

        if (noticeRatePa) annualRatePa = noticeRatePa;
        else if (computedRatePa > 0) annualRatePa = computedRatePa;
        else if (lastRatePa) annualRatePa = lastRatePa;

        const interestForRate = interestPaid > 0 ? interestPaid : interestAccrued;
        const effectiveRate = (avgNet > 0 && interestForRate > 0)
            ? (interestForRate / avgNet) * (daysInCurrentMonth / daysInPeriod) * 100
            : 0;

        return {
            period_start: cloneDate(periodStart),
            period_end: cloneDate(periodEnd),
            days_in_period: daysInPeriod,
            days_in_month: daysInCurrentMonth,
            interest_paid: interestPaid,
            interest_accrued: interestAccrued,
            interest_accrual_source: accrualSource,
            annual_rate_pa: annualRatePa,
            effective_rate: effectiveRate,
            is_partial_period: interestPaid <= 0,
            average_net_balance: avgNet,
            average_loan_balance: sumLoan / daysInPeriod,
            average_offset_balance: sumOffset / daysInPeriod
        };
    }

    function summarizeLoanTransactions(rows, loanAccounts, periodStart, periodEnd, scheduledMonthlyRepayment) {
        let principal = 0;
        let voluntary = 0;
        let fees = 0;
        let feeRefunds = 0;
        let otherDebits = 0;
        let otherCredits = 0;
        let transactionCount = 0;

        rows.forEach((r) => {
            if (!loanAccounts.includes(r.account)) return;
            if (dateCmp(r.date, periodStart) < 0 || dateCmp(r.date, periodEnd) > 0) return;
            transactionCount += 1;

            const amount = -r.amount;
            const desc = String(r.description || '');
            const descLower = desc.toLowerCase();

            if (isInterestTxn(r)) return;
            if (descLower.includes('fee') || descLower.includes('fees') || descLower.includes('refund')) {
                if (amount > 0) fees += amount;
                else if (amount < 0) feeRefunds += Math.abs(amount);
                return;
            }

            if (amount < 0) {
                const payment = Math.abs(amount);
                let isScheduled = false;
                if (Number.isFinite(scheduledMonthlyRepayment) && scheduledMonthlyRepayment > 0) {
                    isScheduled = Math.abs(payment - scheduledMonthlyRepayment) <= 0.01;
                } else {
                    isScheduled = desc.toUpperCase().startsWith('LOAN REPAYMENT');
                }
                if (isScheduled) principal += payment;
                else voluntary += payment;
            } else if (amount > 0) {
                otherDebits += amount;
            } else {
                otherCredits += Math.abs(amount);
            }
        });

        return {
            principal_payments: principal,
            voluntary_repayments: voluntary,
            fees,
            fee_refunds: feeRefunds,
            other_debits: otherDebits,
            other_credits: otherCredits,
            transaction_count: transactionCount
        };
    }

    function detectRecurringRepayment(rows, loanAccounts, explicitScheduled) {
        if (Number.isFinite(explicitScheduled) && explicitScheduled > 0) return explicitScheduled;
        if (!Array.isArray(rows) || !rows.length || !Array.isArray(loanAccounts) || !loanAccounts.length) return null;

        const preferred = [];
        const fallback = [];
        rows.forEach((r) => {
            if (!loanAccounts.includes(r.account)) return;
            if (isInterestTxn(r)) return;
            const descLower = String(r.description || '').toLowerCase();
            if (descLower.includes('fee') || descLower.includes('refund')) return;

            const normalized = -r.amount;
            if (!(normalized < 0)) return;
            const payment = Math.round(Math.abs(normalized) * 100) / 100;
            if (!(payment > 0)) return;

            if (descLower.startsWith('loan repayment')) preferred.push(payment);
            fallback.push(payment);
        });

        const sample = preferred.length >= 2 ? preferred : fallback;
        if (!sample.length) return null;

        const bins = new Map();
        sample.forEach((v) => {
            const key = v.toFixed(2);
            bins.set(key, (bins.get(key) || 0) + 1);
        });

        const ranked = [...bins.entries()].sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return Number(b[0]) - Number(a[0]);
        });
        return ranked.length ? Number(ranked[0][0]) : null;
    }

    function projectPayoffDate(monthly, currentBalance, currentRate) {
        if (!(currentBalance > 0)) return new Date();
        if (!monthly.length) return addDays(new Date(), 365);

        const recent = monthly.slice(-6);
        let avgPrincipal = recent.reduce((sum, m) => sum + m.principal_payments + m.voluntary_repayments, 0) / Math.max(1, recent.length);
        if (!(avgPrincipal > 0)) avgPrincipal = currentBalance * 0.02;

        let balance = currentBalance;
        let months = 0;
        while (balance > 0.01 && months < 600) {
            balance = balance - avgPrincipal + (balance * (currentRate / 100));
            months += 1;
        }
        return addDays(monthly[monthly.length - 1].date, months * 30);
    }

    function calculateDailyCompoundingInterest(balance, ratePa, days) {
        if (!(balance > 0) || !(ratePa > 0) || !(days > 0)) return 0;
        const dailyRate = (ratePa / 100) / 365;
        return balance * (Math.pow(1 + dailyRate, days) - 1);
    }

    function calculateOffsetBenefitsFromDaily(dailyBalances, monthly) {
        if (!dailyBalances.length || !monthly.length) {
            return {
                totalSavings: 0,
                averageOffset: 0,
                projectedAnnualSavings: 0
            };
        }

        const dailyMap = {};
        dailyBalances.forEach((d) => { dailyMap[dateKey(d.date)] = d; });

        let totalSavings = 0;
        let offsetSum = 0;
        let lastOffset = 0;
        let lastEffectiveRate = 0;
        monthly.forEach((m) => {
            let sumOffset = 0;
            let sumLoan = 0;
            let sumNet = 0;
            for (let d = cloneDate(m.period_start); dateCmp(d, m.period_end) <= 0; d = addDays(d, 1)) {
                const daily = dailyMap[dateKey(d)];
                if (!daily) continue;
                sumOffset += daily.offset_balance;
                sumLoan += daily.interest_adjusted_loan_balance;
                sumNet += daily.net_balance;
            }

            const withOffset = (m.interest_paid > 0) ? m.interest_paid : m.interest_accrued;
            const dailyRate = (sumNet > 0 && withOffset > 0) ? (withOffset / sumNet) : 0;
            const withoutOffset = dailyRate > 0 ? (dailyRate * sumLoan) : withOffset;
            const savings = Math.max(0, withoutOffset - withOffset);
            totalSavings += savings;
            offsetSum += m.average_offset_balance;
            lastOffset = m.average_offset_balance;
            lastEffectiveRate = m.effective_rate;
        });

        const averageOffset = offsetSum / monthly.length;
        const projectedAnnualSavings = (lastOffset > 0 && lastEffectiveRate > 0)
            ? calculateDailyCompoundingInterest(lastOffset, lastEffectiveRate * 12, 365)
            : 0;

        return { totalSavings, averageOffset, projectedAnnualSavings };
    }

    function summarize(rows, gt) {
        const { loan, offset, ignored, warning } = classifyAccounts(rows);
        if (!loan.length) throw new Error('No loan accounts detected in this file.');
        const dailyBalances = buildDailyBalances(rows, loan, offset, gt.as_of_date);
        if (!dailyBalances.length) throw new Error('No daily balance timeline could be built for detected accounts.');

        const dailyMap = {};
        dailyBalances.forEach((d) => { dailyMap[dateKey(d.date)] = d; });

        const minDate = cloneDate(dailyBalances[0].date);
        const lastDailyDate = cloneDate(dailyBalances[dailyBalances.length - 1].date);
        const interestTxns = getInterestTxns(rows, loan);
        const rateNotices = extractRateNotices(rows, loan);
        const periods = [];
        let previousEnd = null;
        let lastRatePa = null;

        interestTxns.forEach((txn) => {
            if (dateCmp(txn.date, lastDailyDate) > 0) return;
            const periodStart = previousEnd ? addDays(previousEnd, 1) : minDate;
            const periodEnd = cloneDate(txn.date);
            if (dateCmp(periodEnd, periodStart) < 0) return;

            const noticeRatePa = getRateNoticeForDate(rateNotices, periodEnd);
            const period = buildInterestPeriod(periodStart, periodEnd, txn, dailyMap, lastRatePa, noticeRatePa);
            periods.push(period);
            previousEnd = periodEnd;
            if (period.annual_rate_pa > 0) lastRatePa = period.annual_rate_pa;
        });

        if (!previousEnd) {
            periods.push(buildInterestPeriod(minDate, lastDailyDate, null, dailyMap, lastRatePa, getRateNoticeForDate(rateNotices, lastDailyDate)));
        } else if (dateCmp(lastDailyDate, previousEnd) > 0) {
            const partialStart = addDays(previousEnd, 1);
            periods.push(buildInterestPeriod(partialStart, lastDailyDate, null, dailyMap, lastRatePa, getRateNoticeForDate(rateNotices, lastDailyDate)));
        }

        const detectedScheduledRepayment = detectRecurringRepayment(rows, loan, gt.scheduled_monthly_repayment);
        const out = periods.sort((a, b) => dateCmp(a.period_end, b.period_end)).map((period) => {
            const txSummary = summarizeLoanTransactions(rows, loan, period.period_start, period.period_end, gt.scheduled_monthly_repayment);
            const startBal = (dailyMap[dateKey(period.period_start)] || {}).loan_balance || 0;
            const endBal = (dailyMap[dateKey(period.period_end)] || {}).loan_balance || 0;
            let displayInterest = period.interest_accrued;
            if (period.is_partial_period && period.days_in_period > 0 && period.days_in_month > 0) {
                displayInterest = displayInterest * (period.days_in_month / period.days_in_period);
            }
            return {
                month: monthKey(period.period_end),
                date: cloneDate(period.period_end),
                period_start: cloneDate(period.period_start),
                period_end: cloneDate(period.period_end),
                start_balance: startBal,
                end_balance: endBal,
                principal_payments: txSummary.principal_payments,
                voluntary_repayments: txSummary.voluntary_repayments,
                interest_paid: period.interest_paid,
                interest_accrued: period.interest_accrued,
                interest_accrual_source: period.interest_accrual_source,
                interest_charged: period.interest_paid,
                fees: txSummary.fees,
                fee_refunds: txSummary.fee_refunds,
                other_debits: txSummary.other_debits,
                other_credits: txSummary.other_credits,
                effective_rate: period.effective_rate,
                annual_rate_pa: period.annual_rate_pa,
                expected_interest: displayInterest,
                transaction_count: txSummary.transaction_count,
                days_in_period: period.days_in_period,
                days_in_month: period.days_in_month,
                is_partial_period: period.is_partial_period,
                average_net_balance: period.average_net_balance,
                average_loan_balance: period.average_loan_balance,
                average_offset_balance: period.average_offset_balance
            };
        });

        let weightedInterest = 0;
        let weightedNet = 0;
        let totalDays = 0;
        out.forEach((m) => {
            weightedInterest += m.interest_accrued || 0;
            weightedNet += (m.average_net_balance || 0) * (m.days_in_period || 0);
            totalDays += m.days_in_period || 0;
        });
        const eff = (weightedNet > 0 && totalDays > 0 && out.length > 0)
            ? (weightedInterest / weightedNet) * (totalDays / out.length) * 100
            : 0;

        const last = out[out.length - 1] || null;
        const payoff = last ? projectPayoffDate(out, last.end_balance, last.effective_rate) : null;
        const offsetBenefits = calculateOffsetBenefitsFromDaily(dailyBalances, out);
        const firstAnnual = out.find((m) => m.annual_rate_pa > 0);
        const currentAnnual = gt.current_interest_rate || (last ? (last.annual_rate_pa || (last.effective_rate * 12)) : 0);
        const initialAnnual = firstAnnual ? firstAnnual.annual_rate_pa : currentAnnual;
        const currentOffsetBalance = (dailyBalances[dailyBalances.length - 1] || {}).offset_balance || 0;

        return {
            monthly: out,
            effectiveRate: eff,
            payoffDate: payoff || null,
            transactionCount: rows.length,
            currentAnnualRate: currentAnnual || 0,
            currentMargin: null,
            rateChange: Number.isFinite(currentAnnual) && Number.isFinite(initialAnnual) ? (currentAnnual - initialAnnual) : null,
            totalSavings: offsetBenefits.totalSavings,
            averageOffset: offsetBenefits.averageOffset,
            currentOffsetBalance,
            projectedAnnualSavings: offsetBenefits.projectedAnnualSavings,
            loanAccounts: loan,
            offsetAccounts: offset,
            ignoredAccounts: ignored,
            classificationWarning: warning,
            detectedScheduledRepayment,
            avgVoluntaryMonthly: out.length ? out.reduce((s, m) => s + m.voluntary_repayments, 0) / out.length : 0,
            asOfDate: cloneDate(lastDailyDate),
            periodCount: out.length
        };
    }

    function calculateMinimumRepayment(principal, annualRatePct, termYears, frequency) {
        const freq = FREQ[frequency];
        if (!freq) return NaN;
        const ppy = freq.periodsPerYear;
        const rate = annualRatePct / 100 / ppy;
        const total = Math.round(termYears * ppy);
        if (rate <= 0) return principal / total;
        return (principal * rate) / (1 - Math.pow(1 + rate, -total));
    }

    function addPeriod(d, frequency) {
        const freq = FREQ[frequency];
        if (!freq) return cloneDate(d);
        const x = cloneDate(d);
        if (frequency === 'monthly') {
            const day = x.getDate();
            x.setMonth(x.getMonth() + 1);
            if (x.getDate() < day) x.setDate(0);
            return x;
        }
        x.setDate(x.getDate() + freq.dayStep);
        return x;
    }

    function subtractPeriod(d, frequency) {
        const freq = FREQ[frequency];
        if (!freq) return cloneDate(d);
        const x = cloneDate(d);
        if (frequency === 'monthly') {
            const day = x.getDate();
            x.setMonth(x.getMonth() - 1);
            if (x.getDate() < day) x.setDate(0);
            return x;
        }
        x.setDate(x.getDate() - freq.dayStep);
        return x;
    }

    function calculatePeriodInterest(balance, annualRatePct, startDate, endDate) {
        if (!(balance > 0) || !(annualRatePct > 0)) return 0;
        if (dateCmp(endDate, startDate) <= 0) return 0;
        const rate = annualRatePct / 100;
        let interest = 0;
        for (let d = cloneDate(startDate); dateCmp(d, endDate) < 0; d = addDays(d, 1)) {
            const yearDays = isLeapYear(d.getFullYear()) ? 366 : 365;
            interest += balance * (rate / yearDays);
        }
        return interest;
    }

    function simulateLoan(opts) {
        const freq = FREQ[opts.frequency];
        if (!freq) return { success: false, failureReason: 'Invalid repayment frequency.' };
        const ppy = freq.periodsPerYear;
        const minRepay = calculateMinimumRepayment(opts.principal, opts.annualRatePct, opts.termYears, opts.frequency);
        const repay = minRepay + opts.extraRepayment;
        let bal = opts.principal;
        let payDate = cloneDate(opts.startDate);
        let prevDate = subtractPeriod(payDate, opts.frequency);
        let totalInt = 0;
        let totalPaid = 0;
        const schedule = [];
        for (let p = 1; p <= Math.round(opts.termYears * ppy * 3); p += 1) {
            const startBal = bal;
            const netBalance = Math.max(0, bal - opts.offsetBalance);
            const interest = calculatePeriodInterest(netBalance, opts.annualRatePct, prevDate, payDate);
            const payment = Math.min(repay, bal + interest);
            const principalPaid = payment - interest;
            if (principalPaid <= 0) return { success: false, failureReason: 'Payment does not reduce principal.' };
            bal = Math.max(0, bal - principalPaid);
            totalInt += interest;
            totalPaid += payment;
            schedule.push({
                period: p,
                date: cloneDate(payDate),
                daysInPeriod: Math.max(1, daysBetween(prevDate, payDate)),
                startBalance: startBal,
                payment,
                interest,
                principalPaid,
                endingBalance: bal
            });
            if (bal <= 0.01) return { success: true, minimumRepayment: minRepay, plannedRepayment: repay, totalInterest: totalInt, totalPaid, schedule, payoffDate: cloneDate(payDate) };
            prevDate = cloneDate(payDate);
            payDate = addPeriod(payDate, opts.frequency);
        }
        return { success: false, failureReason: 'Projection horizon reached.' };
    }

    function renderSchedule(schedule) {
        els.scheduleBody.innerHTML = schedule.slice(0, 60).map((r) => `
            <tr>
                <td>${r.period}</td>
                <td>${fmtDate(r.date)}</td>
                <td>${r.daysInPeriod}</td>
                <td>${money(r.payment)}</td>
                <td>${money(r.interest)}</td>
                <td>${money(r.principalPaid)}</td>
                <td>${money(r.endingBalance)}</td>
            </tr>
        `).join('');
        els.scheduleNote.textContent = schedule.length > 60 ? `Showing first 60 of ${schedule.length} rows.` : `${schedule.length} repayment periods shown.`;
    }

    function clearChart() {
        const c = els.chartCanvas;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const r = c.getBoundingClientRect();
        const w = Math.max(300, Math.floor(r.width));
        const h = Math.max(220, Math.floor(r.height));
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
    }

    function clearResults() {
        const dash = '-';
        els.minimumRepayment.textContent = dash;
        els.plannedRepayment.textContent = dash;
        els.payoffDate.textContent = dash;
        els.baselineInterest.textContent = dash;
        els.optimizedInterest.textContent = dash;
        els.interestSaved.textContent = dash;
        els.termReduction.textContent = dash;
        els.totalPaid.textContent = dash;
        state.lastBaselineSchedule = [];
        state.lastOptimizedSchedule = [];
        state.lastFrequency = 'monthly';
        els.scheduleBody.innerHTML = '';
        els.scheduleNote.textContent = '';
        clearChart();
    }

    function drawChart(baseline, optimized, frequency) {
        const c = els.chartCanvas;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const base = Array.isArray(baseline) ? baseline : [];
        const opt = Array.isArray(optimized) ? optimized : [];
        baseline = base;
        optimized = opt;
        const hasData = (baseline && baseline.length) || (optimized && optimized.length);
        if (!hasData) return clearChart();

        const maxBalance = Math.max(
            1,
            ...baseline.map((r) => Math.max(r.startBalance, r.endingBalance)),
            ...optimized.map((r) => Math.max(r.startBalance, r.endingBalance))
        );
        const ppy = (FREQ[frequency] || FREQ.monthly).periodsPerYear;
        const dpr = window.devicePixelRatio || 1;
        const r = c.getBoundingClientRect();
        const w = Math.max(300, Math.floor(r.width));
        const h = Math.max(220, Math.floor(r.height));
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        const left = 68; const top = 16; const right = 18; const bottom = 38;
        const pw = w - left - right; const ph = h - top - bottom;

        const maxX = Math.max(1, baseline.length - 1, optimized.length - 1);
        const ticksY = 4;
        const ticksX = 5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#e3ecfa';
        ctx.fillStyle = '#546987';
        ctx.font = '12px "Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif';

        for (let i = 0; i <= ticksY; i += 1) {
            const ratio = i / ticksY;
            const y = top + ratio * ph;
            const val = maxBalance * (1 - ratio);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + pw, y);
            ctx.stroke();
            ctx.fillText(compactMoney(val), 8, y + 4);
        }

        for (let i = 0; i <= ticksX; i += 1) {
            const ratio = i / ticksX;
            const x = left + ratio * pw;
            const years = (maxX * ratio) / ppy;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + ph);
            ctx.stroke();
            ctx.fillText(`${years.toFixed(maxX / ppy > 6 ? 0 : 1)}y`, x - 10, top + ph + 18);
        }

        ctx.strokeStyle = '#9bb5db';
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, top + ph);
        ctx.lineTo(left + pw, top + ph);
        ctx.stroke();

        function line(data, color) {
            if (!data.length) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.3;
            ctx.beginPath();
            data.forEach((row, i) => {
                const x = left + (pw * i) / maxX;
                const y = top + ph - (ph * Math.min(maxBalance, row.endingBalance)) / maxBalance;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }
        line(baseline, '#0c79f2');
        line(optimized, '#069c73');

        ctx.fillStyle = '#385372';
        ctx.fillRect(left + 8, top + 8, 12, 3);
        ctx.fillStyle = '#4d617c';
        ctx.fillText('Baseline', left + 26, top + 12);
        ctx.fillStyle = '#069c73';
        ctx.fillRect(left + 102, top + 8, 12, 3);
        ctx.fillStyle = '#4d617c';
        ctx.fillText('With plan', left + 120, top + 12);
    }

    function recalcLoanModel() {
        hideError();
        const startDateRaw = els.startDate ? els.startDate.value : '';
        const vals = {
            loanAmount: n(els.loanAmount.value),
            interestRate: n(els.interestRate.value),
            loanTermYears: n(els.loanTermYears.value),
            frequency: els.repaymentFrequency.value,
            offsetBalance: n(els.offsetBalance.value),
            extraRepayment: n(els.extraRepayment.value),
            startDate: parseDate(startDateRaw)
        };
        if (!(vals.loanAmount > 0)) return showError('Loan amount must be greater than 0.');
        if (!(vals.interestRate >= 0 && vals.interestRate <= 100)) return showError('Interest rate must be between 0 and 100.');
        if (!(vals.loanTermYears > 0)) return showError('Loan term must be greater than 0.');
        if (!(vals.offsetBalance >= 0)) return showError('Offset balance cannot be negative.');
        if (!(vals.extraRepayment >= 0)) return showError('Extra repayment cannot be negative.');
        if (!isValidDate(vals.startDate)) return showError('Please enter a valid start date.');

        const baseline = simulateLoan({ principal: vals.loanAmount, annualRatePct: vals.interestRate, termYears: vals.loanTermYears, frequency: vals.frequency, offsetBalance: 0, extraRepayment: 0, startDate: vals.startDate });
        const optimized = simulateLoan({ principal: vals.loanAmount, annualRatePct: vals.interestRate, termYears: vals.loanTermYears, frequency: vals.frequency, offsetBalance: vals.offsetBalance, extraRepayment: vals.extraRepayment, startDate: vals.startDate });
        if (!baseline.success || !optimized.success) return showError((optimized.failureReason || baseline.failureReason || 'Unable to calculate schedule.'));

        els.minimumRepayment.textContent = money(optimized.minimumRepayment);
        els.plannedRepayment.textContent = money(optimized.plannedRepayment);
        els.payoffDate.textContent = fmtDate(optimized.payoffDate);
        els.baselineInterest.textContent = money( baseline.totalInterest);
        els.optimizedInterest.textContent = money(optimized.totalInterest);
        els.interestSaved.textContent = money(baseline.totalInterest - optimized.totalInterest);
        const ppy = FREQ[vals.frequency].periodsPerYear;
        const termDiff = Math.max(0, baseline.schedule.length - optimized.schedule.length);
        let termReductionText = '0';
        if (termDiff > 0) {
            const years = Math.floor(termDiff / ppy);
            const remainder = termDiff % ppy;
            const months = ppy === 12 ? remainder : Math.round((remainder / ppy) * 12);
            if (months > 0) termReductionText = `${years}y ${months}mo`;
            else termReductionText = `${years}y`;
        }
        els.termReduction.textContent = termReductionText;
        els.totalPaid.textContent = money(optimized.totalPaid);
        state.lastBaselineSchedule = baseline.schedule;
        state.lastOptimizedSchedule = optimized.schedule;
        state.lastFrequency = vals.frequency;
        renderSchedule(optimized.schedule);
        drawChart(baseline.schedule, optimized.schedule, vals.frequency);
    }

    function createScheduleCsv(schedule) {
        const head = ['Period', 'Date', 'Days In Period', 'Start Balance', 'Payment', 'Interest', 'Principal', 'Ending Balance'];
        const lines = schedule.map((r) => [
            r.period,
            dateKey(r.date),
            r.daysInPeriod,
            r.startBalance.toFixed(2),
            r.payment.toFixed(2),
            r.interest.toFixed(2),
            r.principalPaid.toFixed(2),
            r.endingBalance.toFixed(2)
        ].join(','));
        return `${head.join(',')}\n${lines.join('\n')}`;
    }

    function collectGroundTruth() {
        return {
            current_interest_rate: optN(els.currentInterestRate.value),
            as_of_date: parseDate(els.asOfDate.value),
            scheduled_monthly_repayment: optN(els.scheduledMonthlyRepayment.value)
        };
    }

    function renderAnalysisSummary(s) {
        els.analyzedEffectiveRate.textContent = pct(s.effectiveRate);
        els.analyzedPayoffDate.textContent = s.payoffDate ? fmtDate(s.payoffDate) : '-';
        els.analyzedTransactionCount.textContent = String(s.transactionCount);
        els.analyzedCurrentRate.textContent = pct(s.currentAnnualRate);
        els.analyzedCurrentMargin.textContent = money(s.currentOffsetBalance);
        els.analyzedRateChange.textContent = pct(s.rateChange);
        els.analyzedTotalSavings.textContent = money(s.totalSavings);
        els.analyzedAvgOffset.textContent = money(s.averageOffset);
        els.analyzedProjectedSavings.textContent = money(s.projectedAnnualSavings);
        const ignoredText = s.ignoredAccounts && s.ignoredAccounts.length
            ? ` | Ignored accounts: ${s.ignoredAccounts.join(', ')}`
            : '';
        const repaymentText = Number.isFinite(s.detectedScheduledRepayment) && s.detectedScheduledRepayment > 0
            ? ` | Detected recurring repayment: ${money(s.detectedScheduledRepayment)}`
            : '';
        const warningText = s.classificationWarning ? ` | ${s.classificationWarning}` : '';
        els.analyzedAccounts.textContent = `Detected loan accounts: ${s.loanAccounts.join(', ') || 'None'} | Detected offset accounts: ${s.offsetAccounts.join(', ') || 'None'}${ignoredText}${repaymentText} | Interest periods analyzed: ${s.periodCount}${warningText}`;
        els.analysisSummary.classList.remove('hidden');
    }

    function applySummaryToCalculator(s, gt) {
        const last = s.monthly[s.monthly.length - 1];
        if (!last) return;
        const principal = Math.max(0, last.end_balance);
        const annualRate = Math.max(0, gt.current_interest_rate || s.currentAnnualRate || 0);
        els.loanAmount.value = principal.toFixed(2);
        els.interestRate.value = annualRate.toFixed(2);
        els.offsetBalance.value = Math.max(0, s.currentOffsetBalance || s.averageOffset).toFixed(2);
        els.repaymentFrequency.value = 'monthly';
        const minRepay = calculateMinimumRepayment(principal, annualRate, n(els.loanTermYears.value), 'monthly');
        const recurring = Number.isFinite(gt.scheduled_monthly_repayment) && gt.scheduled_monthly_repayment > 0
            ? gt.scheduled_monthly_repayment
            : s.detectedScheduledRepayment;
        const inferredExtra = Number.isFinite(recurring) && recurring > 0 && Number.isFinite(minRepay)
            ? Math.max(0, recurring - minRepay)
            : Math.max(0, s.avgVoluntaryMonthly);
        els.extraRepayment.value = inferredExtra.toFixed(2);
        els.startDate.value = dateKey(new Date());
        recalcLoanModel();
    }

    async function runUploadParse() {
        if (!state.selectedFile) return setUploadStatus('Please choose a Pocketsmith CSV file first.', 'error');
        els.uploadBtn.disabled = true;
        els.analyzeBtn.disabled = true;
        setUploadStatus(`Analyzing ${state.selectedFile.name} locally in your browser...`, 'info');
        try {
            state.transactions = parsePocketsmithCsv(await state.selectedFile.text());
            els.groundTruthSection.classList.remove('hidden');
            setUploadStatus('File loaded. Submit optional ground truth or click Skip Ground Truth.', 'success');
        } catch (e) {
            setUploadStatus(`Error: ${e.message}`, 'error');
        } finally {
            els.uploadBtn.disabled = false;
            els.analyzeBtn.disabled = false;
        }
    }

    function finalizeUpload(groundTruth) {
        if (!state.transactions.length) return setUploadStatus('No parsed transaction data found. Start analysis first.', 'error');
        try {
            const summary = summarize(state.transactions, groundTruth);
            renderAnalysisSummary(summary);
            applySummaryToCalculator(summary, groundTruth);
            els.groundTruthSection.classList.add('hidden');
            const statusMsg = summary.classificationWarning
                ? `Analysis complete with warning: ${summary.classificationWarning}`
                : 'Analysis complete. File data is in-memory only and is cleared when you leave or refresh.';
            setUploadStatus(statusMsg, summary.classificationWarning ? 'info' : 'success');
        } catch (e) {
            setUploadStatus(`Error: ${e.message}`, 'error');
        }
    }

    function clearEphemeralState() {
        state.selectedFile = null;
        state.transactions = [];
    }

    els.form.addEventListener('submit', (e) => { e.preventDefault(); recalcLoanModel(); });
    els.resetBtn.addEventListener('click', () => {
        hideError();
        els.loanAmount.value = '650000';
        els.interestRate.value = '6.19';
        els.loanTermYears.value = '30';
        els.repaymentFrequency.value = 'monthly';
        els.offsetBalance.value = '0';
        els.extraRepayment.value = '0';
        setDefaultDate();
        clearResults();
    });
    els.downloadCsvBtn.addEventListener('click', () => {
        if (!state.lastOptimizedSchedule.length) return showError('Run a calculation first before downloading CSV.');
        hideError();
        const blob = new Blob([createScheduleCsv(state.lastOptimizedSchedule)], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nab_homeloan_schedule.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    els.uploadBtn.addEventListener('click', () => els.pocketsmithFile.click());
    els.pocketsmithFile.addEventListener('change', () => {
        if (!els.pocketsmithFile.files || !els.pocketsmithFile.files.length) return;
        state.selectedFile = els.pocketsmithFile.files[0];
        els.selectedFileName.textContent = `Selected file: ${state.selectedFile.name}`;
        setUploadStatus(`Selected ${state.selectedFile.name}. Click Start Analysis to continue.`, 'info');
        els.analyzeBtn.disabled = false;
        els.pocketsmithFile.value = '';
    });
    els.analyzeBtn.addEventListener('click', async () => { await runUploadParse(); });
    els.skipGroundTruthBtn.addEventListener('click', () => finalizeUpload({ current_interest_rate: null, as_of_date: null, scheduled_monthly_repayment: null }));
    els.submitWithGroundTruthBtn.addEventListener('click', () => finalizeUpload(collectGroundTruth()));

    window.addEventListener('resize', () => {
        if (state.lastBaselineSchedule.length && state.lastOptimizedSchedule.length) {
            drawChart(state.lastBaselineSchedule, state.lastOptimizedSchedule, state.lastFrequency || 'monthly');
        }
    });
    window.addEventListener('beforeunload', clearEphemeralState);
    window.addEventListener('pagehide', clearEphemeralState);

    if (typeof window !== 'undefined') {
        window.NABHomeloanDebug = {
            parsePocketsmithCsv,
            summarize,
            simulateLoan,
            parseDate
        };
    }

    setDefaultDate();
    setUploadStatus('No file selected. Processing is local-only and ephemeral.', 'info');
    clearResults();
})();

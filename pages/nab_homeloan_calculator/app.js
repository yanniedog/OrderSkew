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
        lastBaselineSchedule: []
    };

    function n(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }
    function optN(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
    function parseDate(s) {
        if (!s) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
        if (!m) return null;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return (d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) ? d : null;
    }
    function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    function monthKey(d) { return dateKey(d).slice(0, 7); }
    function cloneDate(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function addDays(d, days) { const x = cloneDate(d); x.setDate(x.getDate() + days); return x; }
    function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
    function fmtDate(d) { return d instanceof Date ? d.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: '2-digit' }) : '-'; }
    function money(v) { return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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

    function splitCsvLine(line) {
        const out = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                out.push(cur);
                cur = '';
            } else cur += ch;
        }
        out.push(cur);
        return out;
    }

    function parseAmount(raw) {
        if (raw === undefined || raw === null) return null;
        const cleaned = String(raw).trim().replace(/\$/g, '').replace(/,/g, '');
        if (!cleaned) return null;
        const x = Number(cleaned);
        return Number.isFinite(x) ? x : null;
    }

    function colIndex(headers, name) {
        const lower = name.toLowerCase();
        const exact = headers.indexOf(name);
        if (exact >= 0) return exact;
        const i = headers.findIndex((h) => h.trim().toLowerCase() === lower);
        return i >= 0 ? i : -1;
    }

    function parsePocketsmithCsv(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim().length > 0);
        if (lines.length < 2) throw new Error('CSV appears empty.');
        const headers = splitCsvLine(lines[0]).map((h) => h.trim());
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
        for (let i = 1; i < lines.length; i += 1) {
            const cols = splitCsvLine(lines[i]);
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
                description: htmlDecode(descCol.trim()),
                category: catCol.trim(),
                closing_balance: balance,
                row_index: i + 1
            });
        }
        rows.sort((a, b) => (a.date - b.date) || (a.row_index - b.row_index));
        if (!rows.length) throw new Error('No valid transactions found.');
        return rows;
    }

    function classifyAccounts(rows) {
        const stats = new Map();
        rows.forEach((r) => {
            const s = stats.get(r.account) || { neg: 0 };
            if (Number.isFinite(r.closing_balance) && r.closing_balance < 0) s.neg += 1;
            stats.set(r.account, s);
        });
        const accounts = [...stats.keys()];
        const loan = accounts.filter((a) => {
            const x = a.toLowerCase();
            return !x.includes('offset') && (x.includes('mortgage') || x.includes('home loan') || x.includes('loan'));
        });
        if (!loan.length) {
            accounts.forEach((a) => { if ((stats.get(a) || {}).neg > 0) loan.push(a); });
        }
        return { loan, offset: accounts.filter((a) => !loan.includes(a)) };
    }

    function isInterestTxn(r) {
        const desc = (r.description || '').toLowerCase();
        const cat = (r.category || '').toLowerCase();
        return desc.includes('interest charged') || cat === 'interest' || cat.includes('interest');
    }

    function summarize(rows, gt) {
        const { loan, offset } = classifyAccounts(rows);
        if (!loan.length) throw new Error('No loan accounts detected in this file.');
        const relevant = rows.filter((r) => loan.includes(r.account) || offset.includes(r.account));
        let minDate = cloneDate(relevant[0].date);
        let maxDate = cloneDate(relevant[0].date);
        const byAccDate = {};
        const interestByDate = {};
        [...loan, ...offset].forEach((a) => { byAccDate[a] = {}; });
        rows.forEach((r) => {
            if (r.date < minDate) minDate = cloneDate(r.date);
            if (r.date > maxDate) maxDate = cloneDate(r.date);
            if (Number.isFinite(r.closing_balance) && byAccDate[r.account]) byAccDate[r.account][dateKey(r.date)] = r.closing_balance;
            if (loan.includes(r.account) && isInterestTxn(r)) {
                const k = dateKey(r.date);
                interestByDate[k] = (interestByDate[k] || 0) + Math.abs(r.amount);
            }
        });
        const asOf = gt.as_of_date instanceof Date ? gt.as_of_date : maxDate;
        const endDate = asOf < maxDate ? asOf : maxDate;

        const cur = {};
        const monthMap = {};
        const monthLoanTxns = {};
        for (let d = cloneDate(minDate); d <= endDate; d = addDays(d, 1)) {
            const dayKey = dateKey(d);
            Object.keys(byAccDate).forEach((a) => {
                if (Number.isFinite(byAccDate[a][dayKey])) cur[a] = byAccDate[a][dayKey];
            });
            let loanBal = 0;
            loan.forEach((a) => { loanBal += Number.isFinite(cur[a]) ? Math.abs(cur[a]) : 0; });
            let offsetBal = 0;
            offset.forEach((a) => { offsetBal += Number.isFinite(cur[a]) ? cur[a] : 0; });
            const adjustedLoan = Math.max(0, loanBal - (interestByDate[dayKey] || 0));
            const net = Math.max(0, adjustedLoan - offsetBal);
            const m = monthKey(d);
            if (!monthMap[m]) {
                monthMap[m] = {
                    month: m, date: cloneDate(d), start_balance: loanBal, end_balance: loanBal, days: 0,
                    sumLoan: 0, sumOffset: 0, sumNet: 0, interest: 0, principal: 0, voluntary: 0
                };
                monthLoanTxns[m] = [];
            }
            const rec = monthMap[m];
            rec.date = cloneDate(d);
            rec.end_balance = loanBal;
            rec.days += 1;
            rec.sumLoan += adjustedLoan;
            rec.sumOffset += offsetBal;
            rec.sumNet += net;
            rec.interest += interestByDate[dayKey] || 0;
        }

        rows.forEach((r) => {
            if (!loan.includes(r.account) || r.date > endDate) return;
            const m = monthKey(r.date);
            if (!monthMap[m]) return;
            monthLoanTxns[m].push(r);
        });

        const scheduled = gt.scheduled_monthly_repayment;
        const out = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)).map((rec) => {
            const txns = monthLoanTxns[rec.month] || [];
            txns.forEach((r) => {
                if (isInterestTxn(r)) return;
                const desc = (r.description || '').toLowerCase();
                if (desc.includes('fee') || desc.includes('refund')) return;
                const normalized = -r.amount;
                if (normalized < 0) {
                    const payment = Math.abs(normalized);
                    let isSched = false;
                    if (Number.isFinite(scheduled) && scheduled > 0) isSched = Math.abs(payment - scheduled) <= 0.01;
                    else isSched = (r.description || '').toUpperCase().startsWith('LOAN REPAYMENT');
                    if (isSched) rec.principal += payment;
                    else rec.voluntary += payment;
                }
            });
            const avgNet = rec.days > 0 ? rec.sumNet / rec.days : 0;
            const avgLoan = rec.days > 0 ? rec.sumLoan / rec.days : 0;
            const avgOffset = rec.days > 0 ? rec.sumOffset / rec.days : 0;
            const effective = (avgNet > 0 && rec.interest > 0) ? (rec.interest / avgNet) * 100 : 0;
            const annual = gt.current_interest_rate || (effective * 12);
            return {
                month: rec.month,
                date: rec.date,
                start_balance: rec.start_balance,
                end_balance: rec.end_balance,
                principal_payments: rec.principal,
                voluntary_repayments: rec.voluntary,
                interest_paid: rec.interest,
                interest_accrued: rec.interest,
                effective_rate: effective,
                annual_rate_pa: annual,
                days_in_period: rec.days,
                days_in_month: daysInMonth(rec.date),
                average_net_balance: avgNet,
                average_loan_balance: avgLoan,
                average_offset_balance: avgOffset
            };
        });

        let weightedInt = 0;
        let weightedNet = 0;
        out.forEach((m) => { weightedInt += m.interest_accrued; weightedNet += m.average_net_balance * m.days_in_period; });
        const eff = weightedNet > 0 ? (weightedInt / weightedNet) * (out.reduce((s, m) => s + m.days_in_period, 0) / Math.max(1, out.length)) * 100 : 0;

        const last = out[out.length - 1] || null;
        let payoff = null;
        if (last) {
            const recent = out.slice(-6);
            let avgPrincipal = recent.reduce((s, m) => s + m.principal_payments + m.voluntary_repayments, 0) / Math.max(1, recent.length);
            if (avgPrincipal <= 0) avgPrincipal = last.end_balance * 0.02;
            let bal = last.end_balance;
            let months = 0;
            while (bal > 0.01 && months < 600) {
                bal = bal - avgPrincipal + (bal * (last.effective_rate / 100));
                months += 1;
            }
            payoff = addDays(last.date, months * 30);
        }

        let totalSavings = 0;
        const offsetMonths = out.map((m) => {
            const withOffset = m.interest_accrued;
            const dailyRate = (m.average_net_balance > 0 && withOffset > 0)
                ? withOffset / (m.average_net_balance * m.days_in_period)
                : 0;
            const withoutOffset = dailyRate > 0 ? dailyRate * (m.average_loan_balance * m.days_in_period) : withOffset;
            const savings = Math.max(0, withoutOffset - withOffset);
            totalSavings += savings;
            return { avgOffset: m.average_offset_balance, savings };
        });
        const avgOffset = out.length ? out.reduce((s, m) => s + m.average_offset_balance, 0) / out.length : 0;
        const currentAnnual = gt.current_interest_rate || (last ? last.annual_rate_pa : 0);
        const projectedAnnualSavings = (avgOffset > 0 && currentAnnual > 0)
            ? avgOffset * (Math.pow(1 + ((currentAnnual / 100) / 365), 365) - 1)
            : 0;

        return {
            monthly: out,
            effectiveRate: eff,
            payoffDate: payoff,
            transactionCount: rows.length,
            currentAnnualRate: currentAnnual || 0,
            currentMargin: (currentAnnual || 0) - 4.35,
            rateChange: (currentAnnual || 0) - 5.99,
            totalSavings,
            averageOffset: avgOffset,
            projectedAnnualSavings,
            loanAccounts: loan,
            offsetAccounts: offset,
            avgVoluntaryMonthly: out.length ? out.reduce((s, m) => s + m.voluntary_repayments, 0) / out.length : 0
        };
    }

    function calculateMinimumRepayment(principal, annualRatePct, termYears, frequency) {
        const ppy = FREQ[frequency].periodsPerYear;
        const rate = annualRatePct / 100 / ppy;
        const total = Math.round(termYears * ppy);
        if (rate <= 0) return principal / total;
        return (principal * rate) / (1 - Math.pow(1 + rate, -total));
    }

    function addPeriod(d, frequency) {
        const x = new Date(d.getTime());
        if (frequency === 'monthly') {
            const day = x.getDate();
            x.setMonth(x.getMonth() + 1);
            if (x.getDate() < day) x.setDate(0);
            return x;
        }
        x.setDate(x.getDate() + FREQ[frequency].dayStep);
        return x;
    }

    function simulateLoan(opts) {
        const ppy = FREQ[opts.frequency].periodsPerYear;
        const periodRate = opts.annualRatePct / 100 / ppy;
        const minRepay = calculateMinimumRepayment(opts.principal, opts.annualRatePct, opts.termYears, opts.frequency);
        const repay = minRepay + opts.extraRepayment;
        let bal = opts.principal;
        let date = new Date(opts.startDate.getTime());
        let totalInt = 0;
        let totalPaid = 0;
        const schedule = [];
        for (let p = 1; p <= Math.round(opts.termYears * ppy * 3); p += 1) {
            const startBal = bal;
            const interest = Math.max(0, bal - opts.offsetBalance) * periodRate;
            const payment = Math.min(repay, bal + interest);
            const principalPaid = payment - interest;
            if (principalPaid <= 0) return { success: false, failureReason: 'Payment does not reduce principal.' };
            bal = Math.max(0, bal - principalPaid);
            totalInt += interest;
            totalPaid += payment;
            schedule.push({ period: p, date: new Date(date.getTime()), startBalance: startBal, payment, interest, principalPaid, endingBalance: bal });
            if (bal <= 0.01) return { success: true, minimumRepayment: minRepay, plannedRepayment: repay, totalInterest: totalInt, totalPaid, schedule, payoffDate: new Date(date.getTime()) };
            date = addPeriod(date, opts.frequency);
        }
        return { success: false, failureReason: 'Projection horizon reached.' };
    }

    function renderSchedule(schedule) {
        els.scheduleBody.innerHTML = schedule.slice(0, 60).map((r) => `
            <tr>
                <td>${r.period}</td>
                <td>${fmtDate(r.date)}</td>
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
        els.scheduleBody.innerHTML = '';
        els.scheduleNote.textContent = '';
        clearChart();
    }

    function drawChart(baseline, optimized, principal) {
        const c = els.chartCanvas;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx || principal <= 0) return;
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
        const left = 48; const top = 12; const right = 12; const bottom = 28;
        const pw = w - left - right; const ph = h - top - bottom;
        const maxX = Math.max(Math.max(1, baseline.length - 1), Math.max(1, optimized.length - 1));
        ctx.strokeStyle = '#e3ecfa';
        for (let i = 0; i <= 4; i += 1) {
            const y = top + (ph / 4) * i;
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + pw, y); ctx.stroke();
        }
        ctx.strokeStyle = '#9bb5db';
        ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + ph); ctx.lineTo(left + pw, top + ph); ctx.stroke();
        function line(data, color) {
            if (!data.length) return;
            ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.beginPath();
            data.forEach((row, i) => {
                const x = left + (pw * i) / maxX;
                const y = top + ph - (ph * Math.min(principal, row.endingBalance)) / principal;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }
        line(baseline, '#0c79f2');
        line(optimized, '#069c73');
        ctx.font = '12px Arial';
        ctx.fillStyle = '#4f6077';
        ctx.fillText('Balance', 8, top + 8);
        ctx.fillText('Time', left + pw - 22, top + ph + 20);
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
        if (!(vals.startDate instanceof Date)) return showError('Please enter a valid start date.');

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
        renderSchedule(optimized.schedule);
        drawChart(baseline.schedule, optimized.schedule, vals.loanAmount);
    }

    function createScheduleCsv(schedule) {
        const head = ['Period', 'Date', 'Start Balance', 'Payment', 'Interest', 'Principal', 'Ending Balance'];
        const lines = schedule.map((r) => [r.period, dateKey(r.date), r.startBalance.toFixed(2), r.payment.toFixed(2), r.interest.toFixed(2), r.principalPaid.toFixed(2), r.endingBalance.toFixed(2)].join(','));
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
        els.analyzedCurrentMargin.textContent = pct(s.currentMargin);
        els.analyzedRateChange.textContent = pct(s.rateChange);
        els.analyzedTotalSavings.textContent = money(s.totalSavings);
        els.analyzedAvgOffset.textContent = money(s.averageOffset);
        els.analyzedProjectedSavings.textContent = money(s.projectedAnnualSavings);
        els.analyzedAccounts.textContent = `Detected loan accounts: ${s.loanAccounts.join(', ') || 'None'} | Detected offset accounts: ${s.offsetAccounts.join(', ') || 'None'}`;
        els.analysisSummary.classList.remove('hidden');
    }

    function applySummaryToCalculator(s, gt) {
        const last = s.monthly[s.monthly.length - 1];
        if (!last) return;
        els.loanAmount.value = Math.max(0, last.end_balance).toFixed(2);
        els.interestRate.value = Math.max(0, gt.current_interest_rate || s.currentAnnualRate || 0).toFixed(2);
        els.offsetBalance.value = Math.max(0, s.averageOffset).toFixed(2);
        els.extraRepayment.value = Math.max(0, s.avgVoluntaryMonthly).toFixed(2);
        els.repaymentFrequency.value = 'monthly';
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
            setUploadStatus('Analysis complete. File data is in-memory only and is cleared when you leave or refresh.', 'success');
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
            drawChart(state.lastBaselineSchedule, state.lastOptimizedSchedule, n(els.loanAmount.value));
        }
    });
    window.addEventListener('beforeunload', clearEphemeralState);
    window.addEventListener('pagehide', clearEphemeralState);

    setDefaultDate();
    setUploadStatus('No file selected. Processing is local-only and ephemeral.', 'info');
    clearResults();
})();

// OrderSkew - Main Application Logic (app.js)

// --- CONSTANTS & UTILS ---
const CONSTANTS = {
    STORAGE_PREFIX: 'orderskew_v2_',
    MAX_SKEW_RATIO: 10
};

const Utils = {
    clamp: (v, min, max) => Math.min(Math.max(v, min), max),
    debounce: (func, wait) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    },
    fmtCurr: (n) => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(Number.isFinite(n) ? n : 0),
    fmtNum: (n, d=4) => Number.isFinite(n) ? n.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:d}) : '0',
    fmtSigFig: (n) => {
        if (!Number.isFinite(n) || n === 0) return '0';
        return new Intl.NumberFormat('en-US', { minimumSignificantDigits: 5, maximumSignificantDigits: 5 }).format(n);
    },
    fmtPct: (n) => Number.isFinite(n) ? n.toFixed(2) + '%' : '0.00%',
    formatNumberWithCommas: (value) => {
        if (value === null || value === undefined) return '';
        const strValue = value.toString();
        if (strValue === '' || strValue === '-' || strValue === '.' || strValue === '-.') {
            return strValue;
        }
        const isNegative = strValue.startsWith('-');
        const endsWithDot = strValue.endsWith('.');
        let workingValue = isNegative ? strValue.slice(1) : strValue;
        const parts = workingValue.split('.');
        const intPartRaw = parts.shift() || '';
        const decimalPartRaw = parts.join('');
        const formattedInt = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',') || '0';
        if (parts.length === 0 && !strValue.includes('.')) {
            return `${isNegative ? '-' : ''}${formattedInt}`;
        }
        if ((parts.length === 0 && strValue.includes('.')) || (parts.length >= 0 && decimalPartRaw.length === 0 && endsWithDot)) {
            return `${isNegative ? '-' : ''}${formattedInt}.`;
        }
        return `${isNegative ? '-' : ''}${formattedInt}.${decimalPartRaw}`;
    },
    stripCommas: (value) => (value ?? '').toString().replace(/,/g, ''),
    sanitizeInput: (value) => {
        if (value === null || value === undefined) return '';
        const strValue = value.toString();
        if (strValue === '' || strValue === '-' || strValue === '.' || strValue === '-.') return strValue;
        let sanitized = strValue.replace(/,/g, '');
        let sign = '';
        if (sanitized.startsWith('-')) { sign = '-'; sanitized = sanitized.slice(1); }
        sanitized = sanitized.replace(/[^0-9.]/g, '');
        const hadDecimal = sanitized.includes('.');
        const parts = sanitized.split('.');
        const integerPart = parts.shift() || '';
        const decimalPart = parts.join('');
        let normalized = sign + integerPart;
        if (hadDecimal) normalized += '.' + decimalPart;
        return normalized;
    },
    bindCurrencyInput: (el, callback) => {
        if (!el) return;
        el.addEventListener('focus', (e) => { e.target.value = Utils.stripCommas(e.target.value); });
        el.addEventListener('input', (e) => {
            const cursorPos = e.target.selectionStart || 0;
            const valueBefore = e.target.value;
            const normalized = Utils.sanitizeInput(valueBefore);
            e.target.value = normalized;
            const diff = e.target.value.length - valueBefore.length;
            e.target.setSelectionRange(Math.max(0, cursorPos + diff), Math.max(0, cursorPos + diff));
            if (callback) callback();
        });
        el.addEventListener('blur', (e) => { e.target.value = Utils.formatNumberWithCommas(Utils.sanitizeInput(e.target.value)); });
    },
    bindModal: (modal, openBtns, closeSelectors) => {
        const toggle = (show) => modal?.classList.toggle('open', show);
        openBtns.forEach(btn => btn?.addEventListener('click', () => toggle(true)));
        closeSelectors.forEach(el => el?.addEventListener('click', () => toggle(false)));
        return toggle;
    },
    hideIntro: (introLayer) => {
        if (!introLayer) return;
        introLayer.style.opacity = '0';
        introLayer.style.pointerEvents = 'none';
        setTimeout(() => { introLayer.style.display = 'none'; }, 500);
    },
    getSkewLabel: (v) => v === 0 ? "Flat" : v <= 30 ? "Gentle" : v <= 70 ? "Moderate" : "Aggressive",
    copyToClipboard: (text) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            const t = document.getElementById('toast');
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2000);
        } catch (err) { console.error('Fallback copy failed', err); }
        document.body.removeChild(textArea);
    }
};

// --- STATE ---
const State = {
    currentPlanData: null,
    baselineBuySnapshot: null,
    sellOnlyHighestExecuted: null,
    activeTab: 'buy',
    theme: 'light',
    mode: 'simple',
    showFees: false,
    chartShowBars: true,
    chartShowCumulative: true,
    chartUnitType: 'volume',
    sellOnlyMode: false,
    buyOnlyMode: true,
    shortSellMode: false,
    tradingMode: 'buy-only', // 'buy-sell', 'buy-only', 'sell-only', 'short-sell'
    advancedMode: false
};

// --- CALCULATOR ENGINE ---
const Calculator = {
    buildSkewWeights: (count, skewValue) => {
        if (count <= 0) return [];
        if (skewValue <= 0) return Array(count).fill(1);
        const normalizedSkew = Utils.clamp(skewValue, 0, 100) / 100;
        const targetRatio = 1 + Math.pow(normalizedSkew, 1.2) * (CONSTANTS.MAX_SKEW_RATIO - 1);
        const minWeight = 1 / targetRatio;
        const curvature = 1 + normalizedSkew;
        
        return Array.from({ length: count }, (_, index) => {
            if (count === 1) return 1;
            const relativeIndex = index / (count - 1);
            const shapedIndex = Math.pow(relativeIndex, curvature);
            const curveValue = Math.pow(targetRatio, shapedIndex);
            return Math.max(curveValue - 1 + minWeight, Number.EPSILON);
        });
    },

    computeEqualGrossAllocations: (totalQuantity, prices) => {
        const allocations = Array(prices.length).fill(0);
        const validEntries = prices.map((price, idx) => ({ price, idx })).filter(entry => entry.price > 0);
        if (totalQuantity <= 0 || validEntries.length === 0) return { allocations, quantityPerRung: 0 };
        const sharedQuantity = totalQuantity / validEntries.length;
        validEntries.forEach(({ idx }) => allocations[idx] = sharedQuantity);
        return { allocations, quantityPerRung: sharedQuantity };
    },

    deriveExecutedBuyTotals: (buyLadder, highestRung) => {
        if (!Array.isArray(buyLadder) || buyLadder.length === 0 || !Number.isFinite(highestRung)) {
            return { quantity: 0, netCapital: 0, fees: 0 };
        }
        const executed = buyLadder.filter(rung => rung.rung <= highestRung && rung.assetSize > 0);
        if (executed.length === 0) return { quantity: 0, netCapital: 0, fees: 0 };
        
        const quantity = executed.reduce((sum, rung) => sum + rung.assetSize, 0);
        const netCapital = executed.reduce((sum, rung) => sum + rung.netCapital, 0);
        const fees = executed.reduce((sum, rung) => sum + rung.fee, 0);
        return { quantity, netCapital, fees };
    }
};

// Expose to global scope for other modules
window.CONSTANTS = CONSTANTS;
window.Utils = Utils;
window.State = State;
window.Calculator = Calculator;





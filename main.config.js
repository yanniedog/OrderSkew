// Versioned settings files, validated before any form field is changed.
(function () {
    const fields = {
        startingCapital: 'startCap', currentPrice: 'currPrice', existingQuantity: 'existQty',
        existingAvgPrice: 'existAvg', numberOfRungs: 'rungsInput', skewValue: 'skew',
        depth: 'depthInput', buyFloor: 'buyFloor', sellCeiling: 'sellCeiling',
        feeValue: 'feeValue', feeType: 'feeType', feeSettlement: 'feeSettlement',
        spacingMode: 'spacingMode', priceRangeMode: 'priceRangeMode'
    };
    const choices = { tradingMode: ['buy-only', 'sell-only', 'buy-sell'],
        feeType: ['percent', 'fixed'], feeSettlement: ['netted', 'external'],
        spacingMode: ['absolute', 'relative'], priceRangeMode: ['width', 'floor'] };
    const Config = {
        capture: (els) => ({ version: 2, tradingMode: State.tradingMode,
            ...Object.fromEntries(Object.entries(fields).map(([key, ref]) => [key, Utils.stripCommas(els[ref]?.value)])) }),
        parse: (text) => {
            const config = JSON.parse(text);
            if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Expected a settings object.');
            if (config.version !== undefined && config.version !== 2) throw Error('Unsupported settings version.');
            const expected = config.version === 2 ? ['tradingMode', ...Object.keys(fields)]
                : ['startingCapital', 'numberOfRungs', 'skewValue', 'depth'];
            for (const key of expected) {
                const value = config[key];
                if (choices[key]) {
                    if (!choices[key].includes(value)) throw Error(`Invalid ${key}.`);
                } else if (!['number', 'string'].includes(typeof value) ||
                    (String(value).trim() !== '' && !Number.isFinite(Number(Utils.stripCommas(value))))) {
                    throw Error(`Invalid ${key}.`);
                }
            }
            for (const [key, min, max, integer] of [['numberOfRungs', 2, 50, true], ['skewValue', 0, 100, false], ['depth', 0.1, 99, false]]) {
                if (key === 'depth' && config.version === 2 && config.priceRangeMode === 'floor') continue;
                const n = Number(config[key]);
                if (n < min || n > max || (integer && !Number.isInteger(n))) throw Error(`Invalid ${key}.`);
            }
            if (config.version === 2) Config.validatePlan(config);
            else if (!(Number(Utils.stripCommas(config.startingCapital)) > 0)) throw Error('Invalid startingCapital.');
            return Object.fromEntries(['version', ...expected].filter(key => key in config).map(key => [key, config[key]]));
        },
        validatePlan: config => {
            const number = key => String(config[key]).trim() === '' ? NaN : Number(Utils.stripCommas(config[key]));
            const settings = { tradingMode: config.tradingMode,
                C: number(config.tradingMode === 'sell-only' ? 'existingQuantity' : 'startingCapital'),
                currentPrice: number('currentPrice'), N: number('numberOfRungs'), S: number('skewValue'), depth: number('depth'),
                existingAvgPrice: String(config.existingAvgPrice).trim() === '' ? null : number('existingAvgPrice'),
                feeType: config.feeType, feeValue: number('feeValue'), feeSettlement: config.feeSettlement, spacingMode: config.spacingMode };
            const bounds = config.priceRangeMode === 'floor'
                ? { buyPriceEnd: number('buyFloor'), sellPriceEnd: number('sellCeiling') }
                : { buyPriceEnd: settings.currentPrice * (1 - settings.depth / 100), sellPriceEnd: settings.currentPrice * (1 + settings.depth / 100) };
            const validation = Calculator.validateSettings(settings, config.priceRangeMode, bounds);
            if (!validation.isReady) throw Error(validation.invalidMessages.join(' '));
            if (config.tradingMode === 'sell-only') bounds.buyPriceEnd = settings.currentPrice;
            if (config.tradingMode === 'buy-only') bounds.sellPriceEnd = settings.currentPrice;
            const error = Calculator.getPlanError(Calculator.createPlan({ ...settings, ...bounds }));
            if (error) throw Error(error);
        },
        csv: (plan, settings) => {
            const rows = [['Setting', 'Value'], ...Object.entries(settings), [], ['Summary', 'Value'],
                ...Object.entries(plan.summary), [],
                ['Type', 'Rung', 'Price', 'Size', 'Value', 'Fee', 'Net cash flow', 'Profit', 'Average price'],
                ...plan.buyLadder.map(r => ['Buy', r.rung, r.price, r.assetSize, r.capital, r.fee, -r.capital, '', r.avg]),
                ...plan.sellLadder.map(r => ['Sell', r.rung, r.price, r.assetSize, r.capital, r.fee,
                    r.capital - r.fee, r.profit, r.avg])];
            return rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        }
    };
    window.OrderSkewConfig = Config;
    window.OrderSkewModules.attachConfigMethods = (App, els) => {
        const download = (text, type, name) => {
            const url = URL.createObjectURL(new Blob([text], { type }));
            const link = document.createElement('a');
            link.href = url; link.download = name;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        App.saveConfig = () => download(JSON.stringify(Config.capture(els), null, 2), 'application/json', 'orderskew_config.json');
        App.exportCSV = () => {
            App.calculatePlan();
            if (State.currentPlanData) download(Config.csv(State.currentPlanData, Config.capture(els)), 'text/csv;charset=utf-8', 'orderskew_plan.csv');
        };
        App.applyConfig = config => {
            for (const [key, ref] of Object.entries(fields)) if (key in config && els[ref]) els[ref].value = config[key];
            if (config.version === 2) {
                els.currPriceSell.value = els.currPrice.value;
                App.setTradingMode(config.tradingMode);
                document.getElementById(config.feeType === 'fixed' ? 'fee_type_fixed' : 'fee_type_percent')?.click();
            }
            [els.rungsInput, els.depthInput, els.skew].forEach(el => el?.dispatchEvent(new Event('input')));
            [els.priceRangeMode, els.spacingMode, els.feeSettlement].forEach(el => el?.dispatchEvent(new Event('change')));
            App.calculatePlan();
        };
        App.loadConfig = async event => {
            const input = event.target;
            const file = input?.files?.[0];
            if (!file) return;
            try {
                if (file.size > 100000) throw Error('Settings file is too large.');
                const config = Config.parse(await file.text());
                App.applyConfig(config);
                if (config.version !== 2) alert('Loaded legacy settings. This older file has no price, trading mode, range type or fees; check those fields before using the plan.');
            } catch (error) { alert(`Could not load settings: ${error.message}`); }
            finally { input.value = ''; }
        };
    };
})();

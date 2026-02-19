// OrderSkew - Setup Wizard questions (loaded before wizard.js)
(function () {
    window.SetupWizardQuestions = [
        {
            question: "What's your goal?",
            hint: "This determines how the calculator works",
            tooltip: "Choose your trading strategy: Buy Only for accumulation, Sell Only for exit planning, or Buy + Sell for a complete round-trip strategy.",
            type: "mode_choice",
            field: "trading_mode",
            options: [
                { label: "Buy Only", value: "buy-only", description: "I want to accumulate", icon: "↓", color: "red" },
                { label: "Sell Only", value: "sell-only", description: "I already own the asset", icon: "↑", color: "green" },
                { label: "Buy + Sell", value: "buy-sell", description: "Plan both buy and sell ladders", icon: "↕", color: "cyan" }
            ],
            default: "buy-only"
        },
        {
            question: "How much are you working with?",
            hint: "Enter your capital (buy mode) or quantity held (sell mode)",
            tooltip: "For Buy Only or Buy + Sell: Enter total capital available. For Sell Only: Enter the quantity of assets you currently hold.",
            type: "currency",
            field: "starting_capital",
            placeholder: "10,000",
            default: undefined
        },
        {
            question: "What's the current price?",
            hint: "The asset's market price right now",
            tooltip: "Enter the current market price of the asset. This serves as the baseline for calculating your buy and sell order ladders.",
            type: "currency",
            field: "current_price",
            placeholder: "100",
            default: undefined
        },
        {
            question: "What's your target?",
            hint: "Your lowest buy price or highest sell price",
            tooltip: "For Buy Only: Enter the lowest price you want to buy at. For Sell Only: Enter the highest price you want to sell at. For Buy + Sell: Enter the range percentage (default 25% means buys 25% below and sells 25% above current price).",
            type: "currency",
            field: "target_price",
            placeholder: "80",
            min: 0.01,
            default: undefined,
            dynamicHint: true
        }
    ];
})();

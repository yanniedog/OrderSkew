// OrderSkew: chart display event bindings (called from main.events.js)
(function () {
    window.OrderSkewBindChartEvents = function (App, els) {
        const chartShowBars = document.getElementById('chart-show-bars');
        const chartShowCumulative = document.getElementById('chart-show-cumulative');
        const chartUnitVolume = document.getElementById('chart-unit-volume');
        const chartUnitValue = document.getElementById('chart-unit-value');

        if (chartShowBars) {
            chartShowBars.addEventListener('change', () => {
                State.chartShowBars = chartShowBars.checked;
                App.redrawChart();
            });
        }
        if (chartShowCumulative) {
            chartShowCumulative.addEventListener('change', () => {
                State.chartShowCumulative = chartShowCumulative.checked;
                App.redrawChart();
            });
        }
        const updateChartUnitType = (type) => {
            State.chartUnitType = type;
            if (type === 'volume') {
                chartUnitVolume?.classList.add('active');
                chartUnitValue?.classList.remove('active');
            } else {
                chartUnitValue?.classList.add('active');
                chartUnitVolume?.classList.remove('active');
            }
            App.redrawChart();
        };
        if (chartUnitVolume) chartUnitVolume.addEventListener('click', () => updateChartUnitType('volume'));
        if (chartUnitValue) chartUnitValue.addEventListener('click', () => updateChartUnitType('value'));
    };
})();

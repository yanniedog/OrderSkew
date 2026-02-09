// OrderSkew module: attachNavigationMethods
(function () {
    window.OrderSkewModules = window.OrderSkewModules || {};

    window.OrderSkewModules.attachNavigationMethods = (App, els) => {
        Object.assign(App, {
        getIntroLayer: () => document.getElementById('intro-layer'),


        isMainScreenVisible: () => {
            const introLayer = App.getIntroLayer();
            if (!introLayer) return false;
            return introLayer.style.display === 'none'
                || (introLayer.style.opacity === '0' && introLayer.style.pointerEvents === 'none');
        },


        setIntroVisible: (visible) => {
            const introLayer = App.getIntroLayer();
            if (!introLayer) return;
            introLayer.style.display = visible ? 'flex' : 'none';
            introLayer.style.opacity = visible ? '1' : '0';
            introLayer.style.pointerEvents = visible ? 'auto' : 'none';
        },


        closeOpenOverlays: () => {
            const overlays = [
                { el: document.getElementById('setup-wizard'), resetStyles: true },
                { el: document.getElementById('how-it-works-modal') },
                { el: document.getElementById('video-modal') },
                { el: document.getElementById('qr-modal') }
            ];
            let closedAny = false;
            overlays.forEach(({ el, resetStyles }) => {
                if (el?.classList.contains('open')) {
                    el.classList.remove('open');
                    if (resetStyles) {
                        el.style.opacity = '0';
                        el.style.pointerEvents = 'none';
                    }
                    closedAny = true;
                }
            });
            return closedAny;
        },


        confirmLeaveMainScreen: () => {
            const shouldLeave = confirm('Leave and return to welcome screen?\n\nClick OK to continue, or Cancel to stay.');
            if (!shouldLeave) return false;
            if (State.currentPlanData) {
                const saveNow = confirm('Save your current plan before leaving?');
                if (saveNow) App.saveConfig();
            }
            return true;
        },


        handleBackNavigation: () => {
            const isMainScreen = App.isMainScreenVisible();

            if (App.closeOpenOverlays()) {
                history.pushState({ introVisible: !isMainScreen }, '');
                return;
            }

            if (isMainScreen && !App.confirmLeaveMainScreen()) {
                history.pushState({ introVisible: false }, '');
                return;
            }

            App.setIntroVisible(true);
            history.replaceState({ introVisible: true }, '');
        },
        

        returnToWelcome: (fromBackButton = false) => {
            if (App.isMainScreenVisible() && !fromBackButton) {
                if (!App.confirmLeaveMainScreen()) return;
            }

            App.closeOpenOverlays();
            App.setIntroVisible(true);
            history.replaceState({ introVisible: true }, '');
        }
        });
    };
})();
// OrderSkew: intro layer and How It Works modal bindings (called from main.events.js)
(function () {
    window.OrderSkewBindIntroEvents = function (App, els) {
        const howItWorksModal = document.getElementById('how-it-works-modal');
        const howItWorksVolumeChart = document.getElementById('how-it-works-volume-chart');
        const howItWorksValueChart = document.getElementById('how-it-works-value-chart');

        const toggleHowItWorks = (show) => {
            if (!howItWorksModal) return;
            howItWorksModal.classList.toggle('open', show);
            if (show && window.drawHowItWorksChart) {
                setTimeout(() => {
                    if (howItWorksVolumeChart) {
                        window.drawHowItWorksChart('#how-it-works-volume-chart svg', 100, false);
                    }
                    if (howItWorksValueChart) {
                        window.drawHowItWorksChart('#how-it-works-value-chart svg', 100, true);
                    }
                }, 100);
            }
        };

        const introHowItWorks = document.getElementById('intro-how-it-works');
        const howItWorksBackdrop = document.getElementById('how-it-works-backdrop');
        const howItWorksClose = document.getElementById('how-it-works-close');
        if (introHowItWorks) introHowItWorks.addEventListener('click', () => toggleHowItWorks(true));
        if (howItWorksBackdrop) howItWorksBackdrop.addEventListener('click', () => toggleHowItWorks(false));
        if (howItWorksClose) howItWorksClose.addEventListener('click', () => toggleHowItWorks(false));

        const howItWorksBtn = document.getElementById('how-it-works-btn');
        const howItWorksBtnMobile = document.getElementById('how-it-works-btn-mobile');
        if (howItWorksBtn) howItWorksBtn.addEventListener('click', () => toggleHowItWorks(true));
        if (howItWorksBtnMobile) howItWorksBtnMobile.addEventListener('click', () => toggleHowItWorks(true));

        const enterBtn = document.getElementById('enter-app-btn');
        if (enterBtn) {
            enterBtn.addEventListener('click', () => {
                const wizard = document.getElementById('setup-wizard');
                if (!wizard) { console.error('Setup wizard not found'); return; }
                SetupWizard.prepare();
                wizard.style.opacity = '1';
                wizard.style.pointerEvents = 'auto';
                requestAnimationFrame(() => {
                    SetupWizard.show();
                    Utils.setCookie('os_intro_seen', 'true');
                    Utils.hideIntro(document.getElementById('intro-layer'));
                    history.pushState({ introVisible: false }, '');
                });
            });
        }

        const skipToCustomizeBtn = document.getElementById('skip-to-customize-btn');
        if (skipToCustomizeBtn) {
            skipToCustomizeBtn.addEventListener('click', () => {
                Utils.setCookie('os_intro_seen', 'true');
                Utils.hideIntro(document.getElementById('intro-layer'));
                localStorage.setItem(CONSTANTS.STORAGE_PREFIX + 'setup_completed', 'true');
                App.setMode('pro');
                App.calculatePlan();
                history.pushState({ introVisible: false }, '');
            });
        }

        const logoHeader = document.getElementById('logo-header');
        if (logoHeader) {
            logoHeader.addEventListener('click', () => {
                App.returnToWelcome();
            });
        }

        const startOverBtn = document.getElementById('start-over-btn');
        if (startOverBtn) {
            startOverBtn.addEventListener('click', () => {
                SetupWizard.prepare();
                SetupWizard.show();
            });
        }

        window._orderSkewToggleHowItWorks = toggleHowItWorks;
    };
})();

let currentLang = 'ru';

const I18N = {
    en: {
        title: 'Pixel Map',
        regenerate: '\u21bb regenerate',
        exportBtn: '\u21e1 export',
        importBtn: '\u21e3 import',
        pause: '\u23F8 pause',
        resume: '\u25B6 resume',
        provinces: 'provinces',
        countries: 'countries',
        terrainFit: 'terrain fit',
        mapWidth: 'width',
        mapHeight: 'height',
        atk: 'atk',
        def: 'def',
        tickMs: 'tick ms',
        botEveryN: 'bot every N',
        growth: 'growth',
        tax: 'tax',
        armyUpkeep: 'army upkeep',
        infraUpkeep: 'infra upkeep',
        countryPanel: 'Countries \u25BE',
        countryPanelCollapsed: 'Countries \u25B8',
        clickToSelect: 'Click any province to select your country',
        attack: 'Attack',
        reinforce: 'Send',
        cancel: 'Cancel',
        army: 'Army:',
        sending: 'Sending:',
        proposesPeace: 'proposes peace',
        acceptPeace: 'Accept',
        rejectPeace: 'Reject',
        proposePeace: 'Propose Peace',
        war: 'WAR'
    },
    ru: {
        title: '\u041F\u0438\u043A\u0441\u0435\u043B\u044C\u043D\u0430\u044F \u041A\u0430\u0440\u0442\u0430',
        regenerate: '\u21bb \u043F\u0435\u0440\u0435\u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F',
        exportBtn: '\u21e1 \u044D\u043A\u0441\u043F\u043E\u0440\u0442',
        importBtn: '\u21e3 \u0438\u043C\u043F\u043E\u0440\u0442',
        pause: '\u23F8 \u043F\u0430\u0443\u0437\u0430',
        resume: '\u25B6 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C',
        provinces: '\u043F\u0440\u043E\u0432\u0438\u043D\u0446\u0438\u0438',
        countries: '\u0441\u0442\u0440\u0430\u043D\u044B',
        terrainFit: '\u0440\u0435\u043B\u044C\u0435\u0444',
        mapWidth: '\u0448\u0438\u0440\u0438\u043D\u0430',
        mapHeight: '\u0432\u044B\u0441\u043E\u0442\u0430',
        atk: '\u0430\u0442\u043A',
        def: '\u0437\u0430\u0449',
        tickMs: '\u0442\u0438\u043A \u043C\u0441',
        botEveryN: '\u0431\u043E\u0442 \u043A\u0430\u0436\u0434\u044B\u0439 N',
        growth: '\u0440\u043E\u0441\u0442',
        tax: '\u043D\u0430\u043B\u043E\u0433',
        armyUpkeep: '\u0441\u043E\u0434\u0435\u0440\u0436. \u0430\u0440\u043C\u0438\u0438',
        infraUpkeep: '\u0441\u043E\u0434\u0435\u0440\u0436. \u0438\u043D\u0444\u0440\u0430',
        countryPanel: '\u0421\u0442\u0440\u0430\u043D\u044B \u25BE',
        countryPanelCollapsed: '\u0421\u0442\u0440\u0430\u043D\u044B \u25B8',
        clickToSelect: '\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043D\u0430 \u043F\u0440\u043E\u0432\u0438\u043D\u0446\u0438\u044E, \u0447\u0442\u043E\u0431\u044B \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0443',
        attack: '\u0410\u0442\u0430\u043A\u0430',
        reinforce: '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C',
        cancel: '\u041E\u0442\u043C\u0435\u043D\u0430',
        army: '\u0410\u0440\u043C\u0438\u044F:',
        sending: '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C:',
        proposesPeace: '\u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 \u043C\u0438\u0440',
        acceptPeace: '\u041F\u0440\u0438\u043D\u044F\u0442\u044C',
        rejectPeace: '\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C',
        proposePeace: '\u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0438\u0442\u044C \u043C\u0438\u0440',
        war: '\u0412\u041E\u0419\u041D\u0410'
    }
};

function t(key) {
    return I18N[currentLang][key] || I18N['en'][key] || key;
}

function setLang(lang) {
    currentLang = lang;
    document.getElementById('langBtn').textContent = lang === 'en' ? 'RU' : 'EN';
    applyTranslations();
}

function applyTranslations() {
    document.querySelector('h1').textContent = t('title');
    document.getElementById('regenerateBtn').textContent = t('regenerate');
    document.getElementById('exportBtn').textContent = t('exportBtn');
    document.getElementById('importBtn').textContent = t('importBtn');
    document.getElementById('pauseBtn').textContent = G.isPaused ? t('resume') : t('pause');

    const labels = document.querySelectorAll('.settings label');
    if (labels[0]) labels[0].childNodes[0].textContent = t('mapWidth') + ' ';
    if (labels[1]) labels[1].childNodes[0].textContent = t('mapHeight') + ' ';
    if (labels[2]) labels[2].childNodes[0].textContent = t('provinces') + ' ';
    if (labels[3]) labels[3].childNodes[0].textContent = t('countries') + ' ';
    if (labels[4]) labels[4].childNodes[0].textContent = t('terrainFit') + ' ';
    if (labels[5]) labels[5].childNodes[1].textContent = ' ' + t('provinces');
    if (labels[6]) labels[6].childNodes[1].textContent = ' ' + t('countries');

    const bals = document.querySelectorAll('.balance-panel label');
    if (bals[0]) bals[0].childNodes[0].textContent = t('atk') + ' ';
    if (bals[1]) bals[1].childNodes[0].textContent = t('def') + ' ';
    if (bals[2]) bals[2].childNodes[0].textContent = t('tickMs') + ' ';
    if (bals[3]) bals[3].childNodes[0].textContent = t('botEveryN') + ' ';
    if (bals[4]) bals[4].childNodes[0].textContent = t('growth') + ' ';
    if (bals[5]) bals[5].childNodes[0].textContent = t('tax') + ' ';
    if (bals[6]) bals[6].childNodes[0].textContent = t('armyUpkeep') + ' ';
    if (bals[7]) bals[7].childNodes[0].textContent = t('infraUpkeep') + ' ';

    const body = document.getElementById('countryPanelBody');
    const isCollapsed = body && body.classList.contains('collapsed');
    document.getElementById('countryPanelToggle').textContent = isCollapsed ? t('countryPanelCollapsed') : t('countryPanel');

    const overlay = document.querySelector('.player-select-msg');
    if (overlay) overlay.textContent = t('clickToSelect');
}

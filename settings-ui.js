const emptyLabelSettings = document.getElementById('label-size-settings');
if (emptyLabelSettings && !emptyLabelSettings.hasChildNodes()) emptyLabelSettings.remove();

function settingsPreferences() {
  const defaults = {
    theme: 'light',
    fontScale: 1,
    density: 'spacious',
    language: 'en',
    timeZone: 'Asia/Phnom_Penh',
    productEmails: false,
    invoiceEmails: true,
    emailNotifications: true,
    pushNotifications: false,
    smsNotifications: false
  };
  settings.preferences = settings.preferences || {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (settings.preferences[key] === undefined) settings.preferences[key] = value;
  });
  return settings.preferences;
}

function saveLocalSettings(message) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (message) window.showToast?.(message);
  } catch (error) {
    console.error('Unable to save settings:', error);
    window.showToast?.('Unable to save this setting. Check available browser storage.');
  }
}

function applySettingsPreferences() {
  const preferences = settingsPreferences();
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.density = preferences.density;
  document.documentElement.style.setProperty('--font-scale', String(preferences.fontScale));
}

function selectSettingsSection(name, focusContent = false) {
  const button = document.querySelector(`[data-settings-section="${name}"]`);
  if (!button) return;
  document.querySelectorAll('[data-settings-section]').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.settings-section').forEach(section => {
    section.classList.toggle('active-settings', section.id === `${name}-settings`);
  });
  document.getElementById('settings-layout').classList.remove('settings-nav-open');
  document.getElementById('settings-mobile-browse').setAttribute('aria-expanded', 'false');
  if (focusContent) document.querySelector(`#${name}-settings h2`)?.focus();
}

function setQuickSettingsOpen(open) {
  const menu = document.getElementById('quick-settings-menu');
  const trigger = document.getElementById('quick-settings-trigger');
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('select')?.focus();
}

function updateAccountDetails() {
  const name = localStorage.getItem('papertrail-user-name') || 'Your account';
  const nameInput = document.getElementById('account-name');
  const displayName = document.getElementById('account-display-name');
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'A';
  nameInput.value = name;
  displayName.textContent = name;
  document.getElementById('account-avatar-initials').textContent = initials;
  document.getElementById('device-browser').textContent = `${/android|iphone|ipad|mobile/i.test(navigator.userAgent) ? 'Mobile browser' : 'Desktop browser'} · Active now`;

  fetch('/api/auth/session', { credentials: 'same-origin' })
    .then(response => {
      if (!response.ok) throw new Error(`Account details request failed (${response.status}).`);
      return response.json();
    })
    .then(user => {
      const email = typeof user.email === 'string' ? user.email : '';
      document.getElementById('account-email').textContent = email || 'Email unavailable';
      document.getElementById('account-email-input').value = email;
    })
    .catch(error => {
      console.error('Unable to load account details:', error);
      document.getElementById('account-email').textContent = 'Unable to load account details';
      document.getElementById('account-email-input').value = '';
    });
}

function initializeSettingsDashboard() {
  const preferences = settingsPreferences();
  applySettingsPreferences();
  updateAccountDetails();
  const updateZeroCurrencyScale = () => {
    const zeroScale = document.getElementById('chart-scale-0');
    if (zeroScale) zeroScale.textContent = `${currencySymbols[settings.business.currency] || '$'}0`;
  };
  updateZeroCurrencyScale();
  const renderDashboard = window.renderDashboard;
  if (typeof renderDashboard === 'function') {
    window.renderDashboard = function (...args) {
      renderDashboard.apply(this, args);
      updateZeroCurrencyScale();
    };
  }

  document.querySelectorAll('[name="preference-theme"]').forEach(input => {
    input.checked = input.value === preferences.theme;
    input.addEventListener('change', () => {
      preferences.theme = input.value;
      applySettingsPreferences();
      document.getElementById('quick-theme').value = preferences.theme;
      saveLocalSettings('Theme preference saved.');
    });
  });

  document.querySelectorAll('[name="preference-density"]').forEach(input => {
    input.checked = input.value === preferences.density;
    input.addEventListener('change', () => {
      preferences.density = input.value;
      applySettingsPreferences();
      document.getElementById('quick-density').value = preferences.density;
      saveLocalSettings('Layout preference saved.');
    });
  });

  document.getElementById('preference-font-scale').value = preferences.fontScale;
  document.getElementById('font-scale-value').value = `${Math.round(preferences.fontScale * 100)}%`;
  document.getElementById('preference-language').value = preferences.language;
  document.getElementById('preference-timezone').value = preferences.timeZone;
  document.getElementById('quick-theme').value = preferences.theme;
  document.getElementById('quick-density').value = preferences.density;

  document.querySelectorAll('[data-preference]').forEach(input => {
    input.checked = Boolean(preferences[input.dataset.preference]);
    input.addEventListener('change', () => {
      preferences[input.dataset.preference] = input.checked;
      saveLocalSettings('Notification preference saved.');
    });
  });

  document.getElementById('preference-font-scale').addEventListener('input', event => {
    preferences.fontScale = Number(event.target.value);
    document.getElementById('font-scale-value').value = `${Math.round(preferences.fontScale * 100)}%`;
    applySettingsPreferences();
    saveLocalSettings();
  });

  document.getElementById('preference-language').addEventListener('change', event => {
    preferences.language = event.target.value;
    saveLocalSettings('Display language preference saved.');
  });

  document.getElementById('preference-timezone').addEventListener('change', event => {
    preferences.timeZone = event.target.value;
    saveLocalSettings('Time zone preference saved.');
  });

  document.querySelectorAll('[data-settings-section]').forEach(button => {
    button.setAttribute('aria-current', button.classList.contains('active') ? 'page' : 'false');
    button.addEventListener('click', () => selectSettingsSection(button.dataset.settingsSection));
  });

  const settingsLayout = document.getElementById('settings-layout');
  const mobileBrowse = document.getElementById('settings-mobile-browse');
  mobileBrowse.addEventListener('click', () => {
    const open = !settingsLayout.classList.contains('settings-nav-open');
    settingsLayout.classList.toggle('settings-nav-open', open);
    mobileBrowse.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('settings-nav-backdrop').addEventListener('click', () => {
    settingsLayout.classList.remove('settings-nav-open');
    mobileBrowse.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('settings-collapse').addEventListener('click', () => {
    settingsLayout.classList.toggle('is-collapsed');
    document.getElementById('settings-collapse').setAttribute(
      'aria-label',
      settingsLayout.classList.contains('is-collapsed') ? 'Expand settings menu' : 'Collapse settings menu'
    );
  });

  document.getElementById('settings-search').addEventListener('input', event => {
    const query = event.target.value.trim().toLocaleLowerCase();
    const buttons = [...document.querySelectorAll('[data-settings-section]')];
    const matching = buttons.filter(button => {
      const haystack = `${button.dataset.search} ${button.textContent}`.toLocaleLowerCase();
      return !query || haystack.includes(query);
    });
    buttons.forEach(button => {
      button.hidden = !matching.includes(button);
    });
    document.getElementById('settings-search-empty').hidden = matching.length > 0;
    if (matching.length && !matching.some(button => button.classList.contains('active'))) {
      selectSettingsSection(matching[0].dataset.settingsSection);
    }
  });

  document.getElementById('account-avatar-upload').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      window.showToast?.('Please choose an image under 2MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      preferences.avatar = reader.result;
      const image = document.getElementById('account-avatar-image');
      image.src = reader.result;
      image.hidden = false;
      document.getElementById('account-avatar-initials').hidden = true;
      saveLocalSettings('Profile photo saved on this device.');
    });
    reader.addEventListener('error', () => window.showToast?.('Unable to read that image. Please try another file.'));
    reader.readAsDataURL(file);
  });

  if (preferences.avatar) {
    const image = document.getElementById('account-avatar-image');
    image.src = preferences.avatar;
    image.hidden = false;
    document.getElementById('account-avatar-initials').hidden = true;
  }

  document.getElementById('quick-settings-trigger').addEventListener('click', () => {
    setQuickSettingsOpen(document.getElementById('quick-settings-menu').hidden);
  });
  document.querySelector('.quick-settings-close').addEventListener('click', () => setQuickSettingsOpen(false));
  document.getElementById('quick-theme').addEventListener('change', event => {
    preferences.theme = event.target.value;
    document.querySelector(`[name="preference-theme"][value="${preferences.theme}"]`).checked = true;
    applySettingsPreferences();
    saveLocalSettings('Theme preference saved.');
  });
  document.getElementById('quick-density').addEventListener('change', event => {
    preferences.density = event.target.value;
    document.querySelector(`[name="preference-density"][value="${preferences.density}"]`).checked = true;
    applySettingsPreferences();
    saveLocalSettings('Layout preference saved.');
  });
  document.querySelectorAll('[data-open-setting]').forEach(button => {
    button.addEventListener('click', () => {
      setQuickSettingsOpen(false);
      showView('settings');
      selectSettingsSection(button.dataset.openSetting);
    });
  });

  document.addEventListener('click', event => {
    const menu = document.getElementById('quick-settings-menu');
    if (!menu.hidden && !event.target.closest('.quick-settings-wrap')) setQuickSettingsOpen(false);
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      document.getElementById('settings-search').focus();
    }
    if (event.key === 'Escape') {
      setQuickSettingsOpen(false);
      settingsLayout.classList.remove('settings-nav-open');
      mobileBrowse.setAttribute('aria-expanded', 'false');
    }
  });
}

window.addEventListener('DOMContentLoaded', initializeSettingsDashboard);

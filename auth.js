const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authTitle = document.getElementById('auth-title');
const authKicker = document.getElementById('auth-kicker');
const authDescription = document.getElementById('auth-description');

function showAuthMessage(form, message) {
  form.querySelector('.auth-message').textContent = message;
}

function setBusy(form, busy) {
  const button = form.querySelector('.auth-submit');
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

function switchAuthMode() {
  const registering = window.location.pathname === '/register';
  loginForm.hidden = registering;
  registerForm.hidden = !registering;
  authKicker.textContent = registering ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK';
  authTitle.textContent = registering ? 'Start your workspace' : 'Log in to your account';
  authDescription.textContent = registering
    ? 'Create an account to keep your invoices private and organized.'
    : 'Enter your details to continue to your workspace.';
}

function setAccountStorage(user) {
  const oldInvoices = localStorage.getItem('papertrail-invoices');
  const oldSettings = localStorage.getItem('papertrail-settings');
  const invoicesKey = `papertrail-invoices-${user.id}`;
  const settingsKey = `papertrail-settings-${user.id}`;
  const migrationKey = 'papertrail-legacy-data-reviewed';

  if (!localStorage.getItem(migrationKey) && (oldInvoices !== null || oldSettings !== null)) {
    const shouldMigrate = window.confirm('Move existing invoices and settings from this browser into this account?');
    if (shouldMigrate) {
      if (localStorage.getItem(invoicesKey) === null && oldInvoices !== null) {
        localStorage.setItem(invoicesKey, oldInvoices);
        localStorage.removeItem('papertrail-invoices');
      }
      if (localStorage.getItem(settingsKey) === null && oldSettings !== null) {
        localStorage.setItem(settingsKey, oldSettings);
        localStorage.removeItem('papertrail-settings');
      }
    }
    localStorage.setItem(migrationKey, 'true');
  }

  localStorage.setItem('papertrail-user-id', user.id);
  localStorage.setItem('papertrail-user-name', user.full_name);
}

async function apiRequest(path, data) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch {
    throw new Error('Unable to reach the account service. Check your connection and try again.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.detail || 'Unable to complete your request. Please try again.');
  }
  if (!result || typeof result !== 'object') {
    throw new Error('The account service returned an unexpected response. Please try again.');
  }
  return result;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  showAuthMessage(loginForm, '');
  if (!loginForm.reportValidity()) return;

  const formData = new FormData(loginForm);
  setBusy(loginForm, true);
  try {
    const user = await apiRequest('/api/auth/login', {
      email: formData.get('email'),
      password: formData.get('password'),
      remember: formData.get('remember') === 'on'
    });
    setAccountStorage(user);
    window.location.assign('/');
  } catch (error) {
    showAuthMessage(loginForm, error.message);
  } finally {
    setBusy(loginForm, false);
  }
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  showAuthMessage(registerForm, '');
  if (!registerForm.reportValidity()) return;
  const formData = new FormData(registerForm);
  if (formData.get('password') !== formData.get('password_confirm')) {
    showAuthMessage(registerForm, 'Passwords do not match.');
    return;
  }

  const submit = registerForm.querySelector('.auth-submit');
  if (submit.disabled) return;
  setBusy(registerForm, true);
  try {
    const user = await apiRequest('/api/auth/register', {
      full_name: formData.get('full_name'),
      email: formData.get('email'),
      password: formData.get('password'),
      password_confirm: formData.get('password_confirm')
    });
    setAccountStorage(user);
    window.location.assign('/');
  } catch (error) {
    showAuthMessage(registerForm, error.message);
  } finally {
    setBusy(registerForm, false);
  }
});

document.querySelectorAll('[data-password-toggle]').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    button.textContent = showPassword ? 'Hide' : 'Show';
    button.setAttribute('aria-label', `${showPassword ? 'Hide' : 'Show'} password`);
  });
});

document.getElementById('forgot-password').addEventListener('click', () => {
  showAuthMessage(loginForm, 'Password reset is unavailable until email delivery is configured.');
});

const legalDialog = document.getElementById('legal-dialog');
document.querySelectorAll('[data-legal-notice]').forEach(button => {
  button.addEventListener('click', () => {
    const isPrivacyNotice = button.dataset.legalNotice === 'privacy';
    document.getElementById('legal-title').textContent = isPrivacyNotice ? 'Privacy details' : 'Terms of use';
    document.getElementById('legal-copy').textContent = isPrivacyNotice
      ? 'Account details, password hashes, and sessions are stored in the app database. Invoice data and preferences are saved in this browser, scoped by account ID, and are not encrypted by the app. Anyone with access to this browser profile may be able to access that local data. This app does not currently send email or use external sign-in providers.'
      : 'Use this workspace to create and manage invoices. You are responsible for the accuracy of information you enter and for keeping suitable backups. Review the app and its data handling for your needs before using it for business-critical records.';
    legalDialog.showModal();
  });
});

const registerPassword = document.getElementById('register-password');
const strengthFill = document.getElementById('strength-fill');
const strengthLabel = document.getElementById('strength-label');

registerPassword.addEventListener('input', () => {
  const password = registerPassword.value;
  const criteria = [
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;
  const level = password.length === 0 ? 0 : criteria <= 1 ? 1 : criteria < 4 ? 2 : 3;
  const labels = ['Use at least 12 characters.', 'Weak password', 'Medium password', 'Strong password'];
  const colors = ['#e6ece8', '#dc8b72', '#d4a744', '#4a9b75'];
  strengthFill.style.width = `${level * 25}%`;
  strengthFill.style.backgroundColor = colors[level];
  strengthLabel.textContent = labels[level];
});

switchAuthMode();
async function restoreSession() {
  const form = window.location.pathname === '/register' ? registerForm : loginForm;
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (response.status === 401) return;
    if (!response.ok) throw new Error('Unable to verify your account. Please try again.');
    const user = await response.json();
    setAccountStorage(user);
    window.location.replace('/');
  } catch {
    showAuthMessage(form, 'Unable to verify your account. Check your connection and try again.');
  }
}

restoreSession();

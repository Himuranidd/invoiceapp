function syncAccountProfile() {
  const name = localStorage.getItem('papertrail-user-name') || 'Your account';
  const nameElement = document.querySelector('.profile-copy strong');
  const avatar = document.querySelector('.profile-area .avatar');
  if (!nameElement || !avatar) return;

  nameElement.textContent = name;
  avatar.textContent = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'A';
}

const originalDashboardRenderer = window.renderDashboard;
if (typeof originalDashboardRenderer === 'function') {
  window.renderDashboard = function (...args) {
    originalDashboardRenderer.apply(this, args);
    syncAccountProfile();
  };
}

syncAccountProfile();

document.addEventListener('click', event => {
  const action = event.target.closest('.side-nav [data-account-action]');
  if (!action) return;
  if (action.dataset.accountAction === 'logout') {
    action.disabled = true;
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error('Unable to log out. Please try again.');
        localStorage.removeItem('papertrail-user-id');
        localStorage.removeItem('papertrail-user-name');
        window.location.replace('/login');
      })
      .catch(error => {
        action.disabled = false;
        window.showToast?.(error.message);
      });
    return;
  }
  window.showToast?.('This account option is not available yet.');
});

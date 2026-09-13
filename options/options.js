/**
 * SiteLock Guard - Options & Settings Dashboard Controller
 * Enforces Master PIN Gatekeeper so normal users cannot access or view settings.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Gatekeeper Elements
  const adminGate = document.getElementById('adminGate');
  const gateForm = document.getElementById('gateForm');
  const gatePinInput = document.getElementById('gatePinInput');
  const gateToggleBtn = document.getElementById('gateToggleBtn');
  const gateError = document.getElementById('gateError');
  const protectedLayout = document.getElementById('protectedLayout');

  // Dashboard Elements
  const toast = document.getElementById('toast');
  const defaultPinWarning = document.getElementById('defaultPinWarning');
  const pinForm = document.getElementById('pinForm');
  const currentMasterPin = document.getElementById('currentMasterPin');
  const newMasterPin = document.getElementById('newMasterPin');
  const confirmMasterPin = document.getElementById('confirmMasterPin');
  const newDuressPin = document.getElementById('newDuressPin');
  const confirmDuressPin = document.getElementById('confirmDuressPin');

  const saveDuressConfigBtn = document.getElementById('saveDuressConfigBtn');
  const decoyUrlWrap = document.getElementById('decoyUrlWrap');
  const decoyUrlInput = document.getElementById('decoyUrlInput');

  // Boss / Panic Hotkey Elements
  const bossKeyForm = document.getElementById('bossKeyForm');
  const bossKeyToggle = document.getElementById('bossKeyToggle');
  const bossKeySelect = document.getElementById('bossKeySelect');
  const bossActionSelect = document.getElementById('bossActionSelect');
  const bossRedirectWrap = document.getElementById('bossRedirectWrap');
  const bossRedirectInput = document.getElementById('bossRedirectInput');
  const saveBossConfigBtn = document.getElementById('saveBossConfigBtn');

  // Intruder Video Trap Elements
  const intruderForm = document.getElementById('intruderForm');
  const intruderToggle = document.getElementById('intruderToggle');
  const intruderAttemptsSelect = document.getElementById('intruderAttemptsSelect');
  const intruderVideoInput = document.getElementById('intruderVideoInput');
  const saveIntruderConfigBtn = document.getElementById('saveIntruderConfigBtn');

  const addSiteForm = document.getElementById('addSiteForm');
  const newSiteInput = document.getElementById('newSiteInput');
  const newSitePinInput = document.getElementById('newSitePinInput');
  const lockedSitesGrid = document.getElementById('lockedSitesGrid');
  const siteCount = document.getElementById('siteCount');
  const removeAllSitesBtn = document.getElementById('removeAllSitesBtn');
  const presetChips = document.getElementById('presetChips');

  // Site PIN Modal Elements
  const sitePinModal = document.getElementById('sitePinModal');
  const closeSitePinModalBtn = document.getElementById('closeSitePinModalBtn');
  const sitePinModalForm = document.getElementById('sitePinModalForm');
  const sitePinModalDomain = document.getElementById('sitePinModalDomain');
  const sitePinModalTitle = document.getElementById('sitePinModalTitle');
  const modalSitePinInput = document.getElementById('modalSitePinInput');
  const modalSitePinConfirm = document.getElementById('modalSitePinConfirm');
  const modalRemoveSitePinBtn = document.getElementById('modalRemoveSitePinBtn');
  const modalCancelSitePinBtn = document.getElementById('modalCancelSitePinBtn');

  const sessionTimeoutSelect = document.getElementById('sessionTimeoutSelect');
  const saveTimeoutBtn = document.getElementById('saveTimeoutBtn');
  const sidebarLockAllBtn = document.getElementById('sidebarLockAllBtn');

  const logsTableBody = document.getElementById('logsTableBody');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

  let currentLockedDomains = [];
  let currentSitePins = {};
  let currentDecoyActiveDomains = {};
  let authenticatedMasterPin = '';

  // Gatekeeper Toggle View
  gateToggleBtn.addEventListener('click', () => {
    if (gatePinInput.type === 'password') {
      gatePinInput.type = 'text';
      gateToggleBtn.textContent = 'Hide';
    } else {
      gatePinInput.type = 'password';
      gateToggleBtn.textContent = 'Show';
    }
  });

  // Gatekeeper Submit
  gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = gatePinInput.value.trim();
    if (!pin) return;

    chrome.runtime.sendMessage({ type: 'VERIFY_ADMIN_PIN', pin }, async (res) => {
      if (res && res.authorized) {
        authenticatedMasterPin = pin;
        currentMasterPin.value = pin; // Pre-fill authorization for ease of use by admin

        adminGate.style.opacity = '0';
        setTimeout(() => {
          adminGate.style.display = 'none';
          protectedLayout.style.display = 'flex';
        }, 250);

        await loadState();
        await loadLogs();
      } else {
        gateError.textContent = res?.error || 'Incorrect Master PIN';
        gateError.style.display = 'block';
        gatePinInput.value = '';
        gatePinInput.focus();
      }
    });
  });

  // Toast Helper
  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.className = `toast show ${isError ? 'error' : ''}`;
    setTimeout(() => {
      toast.className = 'toast';
    }, 3200);
  }

  // Password Visibility Toggles
  document.querySelectorAll('.view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    });
  });

  // Navigation Smooth Scroll & Active Indicator
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navItems.forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
      const targetId = item.getAttribute('href').slice(1);
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Clean Domain Input Helper
  function cleanDomainInput(input) {
    let clean = input.trim().toLowerCase();
    if (clean.includes('://')) {
      try {
        clean = new URL(clean).hostname;
      } catch {
        clean = clean.split('://')[1].split('/')[0];
      }
    }
    clean = clean.split('/')[0].split('?')[0].split('#')[0];
    if (clean.startsWith('www.')) {
      clean = clean.slice(4);
    }
    return clean;
  }

  // Load Extension State
  async function loadState() {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'GET_EXTENSION_STATE' });
      if (!state) return;

      // Default PIN warning
      defaultPinWarning.style.display = state.isMasterDefault ? 'flex' : 'none';

      // Duress config
      const action = state.duressAction || 'error_screen';
      const radio = document.querySelector(`input[name="duressAction"][value="${action}"]`);
      if (radio) radio.checked = true;

      decoyUrlInput.value = state.decoyUrl || 'https://www.google.com';
      toggleDecoyUrlVisibility(action);

      // Boss / Panic Hotkey config
      bossKeyToggle.checked = state.bossKeyEnabled !== false;
      bossKeySelect.value = state.bossKey || 'F3';
      bossActionSelect.value = state.bossAction || 'redirect';
      bossRedirectInput.value = state.bossRedirectUrl || 'https://www.youtube.com';
      toggleBossRedirectVisibility(bossActionSelect.value);

      // Intruder Video Trap config
      intruderToggle.checked = state.intruderVideoEnabled !== false;
      intruderAttemptsSelect.value = state.intruderMaxAttempts || 4;
      intruderVideoInput.value = state.intruderVideoUrl || 'https://www.youtube.com/watch?v=1CouGcNKICc';

      // Session timeout
      if (state.sessionTimeout) {
        sessionTimeoutSelect.value = state.sessionTimeout;
      }

      // Site Pins and Locked Domains
      currentSitePins = state.sitePins || {};
      currentLockedDomains = state.lockedDomains || [];

      // Decoy active domains
      const localData = await chrome.storage.local.get('decoyActiveDomains');
      currentDecoyActiveDomains = localData.decoyActiveDomains || {};

      renderLockedDomains();
    } catch (err) {
      console.error('Failed to load options state:', err);
    }
  }

  function toggleDecoyUrlVisibility(action) {
    if (action === 'redirect') {
      decoyUrlWrap.style.display = 'flex';
    } else {
      decoyUrlWrap.style.display = 'none';
    }
  }

  function toggleBossRedirectVisibility(action) {
    if (action === 'redirect') {
      bossRedirectWrap.style.display = 'block';
    } else {
      bossRedirectWrap.style.display = 'none';
    }
  }

  bossActionSelect.addEventListener('change', (e) => {
    toggleBossRedirectVisibility(e.target.value);
  });

  document.querySelectorAll('.boss-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      bossRedirectInput.value = chip.dataset.url;
      document.querySelectorAll('.boss-preset-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  document.querySelectorAll('.intruder-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      intruderVideoInput.value = chip.dataset.url;
      document.querySelectorAll('.intruder-preset-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  document.querySelectorAll('input[name="duressAction"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      toggleDecoyUrlVisibility(e.target.value);
    });
  });

  // Render Domains Grid
  function renderLockedDomains() {
    siteCount.textContent = currentLockedDomains.length;
    lockedSitesGrid.innerHTML = '';

    if (currentLockedDomains.length === 0) {
      lockedSitesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; color: var(--text-dim); font-size: 13px; text-align: center; padding: 20px;">
          No websites protected yet. Add a domain or click any popular app preset above!
        </div>
      `;
      return;
    }

    currentLockedDomains.forEach((domain) => {
      const hasCustomPin = Boolean(currentSitePins[domain]);
      const isDecoyActive = Boolean(currentDecoyActiveDomains[domain] && currentDecoyActiveDomains[domain] > Date.now());
      const item = document.createElement('div');
      item.className = 'site-item';
      item.innerHTML = `
        <div class="site-name-wrap">
          <svg viewBox="0 0 24 24">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
          <span class="site-name" title="${domain}">${domain}</span>
          <span class="site-pin-badge ${hasCustomPin ? 'custom' : 'master'}">${hasCustomPin ? 'Custom PIN' : 'Master PIN'}</span>
          ${isDecoyActive ? '<span class="site-pin-badge" style="background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);">Decoy Lock Active</span>' : ''}
        </div>
        <div class="site-actions">
          ${isDecoyActive ? `
            <button type="button" class="site-action-btn disarm-decoy-btn" data-domain="${domain}" title="Disarm Decoy for ${domain}" style="color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">
              <span>🛡️</span>
              <span>Disarm</span>
            </button>
          ` : ''}
          <button type="button" class="site-action-btn edit-pin-btn" data-domain="${domain}" title="Set or change password for ${domain}">
            <span>🔑</span>
            <span>${hasCustomPin ? 'Edit PIN' : 'Set PIN'}</span>
          </button>
          <button type="button" class="site-action-btn delete-site-btn" data-domain="${domain}" title="Remove protection">
            <svg viewBox="0 0 24 24">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      `;
      lockedSitesGrid.appendChild(item);
    });

    // Update preset chip styles
    presetChips.querySelectorAll('.chip').forEach((chip) => {
      const d = chip.dataset.domain;
      const isSelected = currentLockedDomains.includes(d);
      if (isSelected) {
        chip.classList.add('active');
        chip.textContent = `✓ ${chip.textContent.replace(/^(\+ |✓ )/, '')}`;
      } else {
        chip.classList.remove('active');
        chip.textContent = `+ ${chip.textContent.replace(/^(\+ |✓ )/, '')}`;
      }
    });
  }

  // Add Domain from Form
  addSiteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = newSiteInput.value;
    const domain = cleanDomainInput(raw);
    const customPin = newSitePinInput.value.trim();

    if (!domain || domain.length < 3) {
      showToast('Please enter a valid website domain', true);
      return;
    }

    if (currentLockedDomains.includes(domain)) {
      showToast('This website is already protected', true);
      return;
    }

    if (customPin && !/^\d{4,8}$/.test(customPin)) {
      showToast('Custom PIN must be 4 to 8 numeric digits', true);
      return;
    }

    currentLockedDomains.push(domain);
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      lockedDomains: currentLockedDomains
    });

    if (customPin) {
      await chrome.runtime.sendMessage({
        type: 'SET_SITE_PIN',
        domain,
        pin: customPin
      });
      currentSitePins[domain] = true;
    }

    newSiteInput.value = '';
    newSitePinInput.value = '';
    renderLockedDomains();
    showToast(`Protected ${domain}${customPin ? ' with dedicated custom PIN' : ''}`);
  });

  // Preset Chips Click
  presetChips.addEventListener('click', async (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    const domain = chip.dataset.domain;
    if (currentLockedDomains.includes(domain)) {
      currentLockedDomains = currentLockedDomains.filter((d) => d !== domain);
      if (currentSitePins[domain]) {
        delete currentSitePins[domain];
        await chrome.runtime.sendMessage({ type: 'REMOVE_SITE_PIN', domain });
      }
      showToast(`Removed ${domain}`);
    } else {
      currentLockedDomains.push(domain);
      showToast(`Protected ${domain}`);
    }

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      lockedDomains: currentLockedDomains
    });
    renderLockedDomains();
  });

  // Site Item Actions (Edit PIN or Delete)
  lockedSitesGrid.addEventListener('click', async (e) => {
    const disarmBtn = e.target.closest('.disarm-decoy-btn');
    if (disarmBtn) {
      const domain = disarmBtn.dataset.domain;
      await chrome.runtime.sendMessage({ type: 'DISARM_DECOY', domain });
      delete currentDecoyActiveDomains[domain];
      renderLockedDomains();
      showToast(`Decoy mode disarmed for ${domain}`);
      return;
    }

    const editBtn = e.target.closest('.edit-pin-btn');
    if (editBtn) {
      const domain = editBtn.dataset.domain;
      openSitePinModal(domain);
      return;
    }

    const deleteBtn = e.target.closest('.delete-site-btn');
    if (deleteBtn) {
      const domain = deleteBtn.dataset.domain;
      currentLockedDomains = currentLockedDomains.filter((d) => d !== domain);
      if (currentSitePins[domain]) {
        delete currentSitePins[domain];
        await chrome.runtime.sendMessage({ type: 'REMOVE_SITE_PIN', domain });
      }
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        lockedDomains: currentLockedDomains
      });
      renderLockedDomains();
      showToast(`Removed ${domain} from locked list`);
    }
  });

  // Site PIN Modal Functions
  function openSitePinModal(domain) {
    sitePinModalDomain.value = domain;
    sitePinModalTitle.textContent = `Set Passcode for ${domain}`;
    modalSitePinInput.value = '';
    modalSitePinConfirm.value = '';

    const hasCustomPin = Boolean(currentSitePins[domain]);
    modalRemoveSitePinBtn.style.display = hasCustomPin ? 'inline-block' : 'none';

    sitePinModal.style.display = 'flex';
    modalSitePinInput.focus();
  }

  function closeSitePinModal() {
    sitePinModal.style.display = 'none';
  }

  closeSitePinModalBtn.addEventListener('click', closeSitePinModal);
  modalCancelSitePinBtn.addEventListener('click', closeSitePinModal);

  sitePinModal.addEventListener('click', (e) => {
    if (e.target === sitePinModal) {
      closeSitePinModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sitePinModal.style.display === 'flex') {
      closeSitePinModal();
    }
  });

  sitePinModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const domain = sitePinModalDomain.value;
    const pin = modalSitePinInput.value.trim();
    const conf = modalSitePinConfirm.value.trim();

    if (!/^\d{4,8}$/.test(pin)) {
      showToast('PIN must be 4 to 8 numeric digits', true);
      return;
    }

    if (pin !== conf) {
      showToast('PIN and confirmation do not match', true);
      return;
    }

    await chrome.runtime.sendMessage({
      type: 'SET_SITE_PIN',
      domain,
      pin
    });

    currentSitePins[domain] = true;
    closeSitePinModal();
    renderLockedDomains();
    showToast(`Individual PIN saved for ${domain}!`);
  });

  modalRemoveSitePinBtn.addEventListener('click', async () => {
    const domain = sitePinModalDomain.value;
    await chrome.runtime.sendMessage({
      type: 'REMOVE_SITE_PIN',
      domain
    });

    delete currentSitePins[domain];
    closeSitePinModal();
    renderLockedDomains();
    showToast(`${domain} reverted to Master PIN`);
  });

  // Clear All Sites
  removeAllSitesBtn.addEventListener('click', async () => {
    if (currentLockedDomains.length === 0) return;
    if (!confirm('Are you sure you want to remove protection from all websites?')) return;

    currentLockedDomains = [];
    currentSitePins = {};
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      lockedDomains: []
    });
    await chrome.storage.local.set({ sitePins: {} });
    renderLockedDomains();
    showToast('All websites unprotected');
  });

  // Save PIN Form
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currPin = currentMasterPin.value.trim() || authenticatedMasterPin;
    const newMaster = newMasterPin.value.trim();
    const confMaster = confirmMasterPin.value.trim();
    const newDuress = newDuressPin.value.trim();
    const confDuress = confirmDuressPin.value.trim();

    if (!currPin) {
      showToast('Current Master PIN is required', true);
      return;
    }

    if (!newMaster && !newDuress) {
      showToast('Please provide a new Master PIN or new Duress PIN', true);
      return;
    }

    if (newMaster) {
      if (!/^\d{4,8}$/.test(newMaster)) {
        showToast('New Master PIN must be 4 to 8 numeric digits', true);
        return;
      }
      if (newMaster !== confMaster) {
        showToast('New Master PIN and confirmation do not match', true);
        return;
      }
    }

    if (newDuress) {
      if (!/^\d{4,8}$/.test(newDuress)) {
        showToast('New Duress PIN must be 4 to 8 numeric digits', true);
        return;
      }
      if (newDuress !== confDuress) {
        showToast('New Duress PIN and confirmation do not match', true);
        return;
      }
    }

    const finalMaster = newMaster || currPin;
    const finalDuress = newDuress;
    if (finalDuress && finalMaster === finalDuress) {
      showToast('Master PIN and Duress PIN cannot be the same code!', true);
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: 'UPDATE_PINS',
      currentMasterPin: currPin,
      newMasterPin: newMaster || undefined,
      newDuressPin: newDuress || undefined
    });

    if (res && res.success) {
      showToast('Passcodes successfully updated!');
      if (newMaster) authenticatedMasterPin = newMaster;
      newMasterPin.value = '';
      confirmMasterPin.value = '';
      newDuressPin.value = '';
      confirmDuressPin.value = '';
      defaultPinWarning.style.display = 'none';
      await loadLogs();
    } else {
      showToast(res?.error || 'Failed to update PINs. Check current PIN.', true);
    }
  });

  // Save Duress Decoy Config
  saveDuressConfigBtn.addEventListener('click', async () => {
    const selectedRadio = document.querySelector('input[name="duressAction"]:checked');
    const action = selectedRadio ? selectedRadio.value : 'error_screen';
    const decoyUrl = decoyUrlInput.value.trim() || 'https://www.google.com';

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      duressAction: action,
      decoyUrl: decoyUrl
    });

    showToast('Duress & decoy settings saved!');
  });

  // Save Boss / Panic Hotkey Config
  bossKeyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enabled = bossKeyToggle.checked;
    const key = bossKeySelect.value;
    const action = bossActionSelect.value;
    const redirectUrl = bossRedirectInput.value.trim() || 'https://www.youtube.com';

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      bossKeyEnabled: enabled,
      bossKey: key,
      bossAction: action,
      bossRedirectUrl: redirectUrl
    });

    showToast('Panic / Boss Key settings saved!');
  });

  // Save Intruder Punishment Video Config
  intruderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enabled = intruderToggle.checked;
    const attempts = parseInt(intruderAttemptsSelect.value, 10) || 4;
    const url = intruderVideoInput.value.trim() || 'https://www.youtube.com/watch?v=1CouGcNKICc';

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      intruderVideoEnabled: enabled,
      intruderMaxAttempts: attempts,
      intruderVideoUrl: url
    });

    showToast('Intruder trap settings saved!');
  });

  // Save Session Timeout (Lock on Refresh vs Duration)
  saveTimeoutBtn.addEventListener('click', async () => {
    const timeout = sessionTimeoutSelect.value;
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      sessionTimeout: timeout
    });
    showToast('Auto-relock policy saved!');
  });

  // Lock All Active Sites Immediately
  sidebarLockAllBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'LOCK_ALL_NOW' });
    showToast('All active sessions locked immediately');
    await loadLogs();
  });

  // Load Audit Logs
  async function loadLogs() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_AUDIT_LOGS' });
      if (!res || !res.logs) return;

      logsTableBody.innerHTML = '';
      if (res.logs.length === 0) {
        logsTableBody.innerHTML = `
          <tr>
            <td colspan="3" style="text-align: center; color: var(--text-dim); padding: 20px;">
              No security events recorded yet.
            </td>
          </tr>
        `;
        return;
      }

      res.logs.forEach((log) => {
        const row = document.createElement('tr');
        const dateStr = new Date(log.timestamp).toLocaleString();

        let badgeClass = 'info';
        let badgeLabel = log.type;

        if (log.type === 'master_unlock') {
          badgeClass = 'master_unlock';
          badgeLabel = 'Master Unlock';
        } else if (log.type === 'duress_trigger') {
          badgeClass = 'duress_trigger';
          badgeLabel = 'Duress Decoy Triggered';
        } else if (log.type === 'boss_key') {
          badgeClass = 'boss_key';
          badgeLabel = 'Panic Boss Key';
        } else if (log.type === 'intruder_trap') {
          badgeClass = 'intruder_trap';
          badgeLabel = 'Intruder Video Trap';
        } else if (log.type === 'failed_attempt') {
          badgeClass = 'failed_attempt';
          badgeLabel = 'Failed PIN Attempt';
        } else if (log.type === 'pins_updated') {
          badgeClass = 'info';
          badgeLabel = 'PINs Updated';
        }

        row.innerHTML = `
          <td><span class="log-badge ${badgeClass}">${badgeLabel}</span></td>
          <td>${escapeHtml(log.details)}</td>
          <td style="color: var(--text-dim); white-space: nowrap;">${dateStr}</td>
        `;
        logsTableBody.appendChild(row);
      });
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  }

  // Clear Logs
  clearLogsBtn.addEventListener('click', async () => {
    if (!confirm('Clear all security activity logs?')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_AUDIT_LOGS' });
    await loadLogs();
    showToast('Security logs cleared');
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});

/**
 * SiteLock Guard - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const currentDomainEl = document.getElementById('currentDomain');
  const protectToggle = document.getElementById('protectToggle');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const lockThisSiteBtn = document.getElementById('lockThisSiteBtn');
  const disarmDecoyBtn = document.getElementById('disarmDecoyBtn');
  const lockAllBtn = document.getElementById('lockAllBtn');
  const manageSitesBtn = document.getElementById('manageSitesBtn');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const defaultPinBanner = document.getElementById('defaultPinBanner');
  const bannerSettingsBtn = document.getElementById('bannerSettingsBtn');
  const protectedCountDesc = document.getElementById('protectedCountDesc');
  const duressModeLabel = document.getElementById('duressModeLabel');

  let currentTab = null;
  let activeHostname = null;

  // Open settings handler
  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  };

  openSettingsBtn.addEventListener('click', openSettings);
  manageSitesBtn.addEventListener('click', openSettings);
  bannerSettingsBtn.addEventListener('click', openSettings);

  // Helper to normalize domain
  function normalizeDomain(url) {
    try {
      let host = new URL(url).hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      return host;
    } catch {
      return null;
    }
  }

  // Load state and active tab
  async function refreshUI() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tab;

      const isSpecialPage = !tab || !tab.url || 
        tab.url.startsWith('chrome') || 
        tab.url.startsWith('brave') || 
        tab.url.startsWith('about:') || 
        tab.url.startsWith('chrome-extension:');

      if (isSpecialPage) {
        currentDomainEl.textContent = 'System / Internal Page';
        protectToggle.disabled = true;
        protectToggle.checked = false;
        statusDot.className = 'status-dot';
        statusText.textContent = 'Cannot lock browser pages';
        lockThisSiteBtn.style.display = 'none';
      } else {
        activeHostname = normalizeDomain(tab.url);
        currentDomainEl.textContent = activeHostname || 'Unknown Site';
      }

      // Read directly from storage.local
      const state = await chrome.storage.local.get([
        'lockedDomains',
        'duressAction',
        'isMasterDefault',
        'unlockedDomainsMap',
        'decoyActiveDomains',
        'lastDecoyRedirect'
      ]);

      const lockedDomains = state.lockedDomains || [
        'instagram.com',
        'web.whatsapp.com',
        'x.com',
        'twitter.com',
        'reddit.com',
        'discord.com'
      ];
      const unlockedMap = state.unlockedDomainsMap || {};
      const isDefaultPin = state.isMasterDefault;
      const decoyMap = state.decoyActiveDomains || {};
      const lastRedirect = state.lastDecoyRedirect || null;

      // Show/hide default PIN alert
      defaultPinBanner.style.display = isDefaultPin ? 'flex' : 'none';

      // Update protected count & duress label
      protectedCountDesc.textContent = `${lockedDomains.length} website${lockedDomains.length === 1 ? '' : 's'} protected`;
      duressModeLabel.textContent = state.duressAction === 'redirect' ? 'Redirect Mode' : 'Error Screen';

      if (!isSpecialPage && activeHostname) {
        protectToggle.disabled = false;
        const isProtected = lockedDomains.some(d => {
          const norm = d.toLowerCase().replace(/^www\./, '');
          return activeHostname === norm || activeHostname.endsWith('.' + norm);
        });

        protectToggle.checked = isProtected;

        const isDecoyActive = Boolean(decoyMap[activeHostname] && decoyMap[activeHostname] > Date.now());
        const isRecentDecoyRedirect = Boolean(
          lastRedirect && 
          lastRedirect.originalDomain && 
          (Date.now() - lastRedirect.timestamp < 15 * 60 * 1000) &&
          activeHostname !== lastRedirect.originalDomain
        );

        if (isDecoyActive) {
          statusDot.className = 'status-dot warning';
          statusText.textContent = 'Decoy Lock Active';
          lockThisSiteBtn.style.display = 'none';
          disarmDecoyBtn.style.display = 'inline-block';
          disarmDecoyBtn.textContent = 'Disarm Decoy';
          disarmDecoyBtn.dataset.originalDomain = activeHostname;
        } else if (isRecentDecoyRedirect) {
          statusDot.className = 'status-dot warning';
          statusText.textContent = `Decoy (${lastRedirect.originalDomain})`;
          lockThisSiteBtn.style.display = 'none';
          disarmDecoyBtn.style.display = 'inline-block';
          disarmDecoyBtn.textContent = 'Disarm & Return';
          disarmDecoyBtn.dataset.originalDomain = lastRedirect.originalDomain;
        } else if (isProtected) {
          disarmDecoyBtn.style.display = 'none';
          const isUnlocked = unlockedMap[activeHostname] && unlockedMap[activeHostname] > Date.now();
          if (isUnlocked) {
            statusDot.className = 'status-dot unlocked';
            statusText.textContent = '15m Session Active';
            lockThisSiteBtn.style.display = 'inline-block';
          } else {
            statusDot.className = 'status-dot active';
            statusText.textContent = 'Locked with PIN';
            lockThisSiteBtn.style.display = 'none';
          }
        } else {
          disarmDecoyBtn.style.display = 'none';
          statusDot.className = 'status-dot';
          statusText.textContent = 'Not protected';
          lockThisSiteBtn.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('Failed to load popup state:', err);
    }
  }

  // Toggle protection for active site
  protectToggle.addEventListener('change', async () => {
    if (!activeHostname) return;
    try {
      protectToggle.disabled = true;
      const res = await chrome.runtime.sendMessage({
        type: 'TOGGLE_DOMAIN_PROTECTION',
        domain: activeHostname
      });

      if (res && res.success) {
        if (res.isNowProtected && currentTab && currentTab.id) {
          chrome.tabs.reload(currentTab.id);
        }
      }
      await refreshUI();
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      protectToggle.disabled = false;
    }
  });

  // Lock this tab now
  lockThisSiteBtn.addEventListener('click', async () => {
    if (!activeHostname) return;
    const { unlockedDomainsMap = {} } = await chrome.storage.local.get('unlockedDomainsMap');
    delete unlockedDomainsMap[activeHostname];
    await chrome.storage.local.set({ unlockedDomainsMap });

    await chrome.runtime.sendMessage({
      type: 'LOCK_DOMAIN_NOW',
      domain: activeHostname
    });
    if (currentTab && currentTab.id) {
      chrome.tabs.reload(currentTab.id);
    }
    await refreshUI();
  });

  // Lock all active tabs now
  lockAllBtn.addEventListener('click', async () => {
    lockAllBtn.style.opacity = '0.6';
    await chrome.storage.local.set({ unlockedDomainsMap: {} });
    await chrome.runtime.sendMessage({ type: 'LOCK_ALL_NOW' });
    if (currentTab && currentTab.id && protectToggle.checked) {
      chrome.tabs.reload(currentTab.id);
    }
    await refreshUI();
    lockAllBtn.style.opacity = '1';
  });

  // Disarm decoy lock for this site or return from decoy
  if (disarmDecoyBtn) {
    disarmDecoyBtn.addEventListener('click', async () => {
      const targetDomain = disarmDecoyBtn.dataset.originalDomain || activeHostname;
      if (!targetDomain) return;

      try {
        disarmDecoyBtn.disabled = true;
        disarmDecoyBtn.textContent = 'Disarming...';

        await chrome.runtime.sendMessage({
          type: 'DISARM_DECOY',
          domain: targetDomain
        });

        if (currentTab && currentTab.id) {
          if (activeHostname === targetDomain) {
            chrome.tabs.reload(currentTab.id);
          } else {
            // Jump back to the protected site with secret hash
            chrome.tabs.update(currentTab.id, { url: `https://${targetDomain}#unlock` });
          }
        }
        setTimeout(() => {
          window.close();
        }, 350);
      } catch (err) {
        console.error('Failed to disarm decoy:', err);
        disarmDecoyBtn.disabled = false;
        disarmDecoyBtn.textContent = 'Disarm Decoy';
      }
    });
  }

  await refreshUI();
});

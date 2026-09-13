/**
 * SiteLock Guard - Background Service Worker (Manifest V3)
 * Manages PIN cryptographic verification, domain blocklist, session state, and duress triggers.
 */

const DEFAULT_LOCKED_DOMAINS = [
  'instagram.com',
  'web.whatsapp.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'discord.com'
];

const DEFAULT_MASTER_PIN = '282006';
const DEFAULT_DURESS_PIN = '0000';

// Cryptographic Utilities
async function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPinWithSalt(pin, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${pin.trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(digest);
}

function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Domain normalization
function normalizeDomain(urlOrDomain) {
  try {
    let hostname = urlOrDomain;
    if (urlOrDomain.includes('://')) {
      hostname = new URL(urlOrDomain).hostname;
    }
    hostname = hostname.toLowerCase().trim();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch {
    return urlOrDomain.toLowerCase().trim();
  }
}

function isDomainMatch(targetUrl, domainList) {
  const targetHost = normalizeDomain(targetUrl);
  return domainList.some(domain => {
    const norm = normalizeDomain(domain);
    return targetHost === norm || targetHost.endsWith('.' + norm);
  });
}

// Installation & Initialization
chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await chrome.storage.local.get([
    'salt',
    'masterPinHash',
    'duressPinHash',
    'lockedDomains',
    'duressAction',
    'decoyUrl',
    'decoyErrorCode',
    'sessionTimeout',
    'auditLogs',
    'sitePins'
  ]);

  const updates = {};

  if (!data.salt) {
    const salt = generateSalt();
    updates.salt = salt;
    updates.masterPinHash = await hashPinWithSalt(DEFAULT_MASTER_PIN, salt);
    updates.duressPinHash = await hashPinWithSalt(DEFAULT_DURESS_PIN, salt);
    updates.isMasterDefault = true;
  } else {
    // If user is currently using the old default (1234) or isMasterDefault is true, migrate to 282006
    const oldDefaultHash = await hashPinWithSalt('1234', data.salt);
    if (data.isMasterDefault || data.masterPinHash === oldDefaultHash) {
      updates.masterPinHash = await hashPinWithSalt(DEFAULT_MASTER_PIN, data.salt);
      updates.isMasterDefault = true;
    }
  }

  if (!data.sitePins) {
    updates.sitePins = {};
  }

  if (!data.lockedDomains) {
    updates.lockedDomains = DEFAULT_LOCKED_DOMAINS;
  }

  if (!data.duressAction) {
    updates.duressAction = 'error_screen';
  }

  if (!data.decoyUrl) {
    updates.decoyUrl = 'https://www.google.com';
  }

  if (!data.decoyErrorCode) {
    updates.decoyErrorCode = 'ERR_CONNECTION_REFUSED';
  }

  // Boss / Panic Hotkey Defaults
  if (data.bossKeyEnabled === undefined) {
    updates.bossKeyEnabled = true;
  }
  if (!data.bossKey) {
    updates.bossKey = 'F3';
  }
  if (!data.bossRedirectUrl) {
    updates.bossRedirectUrl = 'https://www.youtube.com';
  }
  if (!data.bossAction) {
    updates.bossAction = 'redirect';
  }

  // Intruder Punishment Video Trap Defaults
  if (data.intruderVideoEnabled === undefined) {
    updates.intruderVideoEnabled = true;
  }
  if (!data.intruderVideoUrl) {
    updates.intruderVideoUrl = 'https://www.youtube.com/watch?v=1CouGcNKICc';
  }
  if (!data.intruderMaxAttempts) {
    updates.intruderMaxAttempts = 4;
  }

  // Always clear any stale unlock tokens on install/update to ensure clean refresh-locking
  updates.unlockedDomainsMap = {};
  updates.sessionTimeout = 'refresh';

  if (!data.auditLogs) {
    updates.auditLogs = [
      {
        id: crypto.randomUUID(),
        type: 'installed',
        details: 'SiteLock Guard successfully initialized',
        timestamp: Date.now()
      }
    ];
  }

  await chrome.storage.local.set(updates);

  if (chrome.storage.session) {
    await chrome.storage.session.set({
      unlockedDomains: {},
      decoyActiveDomains: {}
    });
  }
});

// Ensure default PIN is migrated to 282006 on service worker startup
async function ensureDefaultPinMigrated() {
  try {
    const data = await chrome.storage.local.get(['salt', 'masterPinHash', 'isMasterDefault']);
    if (data.salt) {
      const oldHash = await hashPinWithSalt('1234', data.salt);
      if (data.isMasterDefault || data.masterPinHash === oldHash) {
        const newHash = await hashPinWithSalt(DEFAULT_MASTER_PIN, data.salt);
        await chrome.storage.local.set({
          masterPinHash: newHash,
          isMasterDefault: true
        });
      }
    }
  } catch {}
}
ensureDefaultPinMigrated();

// Helper to log security events (limited to last 50 events)
async function recordAudit(type, details) {
  try {
    const { auditLogs = [] } = await chrome.storage.local.get('auditLogs');
    const newLog = {
      id: crypto.randomUUID(),
      type,
      details,
      timestamp: Date.now()
    };
    const updated = [newLog, ...auditLogs].slice(0, 50);
    await chrome.storage.local.set({ auditLogs: updated });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

// Message Listener (MV3)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { type } = message;

      if (type === 'CHECK_LOCK_STATUS') {
        const url = message.url || (sender.tab && sender.tab.url);
        if (!url || url.startsWith('chrome') || url.startsWith('about:') || url.startsWith('chrome-extension:')) {
          sendResponse({ locked: false });
          return;
        }

        const normDomain = normalizeDomain(url);
        const {
          lockedDomains = DEFAULT_LOCKED_DOMAINS,
          duressAction = 'error_screen',
          decoyUrl = 'https://www.google.com',
          decoyErrorCode = 'ERR_CONNECTION_REFUSED',
          unlockedDomainsMap = {},
          decoyActiveDomains = {},
          bossKeyEnabled = true,
          bossKey = 'F3',
          bossRedirectUrl = 'https://www.youtube.com',
          bossAction = 'redirect',
          intruderVideoEnabled = true,
          intruderVideoUrl = 'https://www.youtube.com/watch?v=1CouGcNKICc',
          intruderMaxAttempts = 4
        } = await chrome.storage.local.get([
          'lockedDomains',
          'duressAction',
          'decoyUrl',
          'decoyErrorCode',
          'unlockedDomainsMap',
          'decoyActiveDomains',
          'bossKeyEnabled',
          'bossKey',
          'bossRedirectUrl',
          'bossAction',
          'intruderVideoEnabled',
          'intruderVideoUrl',
          'intruderMaxAttempts'
        ]);

        const bossConfig = {
          enabled: bossKeyEnabled,
          key: bossKey,
          redirectUrl: bossRedirectUrl,
          action: bossAction
        };

        const intruderConfig = {
          enabled: intruderVideoEnabled,
          url: intruderVideoUrl,
          maxAttempts: intruderMaxAttempts
        };

        const isLocked = isDomainMatch(normDomain, lockedDomains);
        if (!isLocked) {
          sendResponse({ locked: false, bossConfig, intruderConfig });
          return;
        }

        const now = Date.now();

        // Check if decoy lockout is active
        if (decoyActiveDomains[normDomain] && decoyActiveDomains[normDomain] > now) {
          sendResponse({
            locked: true,
            isDecoyActive: true,
            domain: normDomain,
            duressAction,
            decoyUrl,
            decoyErrorCode,
            bossConfig,
            intruderConfig
          });
          return;
        }

        // Check if unlocked in active 15m session
        if (unlockedDomainsMap[normDomain] && unlockedDomainsMap[normDomain] > now) {
          sendResponse({
            locked: false,
            isUnlocked: true,
            domain: normDomain,
            bossConfig,
            intruderConfig
          });
          return;
        }

        // Locked and requires PIN
        sendResponse({
          locked: true,
          isDecoyActive: false,
          domain: normDomain,
          duressAction,
          decoyUrl,
          decoyErrorCode,
          bossConfig,
          intruderConfig
        });
        return;
      }

      if (type === 'VERIFY_PIN') {
        const { pin, domain, stayUnlockedFor15m } = message;
        const normDomain = normalizeDomain(domain);

        const {
          salt,
          masterPinHash,
          duressPinHash,
          sitePins = {},
          duressAction = 'error_screen',
          decoyUrl = 'https://www.google.com',
          decoyErrorCode = 'ERR_CONNECTION_REFUSED',
          unlockedDomainsMap = {},
          decoyActiveDomains = {}
        } = await chrome.storage.local.get([
          'salt',
          'masterPinHash',
          'duressPinHash',
          'sitePins',
          'duressAction',
          'decoyUrl',
          'decoyErrorCode',
          'unlockedDomainsMap',
          'decoyActiveDomains'
        ]);

        const inputHash = await hashPinWithSalt(pin, salt);

        // 1. Check Site-Specific Custom PIN first
        const sitePinHash = sitePins[normDomain];
        if (sitePinHash && inputHash === sitePinHash) {
          if (stayUnlockedFor15m) {
            unlockedDomainsMap[normDomain] = Date.now() + 15 * 60 * 1000;
          } else {
            delete unlockedDomainsMap[normDomain];
          }
          delete decoyActiveDomains[normDomain];
          await chrome.storage.local.set({ unlockedDomainsMap, decoyActiveDomains, lastDecoyRedirect: null });

          await recordAudit('site_unlock', `Unlocked ${normDomain} with site-specific PIN (${stayUnlockedFor15m ? '15m session' : 'locks on reload'})`);
          sendResponse({ success: true, isMaster: true, isSitePin: true, domain: normDomain });
          return;
        }

        // 2. Check Master PIN (universal admin fallback)
        if (inputHash === masterPinHash) {
          if (stayUnlockedFor15m) {
            unlockedDomainsMap[normDomain] = Date.now() + 15 * 60 * 1000;
          } else {
            delete unlockedDomainsMap[normDomain];
          }
          delete decoyActiveDomains[normDomain];
          await chrome.storage.local.set({ unlockedDomainsMap, decoyActiveDomains, lastDecoyRedirect: null });

          await recordAudit('master_unlock', `Unlocked ${normDomain} with Master PIN (${stayUnlockedFor15m ? '15m session' : 'locks on reload'})`);
          sendResponse({ success: true, isMaster: true, domain: normDomain });
          return;
        }

        // 3. Check Duress PIN
        if (inputHash === duressPinHash) {
          decoyActiveDomains[normDomain] = Date.now() + 10 * 60 * 1000;
          await chrome.storage.local.set({ decoyActiveDomains });

          await recordAudit('duress_trigger', `Duress / Decoy PIN entered on ${normDomain}`);
          sendResponse({
            success: true,
            isDuress: true,
            duressAction,
            decoyUrl,
            decoyErrorCode,
            domain: normDomain
          });
          return;
        }

        // Invalid PIN
        await recordAudit('failed_attempt', `Failed PIN attempt on ${normDomain}`);
        sendResponse({ success: false, error: 'Incorrect Passcode' });
        return;
      }

      // Verify Admin access via Master PIN
      if (type === 'VERIFY_ADMIN_PIN') {
        const { pin } = message;
        const { salt, masterPinHash } = await chrome.storage.local.get(['salt', 'masterPinHash']);
        const inputHash = await hashPinWithSalt(pin, salt);

        if (inputHash === masterPinHash) {
          sendResponse({ success: true, authorized: true });
        } else {
          sendResponse({ success: false, error: 'Incorrect Master PIN' });
        }
        return;
      }

      if (type === 'DISARM_DECOY') {
        const norm = normalizeDomain(message.domain);
        const { decoyActiveDomains = {} } = await chrome.storage.local.get('decoyActiveDomains');
        delete decoyActiveDomains[norm];
        await chrome.storage.local.set({ decoyActiveDomains, lastDecoyRedirect: null });
        await recordAudit('decoy_disarmed', `Decoy lockout stealthily disarmed for ${norm}`);
        sendResponse({ success: true, domain: norm });
        return;
      }

      if (type === 'DISARM_ALL_DECOYS') {
        await chrome.storage.local.set({ decoyActiveDomains: {}, lastDecoyRedirect: null });
        await recordAudit('decoy_disarmed_all', 'All active decoy lockouts disarmed');
        sendResponse({ success: true });
        return;
      }

      if (type === 'SET_SITE_PIN') {
        const { domain, pin } = message;
        const norm = normalizeDomain(domain);
        const { salt, sitePins = {} } = await chrome.storage.local.get(['salt', 'sitePins']);
        const hashed = await hashPinWithSalt(pin, salt);
        sitePins[norm] = hashed;
        await chrome.storage.local.set({ sitePins });
        await recordAudit('site_pin_set', `Custom PIN configured for ${norm}`);
        sendResponse({ success: true, domain: norm });
        return;
      }

      if (type === 'REMOVE_SITE_PIN') {
        const { domain } = message;
        const norm = normalizeDomain(domain);
        const { sitePins = {} } = await chrome.storage.local.get('sitePins');
        delete sitePins[norm];
        await chrome.storage.local.set({ sitePins });
        await recordAudit('site_pin_removed', `Custom PIN removed for ${norm}, reverted to Master PIN`);
        sendResponse({ success: true, domain: norm });
        return;
      }

      if (type === 'LOCK_ALL_NOW') {
        await chrome.storage.local.set({ unlockedDomainsMap: {} });
        if (chrome.storage.session) {
          await chrome.storage.session.set({ unlockedDomains: {} });
        }
        await recordAudit('lock_all', 'All unlocked sessions locked immediately');
        sendResponse({ success: true });
        return;
      }

      if (type === 'LOCK_DOMAIN_NOW') {
        const norm = normalizeDomain(message.domain);
        const { unlockedDomainsMap = {} } = await chrome.storage.local.get('unlockedDomainsMap');
        delete unlockedDomainsMap[norm];
        await chrome.storage.local.set({ unlockedDomainsMap });

        if (chrome.storage.session) {
          const { unlockedDomains = {} } = await chrome.storage.session.get('unlockedDomains');
          delete unlockedDomains[norm];
          await chrome.storage.session.set({ unlockedDomains });
        }

        await recordAudit('lock_domain', `Locked ${norm}`);
        sendResponse({ success: true });
        return;
      }

      if (type === 'TOGGLE_DOMAIN_PROTECTION') {
        const norm = normalizeDomain(message.domain);
        const { lockedDomains = [], sitePins = {} } = await chrome.storage.local.get(['lockedDomains', 'sitePins']);
        let updated;
        let isNowProtected;

        if (lockedDomains.includes(norm)) {
          updated = lockedDomains.filter(d => d !== norm);
          delete sitePins[norm];
          await chrome.storage.local.set({ lockedDomains: updated, sitePins });
          isNowProtected = false;
        } else {
          updated = [...lockedDomains, norm];
          isNowProtected = true;
          await chrome.storage.local.set({ lockedDomains: updated });
        }

        await recordAudit('domain_toggle', `${isNowProtected ? 'Protected' : 'Unprotected'} ${norm}`);
        sendResponse({ success: true, isNowProtected, lockedDomains: updated });
        return;
      }

      if (type === 'TRIGGER_BOSS_KEY') {
        const norm = normalizeDomain(message.domain || (sender.tab && sender.tab.url));
        const {
          unlockedDomainsMap = {},
          bossRedirectUrl = 'https://www.youtube.com',
          bossAction = 'redirect'
        } = await chrome.storage.local.get(['unlockedDomainsMap', 'bossRedirectUrl', 'bossAction']);

        // Immediately revoke session unlock token so site re-locks
        if (norm && unlockedDomainsMap[norm]) {
          delete unlockedDomainsMap[norm];
          await chrome.storage.local.set({ unlockedDomainsMap });
        }

        if (chrome.storage.session) {
          const { unlockedDomains = {} } = await chrome.storage.session.get('unlockedDomains');
          if (norm && unlockedDomains[norm]) {
            delete unlockedDomains[norm];
            await chrome.storage.session.set({ unlockedDomains });
          }
        }

        await recordAudit('boss_key', `Panic Boss Key triggered on ${norm} -> ${bossAction === 'close_tab' ? 'Closed Tab' : bossRedirectUrl}`);
        sendResponse({
          success: true,
          action: bossAction,
          redirectUrl: bossRedirectUrl
        });
        return;
      }

      if (type === 'GET_EXTENSION_STATE') {
        const local = await chrome.storage.local.get([
          'lockedDomains',
          'duressAction',
          'decoyUrl',
          'decoyErrorCode',
          'sessionTimeout',
          'isMasterDefault',
          'unlockedDomainsMap',
          'decoyActiveDomains',
          'sitePins',
          'bossKeyEnabled',
          'bossKey',
          'bossRedirectUrl',
          'bossAction',
          'intruderVideoEnabled',
          'intruderVideoUrl',
          'intruderMaxAttempts'
        ]);
        sendResponse({
          ...local,
          unlockedDomains: local.unlockedDomainsMap || {},
          decoyActiveDomains: local.decoyActiveDomains || {},
          sitePins: local.sitePins || {},
          bossKeyEnabled: local.bossKeyEnabled !== undefined ? local.bossKeyEnabled : true,
          bossKey: local.bossKey || 'F3',
          bossRedirectUrl: local.bossRedirectUrl || 'https://www.youtube.com',
          bossAction: local.bossAction || 'redirect',
          intruderVideoEnabled: local.intruderVideoEnabled !== undefined ? local.intruderVideoEnabled : true,
          intruderVideoUrl: local.intruderVideoUrl || 'https://www.youtube.com/watch?v=1CouGcNKICc',
          intruderMaxAttempts: local.intruderMaxAttempts || 4
        });
        return;
      }

      if (type === 'RECORD_AUDIT') {
        const { auditType = 'info', details = '' } = message;
        await recordAudit(auditType, details);
        sendResponse({ success: true });
        return;
      }

      if (type === 'UPDATE_PINS') {
        const { currentMasterPin, newMasterPin, newDuressPin } = message;
        const { salt, masterPinHash } = await chrome.storage.local.get(['salt', 'masterPinHash']);

        const currHash = await hashPinWithSalt(currentMasterPin, salt);
        if (currHash !== masterPinHash) {
          sendResponse({ success: false, error: 'Current Master PIN is incorrect' });
          return;
        }

        const updates = {};
        if (newMasterPin) {
          updates.masterPinHash = await hashPinWithSalt(newMasterPin, salt);
          updates.isMasterDefault = false;
        }
        if (newDuressPin) {
          updates.duressPinHash = await hashPinWithSalt(newDuressPin, salt);
        }

        await chrome.storage.local.set(updates);
        await recordAudit('pins_updated', 'Master and/or Duress PIN successfully updated');
        sendResponse({ success: true });
        return;
      }

      if (type === 'UPDATE_SETTINGS') {
        const {
          duressAction,
          decoyUrl,
          decoyErrorCode,
          sessionTimeout,
          lockedDomains,
          bossKeyEnabled,
          bossKey,
          bossRedirectUrl,
          bossAction,
          intruderVideoEnabled,
          intruderVideoUrl,
          intruderMaxAttempts
        } = message;

        const updates = {};
        if (duressAction !== undefined) updates.duressAction = duressAction;
        if (decoyUrl !== undefined) updates.decoyUrl = decoyUrl;
        if (decoyErrorCode !== undefined) updates.decoyErrorCode = decoyErrorCode;
        if (sessionTimeout !== undefined) updates.sessionTimeout = sessionTimeout;
        if (lockedDomains !== undefined) updates.lockedDomains = lockedDomains;
        if (bossKeyEnabled !== undefined) updates.bossKeyEnabled = bossKeyEnabled;
        if (bossKey !== undefined) updates.bossKey = bossKey;
        if (bossRedirectUrl !== undefined) updates.bossRedirectUrl = bossRedirectUrl;
        if (bossAction !== undefined) updates.bossAction = bossAction;
        if (intruderVideoEnabled !== undefined) updates.intruderVideoEnabled = intruderVideoEnabled;
        if (intruderVideoUrl !== undefined) updates.intruderVideoUrl = intruderVideoUrl;
        if (intruderMaxAttempts !== undefined) updates.intruderMaxAttempts = intruderMaxAttempts;

        await chrome.storage.local.set(updates);
        await recordAudit('settings_updated', 'Settings updated');
        sendResponse({ success: true });
        return;
      }

      if (type === 'GET_AUDIT_LOGS') {
        const { auditLogs = [] } = await chrome.storage.local.get('auditLogs');
        sendResponse({ success: true, logs: auditLogs });
        return;
      }

      if (type === 'CLEAR_AUDIT_LOGS') {
        await chrome.storage.local.set({ auditLogs: [] });
        sendResponse({ success: true });
        return;
      }

      if (type === 'OPEN_OPTIONS_PAGE') {
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
        }
        sendResponse({ success: true });
        return;
      }

      if (type === 'ENTER_FULLSCREEN') {
        if (sender.tab && sender.tab.windowId) {
          try {
            await chrome.windows.update(sender.tab.windowId, { state: 'fullscreen' });
          } catch (err) {
            console.warn('Fullscreen window update error:', err);
          }
        }
        sendResponse({ success: true });
        return;
      }

      if (type === 'EXIT_FULLSCREEN') {
        if (sender.tab && sender.tab.windowId) {
          try {
            await chrome.windows.update(sender.tab.windowId, { state: 'normal' });
          } catch (err) {
            console.warn('Normal window update error:', err);
          }
        }
        sendResponse({ success: true });
        return;
      }

      sendResponse({ success: false, error: 'Unknown message type' });
    } catch (err) {
      console.error('Service worker message handling error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

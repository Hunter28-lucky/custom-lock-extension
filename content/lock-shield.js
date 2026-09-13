/**
 * SiteLock Guard - Content Script (Lock Shield)
 * Runs at document_start. Isolates protected pages via closed Shadow DOM.
 * Features:
 * - Direct local storage reading for 100% reliable, zero-latency locking on Brave/macOS
 * - Guaranteed lock on every page refresh (Cmd+R / F5) and tab reopen
 * - Dual-layer PIN verification (local Web Crypto fallback if service worker is sleeping)
 * - Stealth Admin Mode: Completely hidden from normal users; opened via triple-clicking lock emblem or pressing Shift+A
 * - Interactive Mouse Aurora & Radiant Unlock Shockwave
 * - Floating quick-relock button after unlock
 */

(function () {
  // Only protect top-level browsing contexts, ignore embedded iframes
  if (window !== window.top) return;

  const DEFAULT_LOCKED_DOMAINS = [
    'instagram.com',
    'web.whatsapp.com',
    'x.com',
    'twitter.com',
    'reddit.com',
    'discord.com'
  ];

  // 1. Instant pre-hide style to prevent any frame of content leaking
  const preHideStyle = document.createElement('style');
  preHideStyle.id = '__sitelock_prehide__';
  preHideStyle.textContent = `
    html[data-sitelock-checking="true"] body,
    html[data-sitelock-checking="true"] > *:not(#__sitelock_host__):not(#__sitelock_intruder_trap__) {
      visibility: hidden !important;
    }
    html[data-sitelock-active="true"] body,
    html[data-sitelock-active="true"] > *:not(#__sitelock_host__):not(#__sitelock_intruder_trap__) {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    #__sitelock_host__ {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483646 !important;
      pointer-events: auto !important;
      background: #060911 !important;
    }
    #__sitelock_intruder_trap__ {
      display: flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      background: #000 !important;
    }
  `;

  function attachPreHide() {
    const target = document.head || document.documentElement || document.body;
    if (target && !document.getElementById('__sitelock_prehide__')) {
      target.appendChild(preHideStyle);
    }
    if (document.documentElement) {
      document.documentElement.setAttribute('data-sitelock-checking', 'true');
    }
  }

  function cleanupPreHide() {
    if (document.documentElement) {
      document.documentElement.removeAttribute('data-sitelock-checking');
    }
    const el = document.getElementById('__sitelock_prehide__');
    if (el) el.remove();
  }

  attachPreHide();
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', attachPreHide, { once: true });
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

  function isDomainMatch(targetHost, domainList) {
    const normTarget = normalizeDomain(targetHost);
    return domainList.some(domain => {
      const norm = normalizeDomain(domain);
      return normTarget === norm || normTarget.endsWith('.' + norm);
    });
  }

  async function hashPinWithSalt(pin, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(`${salt}:${pin.trim()}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 2. Main Lock Verification Function
  async function checkAndLock() {
    try {
      const normHost = normalizeDomain(window.location.hostname);

      // Read directly from storage.local (immune to service worker suspension in Brave)
      const data = await chrome.storage.local.get([
        'lockedDomains',
        'salt',
        'masterPinHash',
        'duressPinHash',
        'sitePins',
        'duressAction',
        'decoyUrl',
        'decoyErrorCode',
        'unlockedDomainsMap',
        'decoyActiveDomains',
        'bossKeyEnabled',
        'bossKey',
        'bossAction',
        'bossRedirectUrl',
        'intruderVideoEnabled',
        'intruderVideoUrl',
        'intruderMaxAttempts'
      ]);

      const lockedDomains = data.lockedDomains || DEFAULT_LOCKED_DOMAINS;
      const isLocked = isDomainMatch(normHost, lockedDomains);

      if (!isLocked) {
        cleanupPreHide();
        // If user was previously redirected to an external decoy site (e.g. Google),
        // enable stealth hotkey (Shift+Esc or Cmd+Shift+L) to return and unlock
        attachExternalDecoyEscape();
        return;
      }

      // Attach Boss / Panic Hotkey handler (F3 by default) for this protected domain
      attachBossKeyHandler(normHost, data);

      // Check if owner is using the secret stealth bypass in URL (#unlock, ?unlock, #admin, #pin, #sitelock)
      const isStealthBypass = 
        window.location.hash.includes('unlock') || 
        window.location.search.includes('unlock') || 
        window.location.hash.includes('admin') || 
        window.location.hash.includes('pin') || 
        window.location.hash.includes('sitelock');

      const decoyActiveDomains = data.decoyActiveDomains || {};

      if (isStealthBypass) {
        // Disarm decoy mode immediately!
        delete decoyActiveDomains[normHost];
        await chrome.storage.local.set({ decoyActiveDomains, lastDecoyRedirect: null });
        await chrome.runtime.sendMessage({ type: 'DISARM_DECOY', domain: normHost });

        // Clean up hash silently from URL bar so it doesn't linger visually
        try {
          history.replaceState(null, '', window.location.pathname);
        } catch {}
      } else if (decoyActiveDomains[normHost] && decoyActiveDomains[normHost] > Date.now()) {
        // Remember origin domain in case we redirect externally
        await chrome.storage.local.set({
          lastDecoyRedirect: { domain: normHost, timestamp: Date.now() }
        });

        triggerDecoyMode(
          data.duressAction || 'error_screen',
          data.decoyUrl,
          data.decoyErrorCode,
          normHost,
          {
            domain: normHost,
            salt: data.salt,
            masterPinHash: data.masterPinHash,
            duressPinHash: data.duressPinHash,
            sitePins: data.sitePins || {},
            duressAction: data.duressAction || 'error_screen',
            decoyUrl: data.decoyUrl || 'https://www.google.com',
            decoyErrorCode: data.decoyErrorCode || 'ERR_CONNECTION_REFUSED'
          }
        );
        return;
      }

      // Check if unlocked via explicit 15m session
      const unlockedMap = data.unlockedDomainsMap || {};
      if (unlockedMap[normHost] && unlockedMap[normHost] > Date.now()) {
        cleanupPreHide();
        attachUniversalLogoLockTrigger(normHost);
        return;
      }

      // LOCKED: Render Lock Shield immediately!
      initLockScreen({
        domain: normHost,
        salt: data.salt,
        masterPinHash: data.masterPinHash,
        duressPinHash: data.duressPinHash,
        sitePins: data.sitePins || {},
        duressAction: data.duressAction || 'error_screen',
        decoyUrl: data.decoyUrl || 'https://www.google.com',
        decoyErrorCode: data.decoyErrorCode || 'ERR_CONNECTION_REFUSED',
        intruderVideoEnabled: data.intruderVideoEnabled !== undefined ? data.intruderVideoEnabled : true,
        intruderVideoUrl: data.intruderVideoUrl || 'https://www.youtube.com/watch?v=1CouGcNKICc',
        intruderMaxAttempts: data.intruderMaxAttempts || 4
      });
    } catch (err) {
      console.error('SiteLock Guard check error:', err);
      // If error reading storage, default to locked if matching popular sensitive apps
      const host = normalizeDomain(window.location.hostname);
      if (isDomainMatch(host, DEFAULT_LOCKED_DOMAINS)) {
        initLockScreen({ domain: host });
      } else {
        cleanupPreHide();
      }
    }
  }

  // Stealth escape when sitting on an external decoy site (e.g. Google.com after redirect)
  async function attachExternalDecoyEscape() {
    try {
      const { lastDecoyRedirect } = await chrome.storage.local.get('lastDecoyRedirect');
      if (!lastDecoyRedirect || !lastDecoyRedirect.domain) return;
      if (Date.now() - lastDecoyRedirect.timestamp > 15 * 60 * 1000) return;

      const onExternalKey = async (e) => {
        // Shift+Esc OR Cmd/Ctrl+Shift+L to teleport back to the locked site and show the lock screen
        const isTrigger = (e.shiftKey && e.key === 'Escape') || ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'L' || e.key === 'l'));
        if (isTrigger) {
          e.preventDefault();
          window.removeEventListener('keydown', onExternalKey, true);

          const targetDomain = lastDecoyRedirect.domain;
          await chrome.runtime.sendMessage({ type: 'DISARM_DECOY', domain: targetDomain });
          await chrome.storage.local.set({ lastDecoyRedirect: null });

          window.location.href = `https://${targetDomain}#unlock`;
        }
      };

      window.addEventListener('keydown', onExternalKey, true);
    } catch {}
  }

  // Run check immediately
  checkAndLock();

  // Re-check when restored from Back-Forward Cache (bfcache)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      attachPreHide();
      checkAndLock();
    }
  });

  function initLockScreen(config) {
    if (document.documentElement) {
      document.documentElement.setAttribute('data-sitelock-active', 'true');
      document.documentElement.removeAttribute('data-sitelock-checking');
    }

    try {
      document.querySelectorAll('video, audio').forEach((media) => {
        media.pause();
        media.muted = true;
      });
    } catch {}

    let host = document.getElementById('__sitelock_host__');
    if (!host) {
      host = document.createElement('div');
      host.id = '__sitelock_host__';
      (document.documentElement || document.body).appendChild(host);
    }

    // Attach closed Shadow DOM for absolute styling isolation
    const shadow = host.attachShadow({ mode: 'closed' });
    renderShieldUI(shadow, host, config);
  }

  function triggerDecoyMode(action, decoyUrl, errorCode, domain, config = {}) {
    if (action === 'redirect' && decoyUrl) {
      window.location.replace(decoyUrl);
      return;
    }
    if (action === 'close_tab') {
      window.location.replace('about:blank');
      return;
    }

    if (document.documentElement) {
      document.documentElement.setAttribute('data-sitelock-active', 'true');
      document.documentElement.removeAttribute('data-sitelock-checking');
    }

    let host = document.getElementById('__sitelock_host__');
    if (!host) {
      host = document.createElement('div');
      host.id = '__sitelock_host__';
      (document.documentElement || document.body).appendChild(host);
    }

    const shadow = host.attachShadow({ mode: 'closed' });
    renderDecoyErrorPage(shadow, host, domain || window.location.hostname, errorCode || 'ERR_CONNECTION_REFUSED', config);
  }

  /**
   * Panic / Boss Hotkey (F3 by default)
   * Instantly blanks the screen, revokes unlock token, and redirects to YouTube (or custom site).
   */
  let bossKeyBound = false;
  function attachBossKeyHandler(domain, data) {
    if (bossKeyBound) return;
    bossKeyBound = true;

    const bossEnabled = data.bossKeyEnabled !== undefined ? data.bossKeyEnabled : true;
    if (!bossEnabled) return;

    const targetKey = (data.bossKey || 'F3').toUpperCase();
    const redirectUrl = data.bossRedirectUrl || 'https://www.youtube.com';
    const action = data.bossAction || 'redirect';

    window.addEventListener('keydown', (e) => {
      let matched = false;

      if (targetKey === 'F3' && (e.key === 'F3' || e.code === 'F3')) {
        matched = true;
      } else if (targetKey === 'F2' && (e.key === 'F2' || e.code === 'F2')) {
        matched = true;
      } else if (targetKey === 'ALT+L' && (e.altKey && e.key && e.key.toLowerCase() === 'l')) {
        matched = true;
      } else if (targetKey === 'ESCAPE' && e.key === 'Escape') {
        matched = true;
      } else if (e.key && e.key.toUpperCase() === targetKey) {
        matched = true;
      }

      if (matched) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 1. Immediately blackout the screen so nobody glimpses private content
        try {
          if (document.documentElement) {
            document.documentElement.style.cssText = 'background:#000 !important; visibility:hidden !important;';
          }
        } catch {}

        // 2. Revoke session unlock token in background worker & log audit
        try {
          chrome.runtime.sendMessage({
            type: 'TRIGGER_BOSS_KEY',
            domain: domain
          });
        } catch {}

        // 3. Immediately replace window location (location.replace avoids back-button history)
        if (action === 'close_tab') {
          window.location.replace('about:blank');
          try {
            window.close();
          } catch {}
        } else {
          window.location.replace(redirectUrl);
        }
      }
    }, true);
  }

  /**
   * Universal Brand Logo Lock Integration
   * Supports Instagram, WhatsApp Web, X (Twitter), Reddit, Discord, and any protected site.
   * Clicking the logo provides an instant, discreet Lock option.
   */
  function attachUniversalLogoLockTrigger(domain) {
    // Remove any legacy floating pill if present
    const oldPill = document.getElementById('__sitelock_relock_pill__');
    if (oldPill) oldPill.remove();

    let attached = false;

    function getSiteBrandName(d) {
      if (!d) return 'Website';
      if (d.includes('instagram.com')) return 'Instagram';
      if (d.includes('whatsapp.com')) return 'WhatsApp';
      if (d.includes('x.com') || d.includes('twitter.com')) return 'X (Twitter)';
      if (d.includes('reddit.com')) return 'Reddit';
      if (d.includes('discord.com')) return 'Discord';
      if (d.includes('youtube.com')) return 'YouTube';
      if (d.includes('facebook.com')) return 'Facebook';
      return d;
    }

    function bindLogo() {
      if (attached) return;

      const candidates = [
        // Instagram
        ...document.querySelectorAll('a[href="/"][role="link"]'),
        ...document.querySelectorAll('svg[aria-label="Instagram"]'),
        ...document.querySelectorAll('a[aria-label="Instagram"]'),
        // WhatsApp Web
        ...document.querySelectorAll('header [role="button"]'),
        ...document.querySelectorAll('div[data-testid="chatlist-header"] img'),
        ...document.querySelectorAll('header img'),
        // X / Twitter
        ...document.querySelectorAll('a[href="/home"][aria-label="X"]'),
        ...document.querySelectorAll('a[href="/home"] svg'),
        ...document.querySelectorAll('h1 a[href="/home"]'),
        ...document.querySelectorAll('a[aria-label="Twitter"]'),
        // Reddit
        ...document.querySelectorAll('a[aria-label="Home"]'),
        ...document.querySelectorAll('svg.reddit-logo'),
        ...document.querySelectorAll('reddit-header-large a'),
        // Discord
        ...document.querySelectorAll('div[aria-label="Direct Messages"]'),
        // Universal standard brand logos:
        ...document.querySelectorAll('header a[href="/"]'),
        ...document.querySelectorAll('nav a[href="/"]'),
        ...document.querySelectorAll('a[href="/"].logo'),
        ...document.querySelectorAll('a[href="/"][class*="logo"]'),
        ...document.querySelectorAll('a[href="/"][class*="brand"]'),
        ...document.querySelectorAll('a[href="/"]')
      ];

      for (const el of candidates) {
        const link = el.closest('a') || el;
        if (link && !link.dataset.sitelockLogoBound) {
          link.dataset.sitelockLogoBound = 'true';
          attached = true;

          const brandName = getSiteBrandName(domain);
          link.setAttribute('title', `${brandName} (SiteLock: Click for Lock Options)`);

          // Subtle emerald security indicator dot on the logo
          if (!link.querySelector('.sitelock-logo-dot')) {
            const currentPosition = window.getComputedStyle(link).position;
            if (currentPosition === 'static') {
              link.style.position = 'relative';
            }
            const dot = document.createElement('span');
            dot.className = 'sitelock-logo-dot';
            dot.style.cssText = `
              position: absolute !important;
              bottom: 4px !important;
              right: 4px !important;
              width: 7px !important;
              height: 7px !important;
              border-radius: 50% !important;
              background: #10b981 !important;
              box-shadow: 0 0 8px #10b981 !important;
              pointer-events: none !important;
              z-index: 9999 !important;
            `;
            link.appendChild(dot);
          }

          // Intercept click on the brand logo
          link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showUniversalLockMenu(link, domain, brandName);
          }, true);

          break;
        }
      }
    }

    bindLogo();

    // Observe mutations to handle SPA navigation / lazy rendering
    const observer = new MutationObserver(() => {
      bindLogo();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Display sleek micro-menu anchored to the brand logo
   */
  function showUniversalLockMenu(anchorEl, domain, brandName) {
    const existing = document.getElementById('__sitelock_universal_menu__');
    if (existing) {
      existing.remove();
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = '__sitelock_universal_menu__';

    // Position next to sidebar or below header
    const topPos = Math.max(12, Math.min(window.innerHeight - 200, rect.top));
    const leftPos = Math.max(16, rect.right > 0 ? rect.right + 12 : 75);

    menu.innerHTML = `
      <style>
        #__sitelock_universal_menu__ {
          position: fixed !important;
          top: ${topPos}px !important;
          left: ${leftPos}px !important;
          z-index: 2147483646 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          width: 220px !important;
          background: rgba(13, 19, 33, 0.95) !important;
          backdrop-filter: blur(24px) !important;
          -webkit-backdrop-filter: blur(24px) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          border-radius: 16px !important;
          padding: 14px !important;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), 0 0 20px rgba(16, 185, 129, 0.15) !important;
          animation: sitelockMenuFade 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          color: #f1f5f9 !important;
          user-select: none !important;
        }
        @keyframes sitelockMenuFade {
          from { opacity: 0; transform: scale(0.94) translateY(-6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .sitelock-menu-header {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          margin-bottom: 10px !important;
          padding-bottom: 8px !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        .sitelock-menu-title {
          font-size: 12px !important;
          font-weight: 700 !important;
          color: #34d399 !important;
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
        }
        .sitelock-menu-title svg {
          width: 14px !important;
          height: 14px !important;
          fill: currentColor !important;
        }
        .sitelock-menu-close {
          background: none !important;
          border: none !important;
          color: #64748b !important;
          cursor: pointer !important;
          font-size: 14px !important;
          padding: 2px !important;
        }
        .sitelock-menu-close:hover {
          color: #f8fafc !important;
        }
        .sitelock-menu-btn {
          width: 100% !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          padding: 9px 12px !important;
          border-radius: 10px !important;
          border: none !important;
          font-size: 12.5px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          margin-bottom: 6px !important;
          transition: all 0.15s ease !important;
        }
        .sitelock-lock-action {
          background: rgba(239, 68, 68, 0.15) !important;
          color: #f87171 !important;
          border: 1px solid rgba(239, 68, 68, 0.3) !important;
        }
        .sitelock-lock-action:hover {
          background: rgba(239, 68, 68, 0.28) !important;
          color: #fca5a5 !important;
          transform: translateY(-1px) !important;
        }
        .sitelock-nav-action {
          background: rgba(255, 255, 255, 0.05) !important;
          color: #cbd5e1 !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        .sitelock-nav-action:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #fff !important;
        }
        .sitelock-admin-action {
          background: transparent !important;
          color: #94a3b8 !important;
          font-size: 11px !important;
          justify-content: center !important;
          margin-bottom: 0 !important;
          padding: 6px !important;
        }
        .sitelock-admin-action:hover {
          color: #34d399 !important;
        }
      </style>
      <div class="sitelock-menu-header">
        <div class="sitelock-menu-title">
          <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
          <span>SiteLock Guard</span>
        </div>
        <button class="sitelock-menu-close" id="sitelockMenuCloseBtn">✕</button>
      </div>
      <button class="sitelock-menu-btn sitelock-lock-action" id="sitelockMenuLockBtn">
        <span>🔒 Lock ${escapeHtml(brandName)} Now</span>
      </button>
      <button class="sitelock-menu-btn sitelock-nav-action" id="sitelockMenuHomeBtn">
        <span>🏠 Go to Home / Feed</span>
      </button>
      <button class="sitelock-menu-btn sitelock-admin-action" id="sitelockMenuAdminBtn">
        <span>⚙ Admin Settings</span>
      </button>
    `;

    document.body.appendChild(menu);

    const closeBtn = menu.querySelector('#sitelockMenuCloseBtn');
    const lockBtn = menu.querySelector('#sitelockMenuLockBtn');
    const homeBtn = menu.querySelector('#sitelockMenuHomeBtn');
    const adminBtn = menu.querySelector('#sitelockMenuAdminBtn');

    const dismissMenu = () => {
      menu.remove();
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onDocKey, true);
    };

    const onDocClick = (e) => {
      if (!menu.contains(e.target) && !anchorEl.contains(e.target)) {
        dismissMenu();
      }
    };

    const onDocKey = (e) => {
      if (e.key === 'Escape') dismissMenu();
    };

    closeBtn.addEventListener('click', dismissMenu);

    lockBtn.addEventListener('click', async () => {
      dismissMenu();
      // Clear 15m session token
      const { unlockedDomainsMap = {} } = await chrome.storage.local.get('unlockedDomainsMap');
      delete unlockedDomainsMap[domain];
      await chrome.storage.local.set({ unlockedDomainsMap });
      await chrome.runtime.sendMessage({ type: 'LOCK_DOMAIN_NOW', domain });

      // Immediately trigger lock screen
      attachPreHide();
      checkAndLock();
    });

    homeBtn.addEventListener('click', () => {
      dismissMenu();
      window.location.href = '/';
    });

    adminBtn.addEventListener('click', () => {
      dismissMenu();
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    });

    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onDocKey, true);
    }, 100);
  }

  function renderShieldUI(shadow, host, config) {
    let currentPin = '';
    let isVerifying = false;
    let failedAttempts = 0;
    let lockoutTimer = null;
    let isPinVisible = false;
    let adminAuthenticated = false;

    let emblemClickCount = 0;
    let emblemClickTimer = null;

    const domainName = config.domain || normalizeDomain(window.location.hostname);

    // Session-persisted attempt tracking so page reloads don't reset intruder attempt counter
    const attemptsKey = `sitelock_attempts_${domainName}`;
    try {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(attemptsKey).then((s) => {
          if (s && typeof s[attemptsKey] === 'number') {
            failedAttempts = s[attemptsKey];
          }
        }).catch(() => {});
      }
    } catch {}

    function recordFailedAttempt() {
      failedAttempts++;
      try {
        if (chrome.storage && chrome.storage.session) {
          chrome.storage.session.set({ [attemptsKey]: failedAttempts }).catch(() => {});
        }
      } catch {}
      return failedAttempts;
    }

    function resetFailedAttempts() {
      failedAttempts = 0;
      try {
        if (chrome.storage && chrome.storage.session) {
          chrome.storage.session.remove(attemptsKey).catch(() => {});
        }
      } catch {}
    }

    const styles = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", Helvetica, Arial, sans-serif;
        color: #f1f5f9;
        -webkit-font-smoothing: antialiased;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        user-select: none;
      }

      /* Cosmic Ambient Lighting & Mesh Background */
      .shield-backdrop {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background-color: #060911;
        background-image: 
          radial-gradient(circle at 18% 20%, rgba(16, 185, 129, 0.18) 0%, transparent 45%),
          radial-gradient(circle at 82% 75%, rgba(6, 182, 212, 0.16) 0%, transparent 45%),
          radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        z-index: 2147483647;
        overflow: hidden;
      }

      .backdrop-grid {
        position: absolute;
        inset: 0;
        background-size: 40px 40px;
        background-image: 
          linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
        mask-image: radial-gradient(circle at 50% 50%, black 40%, transparent 80%);
        -webkit-mask-image: radial-gradient(circle at 50% 50%, black 40%, transparent 80%);
        pointer-events: none;
      }

      /* Interactive Mouse-Following Aurora Glow */
      .cursor-aurora {
        position: absolute;
        width: 480px;
        height: 480px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(16, 185, 129, 0.22) 0%, rgba(6, 182, 212, 0.12) 40%, transparent 70%);
        filter: blur(80px);
        pointer-events: none;
        transform: translate(-50%, -50%);
        will-change: transform;
        opacity: 0.75;
        z-index: 1;
      }

      /* Floating Ambient Orbs */
      .glow-orb-1 {
        position: absolute;
        width: 380px;
        height: 380px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(16, 185, 129, 0.18) 0%, transparent 70%);
        top: 8%;
        left: 15%;
        filter: blur(60px);
        animation: floatOrb 12s ease-in-out infinite alternate;
        pointer-events: none;
      }
      .glow-orb-2 {
        position: absolute;
        width: 420px;
        height: 420px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(6, 182, 212, 0.16) 0%, transparent 70%);
        bottom: 10%;
        right: 15%;
        filter: blur(70px);
        animation: floatOrb 16s ease-in-out infinite alternate-reverse;
        pointer-events: none;
      }
      @keyframes floatOrb {
        0% { transform: translate(0, 0) scale(1); }
        100% { transform: translate(30px, -25px) scale(1.1); }
      }

      /* Main Glassmorphic Card */
      .shield-card {
        width: 100%;
        max-width: 396px;
        background: rgba(13, 19, 33, 0.84);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 30px;
        padding: 32px 28px 26px;
        box-shadow: 
          0 30px 70px -15px rgba(0, 0, 0, 0.85),
          0 0 40px rgba(16, 185, 129, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
        display: flex;
        flex-direction: column;
        align-items: center;
        animation: cardAppear 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
        z-index: 10;
      }
      .shield-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 15%;
        right: 15%;
        height: 2px;
        background: linear-gradient(90deg, transparent, #10b981, #06b6d4, transparent);
        border-radius: 2px;
      }
      @keyframes cardAppear {
        from { opacity: 0; transform: scale(0.94) translateY(16px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      /* Minimalist Domain Badge Header (No visible Admin button) */
      .card-header-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        margin-bottom: 12px;
      }
      .domain-badge {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 4px 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        color: #94a3b8;
        max-width: 280px;
      }
      .domain-badge .live-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
      }
      .domain-badge span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Stealth Lock Emblem (Triple-click trigger for Admin) */
      .lock-emblem {
        width: 64px;
        height: 64px;
        border-radius: 20px;
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.12));
        border: 1px solid rgba(52, 211, 153, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 14px;
        box-shadow: 0 10px 25px rgba(16, 185, 129, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        position: relative;
        cursor: pointer;
        transition: transform 0.12s ease;
      }
      .lock-emblem::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 24px;
        border: 1px solid rgba(16, 185, 129, 0.2);
        animation: pulseRing 3s ease-out infinite;
      }
      @keyframes pulseRing {
        0% { transform: scale(0.96); opacity: 0.8; }
        50% { transform: scale(1.04); opacity: 0.3; }
        100% { transform: scale(0.96); opacity: 0.8; }
      }
      .lock-svg {
        width: 28px;
        height: 28px;
        fill: #34d399;
      }

      .card-title {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #f8fafc;
        margin-bottom: 4px;
      }
      .card-subtitle {
        font-size: 13px;
        color: #64748b;
        margin-bottom: 18px;
        text-align: center;
      }

      /* PIN Dots Display Pill */
      .pin-pill-box {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        height: 48px;
        padding: 0 24px;
        background: rgba(18, 26, 44, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 24px;
        margin-bottom: 10px;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
      }
      .pin-dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid rgba(148, 163, 184, 0.35);
        transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        color: #34d399;
      }
      .pin-dot.filled {
        background: #10b981;
        border-color: #10b981;
        box-shadow: 0 0 14px rgba(16, 185, 129, 0.8), 0 0 4px #10b981;
        transform: scale(1.2);
      }
      .pin-dot.filled.revealed {
        background: transparent;
        border-color: #10b981;
      }

      .shake {
        animation: shakeCard 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
      }
      @keyframes shakeCard {
        10%, 90% { transform: translate3d(-3px, 0, 0); }
        20%, 80% { transform: translate3d(5px, 0, 0); }
        30%, 50%, 70% { transform: translate3d(-6px, 0, 0); }
        40%, 60% { transform: translate3d(6px, 0, 0); }
      }

      .status-text {
        font-size: 12px;
        min-height: 18px;
        color: #ef4444;
        font-weight: 500;
        margin-bottom: 14px;
        text-align: center;
      }
      .status-text.success {
        color: #10b981;
      }

      /* Luxury Keypad Grid */
      .keypad-matrix {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 11px;
        width: 100%;
        max-width: 300px;
        margin-bottom: 16px;
      }
      .key-btn {
        aspect-ratio: 1.45 / 1;
        background: linear-gradient(180deg, rgba(30, 41, 64, 0.7) 0%, rgba(18, 27, 46, 0.85) 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        color: #f1f5f9;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        outline: none;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }
      .key-btn:hover {
        background: linear-gradient(180deg, rgba(45, 60, 92, 0.8) 0%, rgba(26, 38, 64, 0.95) 100%);
        border-color: rgba(52, 211, 153, 0.35);
        transform: translateY(-2px);
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35), 0 0 12px rgba(16, 185, 129, 0.15);
      }
      .key-btn:active {
        background: rgba(16, 185, 129, 0.25);
        border-color: #10b981;
        transform: translateY(1px) scale(0.97);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
      }
      .key-number {
        font-size: 21px;
        font-weight: 700;
        line-height: 1.1;
      }
      .key-sub {
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.8px;
        color: #64748b;
        margin-top: 1px;
        text-transform: uppercase;
      }
      .key-btn.action-key {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.04);
        box-shadow: none;
        color: #94a3b8;
        font-size: 13px;
        font-weight: 600;
      }
      .key-btn.action-key:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #f1f5f9;
      }
      .key-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
        transform: none !important;
      }
      .key-btn svg {
        width: 19px;
        height: 19px;
        fill: currentColor;
      }

      /* Session Option Checkbox */
      .session-option-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        margin-bottom: 14px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px dashed rgba(255, 255, 255, 0.08);
        border-radius: 12px;
      }
      .session-option-row input[type="checkbox"] {
        accent-color: #10b981;
        width: 15px;
        height: 15px;
        cursor: pointer;
      }
      .session-option-label {
        font-size: 12px;
        color: #94a3b8;
        cursor: pointer;
      }

      /* Card Footer Controls */
      .card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .footer-hint {
        font-size: 11px;
        color: #64748b;
      }
      .toggle-view-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 11px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
      }
      .toggle-view-btn:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.06);
      }

      /* STEALTH ADMIN MODAL OVERLAY */
      .admin-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(11, 16, 28, 0.95);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border-radius: 30px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        z-index: 50;
        animation: modalFade 0.25s ease-out;
        overflow-y: auto;
      }
      @keyframes modalFade {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }
      .admin-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .admin-modal-title {
        font-size: 16px;
        font-weight: 700;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .admin-modal-title svg {
        width: 18px;
        height: 18px;
        fill: #10b981;
      }
      .close-admin-btn {
        background: rgba(255, 255, 255, 0.06);
        border: none;
        color: #94a3b8;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .close-admin-btn:hover {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
      }
      .admin-form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 14px;
      }
      .admin-form-group label {
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .admin-input {
        background: #141d30;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        padding: 9px 12px;
        color: #fff;
        font-size: 13px;
        outline: none;
      }
      .admin-input:focus {
        border-color: #10b981;
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
      }
      .admin-save-btn {
        background: linear-gradient(135deg, #10b981, #059669);
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        margin-top: 6px;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      }
      .admin-save-btn:hover {
        background: #059669;
      }
      .admin-alert {
        font-size: 11px;
        padding: 8px;
        border-radius: 6px;
        margin-bottom: 12px;
        text-align: center;
      }
      .admin-alert.error {
        background: rgba(239, 68, 68, 0.15);
        color: #fca5a5;
        border: 1px solid rgba(239, 68, 68, 0.3);
      }
      .admin-alert.success {
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }

      /* Radiant Unlock Shockwave Animation */
      .unlock-shockwave {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 4px solid rgba(52, 211, 153, 0.95);
        box-shadow: 
          0 0 50px rgba(16, 185, 129, 0.8),
          inset 0 0 25px rgba(16, 185, 129, 0.5);
        transform: translate(-50%, -50%);
        animation: shockwaveExpand 0.65s cubic-bezier(0.12, 0.9, 0.24, 1) forwards;
        pointer-events: none;
        z-index: 100;
      }
      @keyframes shockwaveExpand {
        0% {
          width: 20px;
          height: 20px;
          opacity: 1;
          border-width: 8px;
        }
        50% {
          opacity: 0.85;
          border-width: 4px;
        }
        100% {
          width: 260vw;
          height: 260vw;
          opacity: 0;
          border-width: 1px;
        }
      }

      .unlocking-anim {
        animation: unlockSuccess 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes unlockSuccess {
        0% { transform: scale(1); opacity: 1; }
        45% { transform: scale(1.06); opacity: 0.95; }
        100% { transform: scale(0.85); opacity: 0; }
      }
    `;

    const html = `
      <style>${styles}</style>
      <div class="shield-backdrop">
        <div class="backdrop-grid"></div>
        <div class="glow-orb-1"></div>
        <div class="glow-orb-2"></div>
        <div class="cursor-aurora" id="cursorAurora"></div>

        <div class="shield-card" id="card">
          <!-- Top Bar - Pure Minimalist Domain Badge (No Admin Button) -->
          <div class="card-header-bar">
            <div class="domain-badge">
              <span class="live-dot"></span>
              <span>${escapeHtml(domainName)}</span>
            </div>
          </div>

          <!-- Lock Icon Emblem (Stealth Trigger: Tap 3 times to open Admin) -->
          <div class="lock-emblem" id="lockEmblem" title="Security Active">
            <svg class="lock-svg" viewBox="0 0 24 24">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
          </div>

          <h2 class="card-title">Website Locked</h2>
          <p class="card-subtitle">Enter numeric passcode to unlock</p>

          <!-- PIN Display -->
          <div class="pin-pill-box" id="pinDisplay">
            <div class="pin-dot" data-index="0"></div>
            <div class="pin-dot" data-index="1"></div>
            <div class="pin-dot" data-index="2"></div>
            <div class="pin-dot" data-index="3"></div>
          </div>

          <div class="status-text" id="statusMsg"></div>

          <!-- Luxury Keypad Grid -->
          <div class="keypad-matrix" id="keypad">
            <button class="key-btn" data-val="1">
              <span class="key-number">1</span>
              <span class="key-sub">&nbsp;</span>
            </button>
            <button class="key-btn" data-val="2">
              <span class="key-number">2</span>
              <span class="key-sub">ABC</span>
            </button>
            <button class="key-btn" data-val="3">
              <span class="key-number">3</span>
              <span class="key-sub">DEF</span>
            </button>

            <button class="key-btn" data-val="4">
              <span class="key-number">4</span>
              <span class="key-sub">GHI</span>
            </button>
            <button class="key-btn" data-val="5">
              <span class="key-number">5</span>
              <span class="key-sub">JKL</span>
            </button>
            <button class="key-btn" data-val="6">
              <span class="key-number">6</span>
              <span class="key-sub">MNO</span>
            </button>

            <button class="key-btn" data-val="7">
              <span class="key-number">7</span>
              <span class="key-sub">PQRS</span>
            </button>
            <button class="key-btn" data-val="8">
              <span class="key-number">8</span>
              <span class="key-sub">TUV</span>
            </button>
            <button class="key-btn" data-val="9">
              <span class="key-number">9</span>
              <span class="key-sub">WXYZ</span>
            </button>

            <button class="key-btn action-key" data-action="clear">Clear</button>
            <button class="key-btn" data-val="0">
              <span class="key-number">0</span>
              <span class="key-sub">+</span>
            </button>
            <button class="key-btn action-key" data-action="backspace" title="Delete">
              <svg viewBox="0 0 24 24">
                <path d="M22 3H7c-.69 0-1.32.35-1.68.92L0 12l5.32 8.08c.36.57.99.92 1.68.92h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z"/>
              </svg>
            </button>
          </div>

          <!-- Session Duration Option (Locks on reload by default) -->
          <div class="session-option-row">
            <input type="checkbox" id="session15mCheckbox">
            <label for="session15mCheckbox" class="session-option-label">Keep unlocked for 15 minutes</label>
          </div>

          <!-- Footer Controls -->
          <div class="card-footer">
            <span class="footer-hint">Keyboard or Keypad</span>
            <button class="toggle-view-btn" id="toggleViewBtn">Show PIN</button>
          </div>

          <!-- STEALTH ADMIN MODAL OVERLAY (Zero hint until triggered) -->
          <div class="admin-modal-overlay" id="adminModal" style="display: none;">
            <div class="admin-modal-header">
              <div class="admin-modal-title">
                <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>
                <span>Admin Settings</span>
              </div>
              <button class="close-admin-btn" id="closeAdminBtn">✕</button>
            </div>

            <!-- Gatekeeper Step if not authenticated -->
            <div id="adminAuthGate">
              <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px; line-height: 1.4;">
                Admin authorization required. Enter your current Master PIN to configure passwords and blocklist.
              </p>
              <div class="admin-alert" id="adminAuthAlert" style="display: none;"></div>
              <div class="admin-form-group">
                <label for="adminAuthPin">Master PIN</label>
                <input type="password" id="adminAuthPin" class="admin-input" maxlength="8" placeholder="Enter current Master PIN" autocomplete="off">
              </div>
              <button type="button" class="admin-save-btn" id="adminLoginBtn">Authenticate</button>
            </div>

            <!-- Configuration Step when authenticated -->
            <div id="adminConfigView" style="display: none;">
              <div class="admin-alert" id="adminConfigAlert" style="display: none;"></div>
              
              <div class="admin-form-group">
                <label for="adminNewMaster">New Master PIN (4-8 digits)</label>
                <input type="password" id="adminNewMaster" class="admin-input" maxlength="8" placeholder="Leave blank to keep current">
              </div>

              <div class="admin-form-group">
                <label for="adminNewDuress">New Duress / Decoy PIN</label>
                <input type="password" id="adminNewDuress" class="admin-input" maxlength="8" placeholder="Leave blank to keep current">
              </div>

              <div class="admin-form-group">
                <label for="adminDuressAction">Duress Trigger Action</label>
                <select id="adminDuressAction" class="admin-input" style="cursor: pointer;">
                  <option value="error_screen">Simulate Connection Failure (ERR_CONNECTION_REFUSED)</option>
                  <option value="redirect">Redirect to Decoy Website</option>
                  <option value="close_tab">Close Tab Immediately</option>
                </select>
              </div>

              <div class="admin-form-group" id="adminDecoyUrlGroup" style="display: none;">
                <label for="adminDecoyUrl">Decoy Redirect URL</label>
                <input type="url" id="adminDecoyUrl" class="admin-input" placeholder="https://www.google.com">
              </div>

              <button type="button" class="admin-save-btn" id="adminSaveConfigBtn">Save Configuration</button>

              <div class="admin-form-group" style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed rgba(255, 255, 255, 0.12);">
                <label for="adminSitePin">Individual Passcode for ${escapeHtml(domainName)}</label>
                <input type="password" id="adminSitePin" class="admin-input" maxlength="8" placeholder="Enter custom PIN for this site">
                <div style="display: flex; gap: 8px; margin-top: 6px;">
                  <button type="button" class="admin-save-btn" id="adminSaveSitePinBtn" style="margin-top: 0; flex: 1;">Set Site PIN</button>
                  <button type="button" class="admin-save-btn" id="adminResetSitePinBtn" style="margin-top: 0; flex: 1; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5;">Use Master</button>
                </div>
              </div>

              <button type="button" id="adminOpenFullDashboardBtn" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #cbd5e1; border-radius: 10px; padding: 10px; font-size: 12px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 12px; transition: background 0.15s ease;">Open Full Admin Dashboard ↗</button>
            </div>
          </div>
        </div>
      </div>
    `;

    shadow.innerHTML = html;

    const pinDisplay = shadow.getElementById('pinDisplay');
    const statusMsg = shadow.getElementById('statusMsg');
    const keypad = shadow.getElementById('keypad');
    const card = shadow.getElementById('card');
    const toggleViewBtn = shadow.getElementById('toggleViewBtn');
    const session15mCheckbox = shadow.getElementById('session15mCheckbox');
    const lockEmblem = shadow.getElementById('lockEmblem');
    const cursorAurora = shadow.getElementById('cursorAurora');

    // Admin Modal Elements
    const adminModal = shadow.getElementById('adminModal');
    const closeAdminBtn = shadow.getElementById('closeAdminBtn');
    const adminAuthGate = shadow.getElementById('adminAuthGate');
    const adminConfigView = shadow.getElementById('adminConfigView');
    const adminAuthPin = shadow.getElementById('adminAuthPin');
    const adminLoginBtn = shadow.getElementById('adminLoginBtn');
    const adminAuthAlert = shadow.getElementById('adminAuthAlert');
    const adminConfigAlert = shadow.getElementById('adminConfigAlert');
    const adminNewMaster = shadow.getElementById('adminNewMaster');
    const adminNewDuress = shadow.getElementById('adminNewDuress');
    const adminDuressAction = shadow.getElementById('adminDuressAction');
    const adminDecoyUrlGroup = shadow.getElementById('adminDecoyUrlGroup');
    const adminDecoyUrl = shadow.getElementById('adminDecoyUrl');
    const adminSaveConfigBtn = shadow.getElementById('adminSaveConfigBtn');
    const adminSitePin = shadow.getElementById('adminSitePin');
    const adminSaveSitePinBtn = shadow.getElementById('adminSaveSitePinBtn');
    const adminResetSitePinBtn = shadow.getElementById('adminResetSitePinBtn');
    const adminOpenFullDashboardBtn = shadow.getElementById('adminOpenFullDashboardBtn');

    // ================= INTERACTIVE MOUSE AURORA =================
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let curX = mouseX;
    let curY = mouseY;
    let animFrame = null;

    const onMouseMove = (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!animFrame) {
        animFrame = requestAnimationFrame(updateAurora);
      }
    };

    function updateAurora() {
      curX += (mouseX - curX) * 0.12;
      curY += (mouseY - curY) * 0.12;
      if (cursorAurora) {
        cursorAurora.style.transform = `translate3d(${curX}px, ${curY}px, 0) translate(-50%, -50%)`;
      }
      if (Math.abs(mouseX - curX) > 0.5 || Math.abs(mouseY - curY) > 0.5) {
        animFrame = requestAnimationFrame(updateAurora);
      } else {
        animFrame = null;
      }
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    function updateDots() {
      const requiredDots = Math.max(4, currentPin.length);
      const existingDots = pinDisplay.querySelectorAll('.pin-dot');

      if (existingDots.length !== requiredDots) {
        pinDisplay.innerHTML = '';
        for (let i = 0; i < requiredDots; i++) {
          const dot = document.createElement('div');
          dot.className = 'pin-dot';
          dot.dataset.index = i;
          pinDisplay.appendChild(dot);
        }
      }

      const dots = pinDisplay.querySelectorAll('.pin-dot');
      dots.forEach((dot, idx) => {
        if (idx < currentPin.length) {
          dot.classList.add('filled');
          if (isPinVisible) {
            dot.classList.add('revealed');
            dot.textContent = currentPin[idx];
          } else {
            dot.classList.remove('revealed');
            dot.textContent = '';
          }
        } else {
          dot.classList.remove('filled', 'revealed');
          dot.textContent = '';
        }
      });
    }

    function appendDigit(d) {
      if (isVerifying || lockoutTimer) return;
      if (currentPin.length >= 8) return;

      currentPin += d;
      updateDots();
      statusMsg.textContent = '';

      if (currentPin.length >= 4) {
        setTimeout(() => {
          if (currentPin.length >= 4 && !isVerifying) {
            submitPin();
          }
        }, 120);
      }
    }

    function deleteDigit() {
      if (isVerifying || lockoutTimer) return;
      if (currentPin.length > 0) {
        currentPin = currentPin.slice(0, -1);
        updateDots();
        statusMsg.textContent = '';
      }
    }

    function clearDigits() {
      if (isVerifying || lockoutTimer) return;
      currentPin = '';
      updateDots();
      statusMsg.textContent = '';
    }

    function setLockout(seconds) {
      let remaining = seconds;
      statusMsg.textContent = `Too many attempts. Wait ${remaining}s`;
      keypad.querySelectorAll('button').forEach((b) => (b.disabled = true));

      lockoutTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(lockoutTimer);
          lockoutTimer = null;
          resetFailedAttempts();
          statusMsg.textContent = '';
          keypad.querySelectorAll('button').forEach((b) => (b.disabled = false));
        } else {
          statusMsg.textContent = `Too many attempts. Wait ${remaining}s`;
        }
      }, 1000);
    }

    async function submitPin() {
      if (isVerifying || lockoutTimer || !currentPin) return;
      isVerifying = true;

      const stayUnlocked = session15mCheckbox.checked;

      // Dual-Layer Verification:
      // Try background worker, but have fast local fallback using Web Crypto API
      let res = null;

      try {
        res = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'VERIFY_PIN',
              pin: currentPin,
              domain: domainName,
              stayUnlockedFor15m: stayUnlocked
            },
            (response) => {
              if (chrome.runtime.lastError) {
                resolve(null);
              } else {
                resolve(response);
              }
            }
          );
        });
      } catch {}

      // If service worker was suspended or failed, verify directly via Web Crypto!
      if (!res && config.salt && config.masterPinHash) {
        const localHash = await hashPinWithSalt(currentPin, config.salt);
        const sitePins = config.sitePins || {};
        const sitePinHash = sitePins[domainName];

        if (sitePinHash && localHash === sitePinHash) {
          res = { success: true, isMaster: true, isSitePin: true, domain: domainName };
          const { unlockedDomainsMap = {} } = await chrome.storage.local.get('unlockedDomainsMap');
          if (stayUnlocked) {
            unlockedDomainsMap[domainName] = Date.now() + 15 * 60 * 1000;
          } else {
            delete unlockedDomainsMap[domainName];
          }
          await chrome.storage.local.set({ unlockedDomainsMap });
        } else if (localHash === config.masterPinHash) {
          res = { success: true, isMaster: true, domain: domainName };
          // Save or clear 15m session token in storage.local
          const { unlockedDomainsMap = {} } = await chrome.storage.local.get('unlockedDomainsMap');
          if (stayUnlocked) {
            unlockedDomainsMap[domainName] = Date.now() + 15 * 60 * 1000;
          } else {
            delete unlockedDomainsMap[domainName];
          }
          await chrome.storage.local.set({ unlockedDomainsMap });
        } else if (config.duressPinHash && localHash === config.duressPinHash) {
          res = {
            success: true,
            isDuress: true,
            duressAction: config.duressAction,
            decoyUrl: config.decoyUrl,
            decoyErrorCode: config.decoyErrorCode,
            domain: domainName
          };
          const { decoyActiveDomains = {} } = await chrome.storage.local.get('decoyActiveDomains');
          decoyActiveDomains[domainName] = Date.now() + 10 * 60 * 1000;
          await chrome.storage.local.set({ decoyActiveDomains });
        } else {
          res = { success: false, error: 'Incorrect Passcode' };
        }
      }

      isVerifying = false;

      if (!res) {
        showError('Verification service error');
        return;
      }

      if (res.success && res.isMaster) {
        statusMsg.className = 'status-text success';
        statusMsg.textContent = 'Access granted';
        resetFailedAttempts();

        // RADIANT UNLOCK SHOCKWAVE EFFECT
        const shockwave = document.createElement('div');
        shockwave.className = 'unlock-shockwave';
        const backdrop = shadow.querySelector('.shield-backdrop');
        if (backdrop) backdrop.appendChild(shockwave);

        card.classList.add('unlocking-anim');
        setTimeout(() => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('keydown', onKeyDown, true);
          if (document.documentElement) {
            document.documentElement.removeAttribute('data-sitelock-active');
          }
          host.remove();
          cleanupPreHide();
          attachUniversalLogoLockTrigger(domainName);
        }, 450);
        return;
      }

      if (res.success && res.isDuress) {
        triggerDecoyMode(res.duressAction, res.decoyUrl, res.decoyErrorCode, domainName);
        return;
      }

      // Failed PIN - Record Attempt
      const currentFailed = recordFailedAttempt();
      const maxAttempts = config.intruderMaxAttempts || 4;
      const isVideoTrapEnabled = config.intruderVideoEnabled !== false;

      // When reaching the threshold (e.g. 4 wrong attempts):
      // DIRECT AND SEAMLESS SWITCH - Do not shake card, do not delay, launch true fullscreen video immediately!
      if (isVideoTrapEnabled && currentFailed >= maxAttempts) {
        card.style.transition = 'opacity 0.12s ease-out, transform 0.12s ease-out';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.96)';

        triggerIntruderVideoTrap(
          config.intruderVideoUrl || 'https://www.youtube.com/watch?v=1CouGcNKICc',
          domainName,
          config
        );
        return;
      }

      // Show clear feedback on remaining attempts before threshold
      const remaining = maxAttempts - currentFailed;
      if (remaining === 1) {
        showError('Incorrect Passcode (1 attempt left)');
      } else {
        showError(`Incorrect Passcode (${currentFailed}/${maxAttempts})`);
      }

      if (currentFailed >= 5) {
        setLockout(30);
      }
    }

    /**
     * Intruder Video Trap Overlay
     * Plays punishment YouTube video in TRUE full screen with NO controls, zero black bars, and immediate activation.
     * Owner Escape Hatch: Double-tap Escape (Esc + Esc within 1.5s) or Shift+Escape to exit and return to PIN screen.
     */
    function triggerIntruderVideoTrap(videoUrl, domainName, cfg) {
      const existing = document.getElementById('__sitelock_intruder_trap__');
      if (existing) existing.remove();

      let videoId = '1CouGcNKICc';
      if (videoUrl) {
        const match = videoUrl.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*)/);
        if (match && match[1] && match[1].length === 11) {
          videoId = match[1];
        }
      }

      try {
        chrome.runtime.sendMessage({
          type: 'RECORD_AUDIT',
          auditType: 'intruder_trap',
          details: `Intruder punishment video triggered on ${domainName} (Video ID: ${videoId}) after ${failedAttempts} failed attempts`
        });
      } catch {}

      const trap = document.createElement('div');
      trap.id = '__sitelock_intruder_trap__';
      trap.style.cssText = `
        position: fixed !important;
        inset: 0 !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        background: #000 !important;
        overflow: hidden !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        margin: 0 !important;
        padding: 0 !important;
      `;

      // Fullscreen embed with autoplay=1&mute=1 guaranteed to play instantly without red play button
      const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&loop=1&playlist=${videoId}&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1&enablejsapi=1`;

      trap.innerHTML = `
        <style>
          #__sitelock_intruder_trap__ {
            animation: sitelockTrapIn 0.15s ease-out !important;
          }
          @keyframes sitelockTrapIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          :fullscreen #__sitelock_intruder_trap__,
          :-webkit-full-screen #__sitelock_intruder_trap__ {
            width: 100vw !important;
            height: 100vh !important;
            background: #000 !important;
          }
          /* Cover transform: stretches/scales 16:9 video so zero black pillarbox/letterbox bars appear on any display */
          .sitelock-trap-iframe {
            position: absolute !important;
            top: 50% !important;
            left: 50% !important;
            width: 100vw !important;
            height: 56.25vw !important;
            min-height: 100vh !important;
            min-width: 177.78vh !important;
            transform: translate(-50%, -50%) scale(1.08) !important;
            border: none !important;
            outline: none !important;
            pointer-events: none !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            z-index: 1 !important;
          }
          .sitelock-trap-blocker {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            z-index: 2 !important;
            background: transparent !important;
            cursor: not-allowed !important;
          }
        </style>
        <iframe 
          class="sitelock-trap-iframe"
          src="${embedUrl}" 
          allow="accelerometer; autoplay *; clipboard-write; encrypted-media *; gyroscope; picture-in-picture; web-share; fullscreen *" 
          allowfullscreen="true">
        </iframe>
        <div class="sitelock-trap-blocker" title="Security Lockdown"></div>
      `;

      // Hide lock shield host completely so the cosmic gradient/mesh never sits in front of the video
      if (host) {
        host.style.setProperty('display', 'none', 'important');
      }

      (document.documentElement || document.body).appendChild(trap);

      const iframe = trap.querySelector('iframe');
      function sendYtCommand(func, args = []) {
        try {
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(JSON.stringify({
              event: 'command',
              func: func,
              args: args
            }), '*');
          }
        } catch {}
      }

      // As soon as iframe loads, guarantee playback and attempt unmuting
      if (iframe) {
        iframe.addEventListener('load', () => {
          sendYtCommand('playVideo');
          setTimeout(() => {
            sendYtCommand('unMute');
            sendYtCommand('setVolume', [100]);
            sendYtCommand('playVideo');
          }, 150);
        });
      }

      // Enforce true browser-level fullscreen
      function enterNativeFullscreen() {
        // 1. Fullscreen via extension service worker (chrome.windows.update)
        try {
          chrome.runtime.sendMessage({ type: 'ENTER_FULLSCREEN' });
        } catch {}

        // 2. Fullscreen via DOM HTML5 API
        try {
          if (trap.requestFullscreen) {
            trap.requestFullscreen().catch(() => {
              if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(() => {});
              }
            });
          } else if (trap.webkitRequestFullscreen) {
            trap.webkitRequestFullscreen();
          } else if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        } catch (e) {}
      }

      // Enter native fullscreen immediately inside user activation gesture
      enterNativeFullscreen();

      // If user clicks anywhere on the blocker, re-request native fullscreen & unmute/play
      const blocker = trap.querySelector('.sitelock-trap-blocker');
      if (blocker) {
        blocker.addEventListener('pointerdown', () => {
          enterNativeFullscreen();
          sendYtCommand('unMute');
          sendYtCommand('setVolume', [100]);
          sendYtCommand('playVideo');
        });
      }

      // Owner Escape Hatch: Double-tap Escape (Esc + Esc within 1.5s) OR Shift+Escape
      let escCount = 0;
      let escTimer = null;

      function exitTrap() {
        window.removeEventListener('keydown', onTrapKeyDown, true);

        // 1. Exit extension window fullscreen
        try {
          chrome.runtime.sendMessage({ type: 'EXIT_FULLSCREEN' });
        } catch {}

        // 2. Exit DOM fullscreen
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) {
              document.exitFullscreen().catch(() => {});
            } else if (document.webkitExitFullscreen) {
              document.webkitExitFullscreen();
            }
          }
        } catch {}

        trap.style.transition = 'opacity 0.2s ease-out';
        trap.style.opacity = '0';
        setTimeout(() => {
          trap.remove();
          if (host) {
            host.style.removeProperty('display');
          }
          resetFailedAttempts();
          currentPin = '';
          updateDots();
          card.style.opacity = '1';
          card.style.transform = 'none';
          statusMsg.className = 'status-text';
          statusMsg.textContent = 'Enter Passcode';
        }, 200);
      }

      function onTrapKeyDown(e) {
        // Immediate escape with Shift + Escape
        if (e.key === 'Escape' && e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          exitTrap();
          return;
        }

        // Double-tap Escape key
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          escCount++;

          if (escCount === 1) {
            clearTimeout(escTimer);
            escTimer = setTimeout(() => {
              escCount = 0;
            }, 1500);
          } else if (escCount >= 2) {
            clearTimeout(escTimer);
            escCount = 0;
            exitTrap();
          }
          return;
        }

        // Any other key attempt by intruder re-enforces fullscreen & ensures playing
        enterNativeFullscreen();
        sendYtCommand('unMute');
        sendYtCommand('setVolume', [100]);
        sendYtCommand('playVideo');
      }

      window.addEventListener('keydown', onTrapKeyDown, true);
    }

    function showError(msg) {
      statusMsg.className = 'status-text';
      statusMsg.textContent = msg;
      pinDisplay.classList.add('shake');
      setTimeout(() => {
        pinDisplay.classList.remove('shake');
        currentPin = '';
        updateDots();
      }, 400);
    }

    // Keypad Click
    keypad.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;

      const val = btn.dataset.val;
      const action = btn.dataset.action;

      if (val !== undefined) {
        appendDigit(val);
      } else if (action === 'backspace') {
        deleteDigit();
      } else if (action === 'clear') {
        clearDigits();
      }
    });

    toggleViewBtn.addEventListener('click', () => {
      isPinVisible = !isPinVisible;
      toggleViewBtn.textContent = isPinVisible ? 'Hide PIN' : 'Show PIN';
      updateDots();
    });

    // ================= STEALTH ADMIN ACCESS TRIGGER =================
    function openAdminModal() {
      adminModal.style.display = 'flex';
      if (!adminAuthenticated) {
        adminAuthGate.style.display = 'block';
        adminConfigView.style.display = 'none';
        adminAuthPin.value = '';
        adminAuthPin.focus();
      } else {
        adminAuthGate.style.display = 'none';
        adminConfigView.style.display = 'block';
      }
    }

    // 1. Secret Tap on Lock Emblem: Triple-click within 1.4 seconds
    lockEmblem.addEventListener('click', () => {
      emblemClickCount++;
      lockEmblem.style.transform = 'scale(0.92)';
      setTimeout(() => { lockEmblem.style.transform = ''; }, 100);

      if (emblemClickTimer) clearTimeout(emblemClickTimer);

      if (emblemClickCount >= 3) {
        emblemClickCount = 0;
        openAdminModal();
      } else {
        emblemClickTimer = setTimeout(() => {
          emblemClickCount = 0;
        }, 1400);
      }
    });

    // 2. Keyboard Handler (Digits, Enter, and Secret Shift+A shortcut)
    const onKeyDown = (e) => {
      if (adminModal.style.display !== 'none') return;
      
      // Secret Admin Key Combo: Shift + A
      if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        openAdminModal();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        deleteDigit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearDigits();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submitPin();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    // ================= ADMIN MODAL CONTROLS =================
    closeAdminBtn.addEventListener('click', () => {
      adminModal.style.display = 'none';
    });

    adminDuressAction.addEventListener('change', () => {
      adminDecoyUrlGroup.style.display = adminDuressAction.value === 'redirect' ? 'flex' : 'none';
    });

    adminLoginBtn.addEventListener('click', async () => {
      const pin = adminAuthPin.value.trim();
      if (!pin) return;

      // Check via background worker or local hash fallback
      let authorized = false;
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'VERIFY_ADMIN_PIN', pin }, resolve);
        });
        if (res && res.authorized) authorized = true;
      } catch {}

      if (!authorized && config.salt && config.masterPinHash) {
        const h = await hashPinWithSalt(pin, config.salt);
        if (h === config.masterPinHash) authorized = true;
      }

      if (authorized) {
        adminAuthenticated = true;
        adminAuthGate.style.display = 'none';
        adminConfigView.style.display = 'block';
        adminAuthAlert.style.display = 'none';

        const st = await chrome.storage.local.get(['duressAction', 'decoyUrl', 'sitePins']);
        adminDuressAction.value = st.duressAction || 'error_screen';
        adminDecoyUrl.value = st.decoyUrl || 'https://www.google.com';
        adminDecoyUrlGroup.style.display = adminDuressAction.value === 'redirect' ? 'flex' : 'none';

        const sitePins = st.sitePins || {};
        if (sitePins[domainName]) {
          adminSitePin.placeholder = 'Custom PIN active (enter new to change)';
        } else {
          adminSitePin.placeholder = 'Using Master PIN (enter custom PIN)';
        }
      } else {
        adminAuthAlert.textContent = 'Incorrect Master PIN';
        adminAuthAlert.className = 'admin-alert error';
        adminAuthAlert.style.display = 'block';
      }
    });

    // Save individual site PIN
    adminSaveSitePinBtn.addEventListener('click', async () => {
      const pin = adminSitePin.value.trim();
      if (!pin || !/^\d{4,8}$/.test(pin)) {
        adminConfigAlert.textContent = 'Site PIN must be 4 to 8 numeric digits';
        adminConfigAlert.className = 'admin-alert error';
        adminConfigAlert.style.display = 'block';
        return;
      }

      await chrome.runtime.sendMessage({
        type: 'SET_SITE_PIN',
        domain: domainName,
        pin
      });

      // Update local config fallback as well
      const { salt } = await chrome.storage.local.get('salt');
      const hashed = await hashPinWithSalt(pin, salt);
      if (!config.sitePins) config.sitePins = {};
      config.sitePins[domainName] = hashed;

      adminConfigAlert.textContent = `Custom PIN for ${domainName} saved successfully!`;
      adminConfigAlert.className = 'admin-alert success';
      adminConfigAlert.style.display = 'block';
      adminSitePin.value = '';
      adminSitePin.placeholder = 'Custom PIN active (enter new to change)';
    });

    // Reset site PIN back to Master PIN
    adminResetSitePinBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'REMOVE_SITE_PIN',
        domain: domainName
      });

      if (config.sitePins) {
        delete config.sitePins[domainName];
      }

      adminConfigAlert.textContent = `${domainName} reverted to Master PIN!`;
      adminConfigAlert.className = 'admin-alert success';
      adminConfigAlert.style.display = 'block';
      adminSitePin.value = '';
      adminSitePin.placeholder = 'Using Master PIN (enter custom PIN)';
    });

    // Open Full Admin Dashboard
    adminOpenFullDashboardBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
      adminModal.style.display = 'none';
    });

    adminSaveConfigBtn.addEventListener('click', async () => {
      const currentAuth = adminAuthPin.value.trim();
      const newMaster = adminNewMaster.value.trim();
      const newDuress = adminNewDuress.value.trim();
      const action = adminDuressAction.value;
      const decoy = adminDecoyUrl.value.trim() || 'https://www.google.com';

      if (newMaster && !/^\d{4,8}$/.test(newMaster)) {
        adminConfigAlert.textContent = 'Master PIN must be 4 to 8 digits';
        adminConfigAlert.className = 'admin-alert error';
        adminConfigAlert.style.display = 'block';
        return;
      }
      if (newDuress && !/^\d{4,8}$/.test(newDuress)) {
        adminConfigAlert.textContent = 'Duress PIN must be 4 to 8 digits';
        adminConfigAlert.className = 'admin-alert error';
        adminConfigAlert.style.display = 'block';
        return;
      }
      if (newMaster && newDuress && newMaster === newDuress) {
        adminConfigAlert.textContent = 'Master and Duress PINs cannot be identical';
        adminConfigAlert.className = 'admin-alert error';
        adminConfigAlert.style.display = 'block';
        return;
      }

      const updates = {
        duressAction: action,
        decoyUrl: decoy
      };

      if (newMaster || newDuress) {
        const { salt } = await chrome.storage.local.get('salt');
        if (newMaster) {
          updates.masterPinHash = await hashPinWithSalt(newMaster, salt);
          config.masterPinHash = updates.masterPinHash;
          updates.isMasterDefault = false;
        }
        if (newDuress) {
          updates.duressPinHash = await hashPinWithSalt(newDuress, salt);
          config.duressPinHash = updates.duressPinHash;
        }
      }

      await chrome.storage.local.set(updates);

      adminConfigAlert.textContent = 'Settings saved successfully!';
      adminConfigAlert.className = 'admin-alert success';
      adminConfigAlert.style.display = 'block';

      if (newMaster) adminAuthPin.value = newMaster;
      adminNewMaster.value = '';
      adminNewDuress.value = '';

      setTimeout(() => {
        adminModal.style.display = 'none';
      }, 1200);
    });
  }

  /**
   * Renders authentic Chromium / Brave "This site can't be reached" error screen.
   */
  function renderDecoyErrorPage(shadow, host, domain, errorCode, config = {}) {
    const errorStyles = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #c7c7c7;
        background-color: #202124;
        -webkit-font-smoothing: antialiased;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .error-wrapper {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background-color: #202124;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        z-index: 2147483647;
        overflow-y: auto;
      }
      .error-box {
        max-width: 580px;
        width: 100%;
      }
      .error-icon {
        width: 44px;
        height: 44px;
        margin-bottom: 24px;
        fill: #9aa0a6;
        cursor: default;
        transition: transform 0.1s ease;
      }
      .error-title {
        font-size: 24px;
        font-weight: 500;
        color: #e8eaed;
        margin-bottom: 16px;
        line-height: 1.3;
      }
      .error-desc {
        font-size: 14px;
        color: #9aa0a6;
        line-height: 1.6;
        margin-bottom: 16px;
      }
      .error-desc b {
        color: #e8eaed;
        font-weight: 600;
      }
      .suggestions-list {
        font-size: 14px;
        color: #9aa0a6;
        line-height: 1.8;
        margin-left: 20px;
        margin-bottom: 24px;
      }
      .error-code {
        font-size: 11px;
        color: #80868b;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 36px;
        font-family: monospace;
      }
      .actions-row {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .reload-btn {
        background-color: #8ab4f8;
        color: #202124;
        border: none;
        border-radius: 4px;
        padding: 8px 18px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        transition: background-color 0.15s;
        outline: none;
      }
      .reload-btn:hover {
        background-color: #aecbfa;
      }
      .details-btn {
        background: transparent;
        color: #8ab4f8;
        border: none;
        font-size: 14px;
        cursor: pointer;
        padding: 8px 12px;
        border-radius: 4px;
      }
      .details-btn:hover {
        background: rgba(138, 180, 248, 0.08);
      }
      .details-content {
        margin-top: 20px;
        padding: 16px;
        background: #292a2d;
        border-radius: 4px;
        font-size: 13px;
        color: #9aa0a6;
        line-height: 1.6;
        display: none;
      }
      .details-content.show {
        display: block;
      }
      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #202124;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        display: none;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;

    const errorHtml = `
      <style>${errorStyles}</style>
      <div class="error-wrapper">
        <div class="error-box">
          <svg class="error-icon" id="fakeErrorIcon" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <h1 class="error-title">This site can’t be reached</h1>
          <p class="error-desc">
            <b>${escapeHtml(domain)}</b> refused to connect.
          </p>
          <p class="error-desc">Try:</p>
          <ul class="suggestions-list">
            <li>Checking the connection</li>
            <li>Checking the proxy and the firewall</li>
          </ul>
          <div class="error-code">${escapeHtml(errorCode)}</div>
          <div class="actions-row">
            <button class="reload-btn" id="fakeReloadBtn">
              <span class="spinner" id="btnSpinner"></span>
              <span id="btnText">Reload</span>
            </button>
            <button class="details-btn" id="toggleDetailsBtn">Details</button>
          </div>
          <div class="details-content" id="detailsBox">
            <p>The server at <strong id="stealthDomainSpan" style="cursor: default;">${escapeHtml(domain)}</strong> took too long to respond or actively rejected the connection attempt.</p>
            <p style="margin-top: 8px;">If you are using a proxy server or VPN, verify your internet settings or contact your network administrator.</p>
          </div>
        </div>
      </div>
    `;

    shadow.innerHTML = errorHtml;

    const reloadBtn = shadow.getElementById('fakeReloadBtn');
    const btnSpinner = shadow.getElementById('btnSpinner');
    const btnText = shadow.getElementById('btnText');
    const toggleDetailsBtn = shadow.getElementById('toggleDetailsBtn');
    const detailsBox = shadow.getElementById('detailsBox');
    const fakeErrorIcon = shadow.getElementById('fakeErrorIcon');
    const stealthDomainSpan = shadow.getElementById('stealthDomainSpan');

    reloadBtn.addEventListener('click', () => {
      btnSpinner.style.display = 'inline-block';
      btnText.textContent = 'Connecting...';
      reloadBtn.disabled = true;

      setTimeout(() => {
        btnSpinner.style.display = 'none';
        btnText.textContent = 'Reload';
        reloadBtn.disabled = false;
      }, 1400);
    });

    toggleDetailsBtn.addEventListener('click', () => {
      const isShowing = detailsBox.classList.toggle('show');
      toggleDetailsBtn.textContent = isShowing ? 'Hide details' : 'Details';
    });

    // Disarm and transition cleanly back to real lock screen
    const disarmAndShowLockScreen = async () => {
      window.removeEventListener('keydown', onDecoyKeyDown, true);
      await chrome.runtime.sendMessage({ type: 'DISARM_DECOY', domain });
      const { decoyActiveDomains = {} } = await chrome.storage.local.get('decoyActiveDomains');
      delete decoyActiveDomains[domain];
      await chrome.storage.local.set({ decoyActiveDomains, lastDecoyRedirect: null });

      if (host) host.remove();
      initLockScreen(config);
    };

    // 1. Triple-Click on the fake error icon brings back the Lock Screen
    let iconClicks = 0;
    let iconTimer = null;
    fakeErrorIcon.addEventListener('click', () => {
      iconClicks++;
      fakeErrorIcon.style.transform = 'scale(0.95)';
      setTimeout(() => { fakeErrorIcon.style.transform = ''; }, 100);

      if (iconTimer) clearTimeout(iconTimer);
      if (iconClicks >= 3) {
        iconClicks = 0;
        disarmAndShowLockScreen();
      } else {
        iconTimer = setTimeout(() => { iconClicks = 0; }, 1400);
      }
    });

    // Double-click on domain name in details box also triggers disarm
    stealthDomainSpan.addEventListener('dblclick', () => {
      disarmAndShowLockScreen();
    });

    // 2. Secret Keypress Buffer (Silent keyboard entry on fake error screen)
    // The user can literally just type "282006" on their keyboard in thin air to unlock!
    let typedDigits = '';
    let typedTimer = null;

    const onDecoyKeyDown = async (e) => {
      // Hotkeys: Shift+A, Shift+Esc, Cmd+Shift+L to bring back the lock screen
      const isHotkey = 
        (e.shiftKey && (e.key === 'A' || e.key === 'a')) ||
        (e.shiftKey && e.key === 'Escape') ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'L' || e.key === 'l'));

      if (isHotkey) {
        e.preventDefault();
        disarmAndShowLockScreen();
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        typedDigits = (typedDigits + e.key).slice(-8);
        if (typedTimer) clearTimeout(typedTimer);
        typedTimer = setTimeout(() => { typedDigits = ''; }, 3500);

        if (typedDigits.length >= 4 && config.salt) {
          const typedHash = await hashPinWithSalt(typedDigits, config.salt);
          const sitePins = config.sitePins || {};
          const siteHash = sitePins[domain];

          // If typed PIN matches Master PIN or Site PIN: UNLOCK INSTANTLY!
          if (typedHash === config.masterPinHash || (siteHash && typedHash === siteHash)) {
            window.removeEventListener('keydown', onDecoyKeyDown, true);
            await chrome.runtime.sendMessage({ type: 'DISARM_DECOY', domain });
            const { decoyActiveDomains = {} } = await chrome.storage.local.get('decoyActiveDomains');
            delete decoyActiveDomains[domain];
            await chrome.storage.local.set({ decoyActiveDomains, lastDecoyRedirect: null });

            if (document.documentElement) {
              document.documentElement.removeAttribute('data-sitelock-active');
            }
            if (host) host.remove();
            cleanupPreHide();
            attachUniversalLogoLockTrigger(domain);
          }
        }
      }
    };

    window.addEventListener('keydown', onDecoyKeyDown, true);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();

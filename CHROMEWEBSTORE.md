# Chrome Web Store & Extension Documentation

## Listing Metadata

- **Name**: SiteLock Guard - PIN & Duress Lock
- **Version**: 1.0.0
- **Summary / Short Description**: Lock sensitive websites with a numerical PIN, duress decoy protection (simulate connection failure or redirect), and Brave/Chrome compatibility.
- **Category**: Productivity / Privacy & Security
- **Default Language**: English

---

## Detailed Description

SiteLock Guard is a privacy and website lock extension engineered for Brave and Chromium browsers. Protect sensitive web apps (Instagram, WhatsApp Web, Discord, X/Twitter, Reddit, financial dashboards, and custom domains) behind an impenetrable, zero-flicker numeric PIN lock screen.

### 🛡️ Key Features

1. **Instant, Zero-Flicker Locking**:
   - Injects at `document_start` to eliminate any visual leak or preview of your feed, chats, or sensitive data before authorization.
   - Preserves the website URL in the address bar (e.g. `instagram.com`).

2. **Master PIN Unlock**:
   - Set a 4-to-8 digit numeric passcode.
   - Unlock with an on-screen tactile keypad or your physical keyboard.
   - Salted SHA-256 cryptographic hashing ensures your PIN is never stored in plaintext.

3. **Duress / Hidden PIN Protection ("Panic Decoy Mode")**:
   - If someone forces you to unlock a website, enter your secret Duress PIN.
   - **Simulate Connection Failure**: Instantly displays an authentic, pixel-perfect Chromium/Brave "This site can't be reached (ERR_CONNECTION_REFUSED)" error with a working reload simulation while keeping the original URL in the address bar. The intruder will believe the website or WiFi is genuinely offline!
   - **Decoy Redirect**: Optionally redirects immediately to Google, Wikipedia, or a custom decoy URL.
   - **Close Tab**: Instantly closes the active tab.

4. **Brave Browser Native Compatibility**:
   - Built with strict Manifest V3 compliance and isolated closed Shadow DOM.
   - Zero `eval()`, zero inline scripts, zero interference with Brave Shields, ad blockers, or tracker protections.

5. **One-Click Site Manager & Session Control**:
   - Quick lock/unlock toggle from the extension popup.
   - Customizable auto-relock timers (every visit, 5 min, 15 min, 1 hour, or browser restart).
   - "Lock All Now" emergency button.
   - Local, private security audit trail tracking unlock events and failed attempts.

---

## Permissions Justification

| Permission | Justification |
| :--- | :--- |
| `storage` | Required to securely persist user settings, salted SHA-256 passcode hashes, locked domains, and session expiration tokens locally on device. |
| `tabs` | Required to identify the active website domain in the extension popup for one-click locking, and to safely reload or navigate tabs when duress mode is activated. |
| `<all_urls>` (host permissions) | Required so the content script can protect any website or domain the user adds to their personal locked list (such as Instagram, WhatsApp Web, or any custom URL). |

---

## Privacy & Data Use

- **Data Collection**: None.
- **Network Requests**: None. SiteLock Guard makes zero external network calls and does not track, transmit, or monetize any browsing activity or personal information.
- **Local Storage**: All PIN hashes, blocklists, and security logs reside strictly inside the browser's local sandbox storage (`chrome.storage.local` and `chrome.storage.session`).

---

## How to Install in Brave / Chrome (Developer Mode)

1. Open your Brave or Chrome browser.
2. Navigate to `brave://extensions` (or `chrome://extensions`).
3. Turn on the **Developer mode** toggle in the top-right corner.
4. Click the **Load unpacked** button.
5. Select this folder:
   `/Users/krishyogi/Desktop/lock plugin`
6. The **SiteLock Guard** extension will appear in your extensions list and toolbar.
7. Click the extension icon to manage protected websites or open **Settings** to configure your Master and Duress PINs!

---

## Version History

- **v1.0.0** (Initial Release):
  - Manifest V3 architecture with closed Shadow DOM isolation.
  - Master PIN unlock with brute-force rate-limiting.
  - Duress / Hidden PIN with authentic Brave connection failure simulation and decoy redirect.
  - Pre-loaded domain blocklist with one-click toggles (Instagram, WhatsApp, X/Twitter, Reddit, Discord, etc.).
  - Auto-relock timeouts and local security activity log.

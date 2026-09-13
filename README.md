# 🛡️ SiteLock Guard — Advanced Privacy & Website Passcode Shield

> **Military-grade website lock extension engineered for Brave and Chromium browsers.** Lock sensitive web apps (Instagram, WhatsApp Web, Discord, X/Twitter, Reddit, financial dashboards, and custom domains) behind an impenetrable, zero-flicker numeric PIN shield with duress decoys, intruder video traps, and instant boss hotkeys.

---

## ✨ Features Overview

### 1. 🔒 Instant Zero-Flicker Lock Shield
- **`document_start` Injection**: Prevents even a single visual frame of your private messages, feeds, or dashboards from leaking before authorization.
- **Closed Shadow DOM**: Guarantees total CSS/JS isolation so the target website cannot detect, modify, or tamper with the lock shield.
- **Glassmorphic Cyberpunk Interface**: Featuring interactive mouse-following aurora glows, cosmic lighting mesh, and radiant unlock shockwave animations.
- **Web Crypto Salted SHA-256**: Passcodes are hashed with a unique cryptographic salt locally in browser memory—never stored in plaintext.

### 2. 🚨 Intruder Punishment Video Trap
- **Automatic Snooper Trap**: When an unauthorized snooper enters an incorrect passcode 4 times (configurable from 1 to 5 attempts), SiteLock Guard instantly launches a **100% True Native Fullscreen** video trap with controls locked.
- **Aspect-Ratio Cover Scaling**: Eliminates black pillarbox/letterbox bars on 16:10 MacBooks and ultra-wide displays—broken screen glitch covers the entire display edge-to-edge.
- **Owner Escape Hatch**: Double-tap <kbd>Esc</kbd> (<kbd>Esc</kbd> + <kbd>Esc</kbd> within 1.5s) or press <kbd>Shift</kbd> + <kbd>Esc</kbd> to exit fullscreen and cleanly return to the passcode shield.

### 3. ⚡ Panic / Boss Hotkey (<kbd>F3</kbd>)
- **Instant 1-Click Camouflage**: Pressing <kbd>F3</kbd> (or your custom hotkey) on any protected site immediately blacks out the page in `<1ms`, revokes your temporary unlock session, and teleports the tab to YouTube (or Google Docs, Wikipedia, etc.).
- **Anti-History Leak**: Uses history replacement so pressing the browser's Back button keeps the website strictly locked behind your PIN.

### 4. 🎭 Duress & Decoy Protection ("Fake Error Mode")
- If forced to unlock your screen in front of someone, type your secret **Duress PIN**:
  - **Authentic Network Error**: Instantly renders a pixel-perfect Chromium "This site can’t be reached (`ERR_CONNECTION_REFUSED`)" error while keeping the original URL in the address bar. Onlookers believe your internet or the site is genuinely offline!
  - **Decoy Redirect**: Optionally redirects to a safe decoy website (e.g. Google).
  - **Stealth Recovery Hatches**: Append `#unlock` to the URL, type your real PIN in thin air, or press <kbd>Shift</kbd> + <kbd>Esc</kbd> to disarm decoy mode silently.

### 5. 🌐 Universal Brand Logo Lock
- Built-in stealth triggers across **Instagram**, **WhatsApp Web**, **X / Twitter**, **Reddit**, **Discord**, and any protected website. Clicking the brand logo presents an instant lock micro-menu (`[🔒 Lock Now]`).

---

## 🚀 Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Hunter28-lucky/custom-lock-extension.git
   ```
2. Open your Chromium browser (**Brave**, **Google Chrome**, **Edge**, etc.):
   - Navigate to `brave://extensions` or `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `custom-lock-extension` folder.
6. Pin **SiteLock Guard** to your browser toolbar!

---

## 🔑 Default Credentials

| Credential | Default Value | Description |
| :--- | :--- | :--- |
| **Master PIN** | *Configured on Setup* | Universal passcode to unlock any protected site. |
| **Duress PIN** | *Configured on Setup* | Triggers fake network error or decoy redirect. |
| **Intruder Limit** | `4 Attempts` | Triggers full-screen punishment video trap. |
| **Boss Key** | `F3` | Instant blackout and safe site redirect. |

> **Recommendation**: Immediately open the extension **Options** panel and set your own unique Master and Duress PINs!

---

## 📂 Project Structure

```
custom-lock-extension/
├── manifest.json              # Chrome Manifest V3 configuration
├── background/
│   └── service-worker.js      # Background worker, crypto verification, window fullscreen
├── content/
│   └── lock-shield.js         # Zero-flicker content injection & closed Shadow DOM shield
├── popup/
│   ├── popup.html             # Toolbar quick control interface
│   ├── popup.css              # Cyberpunk dark mode styling
│   └── popup.js               # Popup controller & site status
├── options/
│   ├── options.html           # Comprehensive Security Admin Panel
│   ├── options.css            # Responsive settings dashboard styles
│   └── options.js             # PIN management, presets, and audit logs
├── icons/                     # Extension branding icons (16, 48, 128px)
└── README.md                  # Project documentation
```

---

## 🔒 Security & Privacy

- **100% Offline & Local**: Zero analytics, zero tracking, zero external server calls. All passcode hashes and configuration tokens are securely persisted in local encrypted browser sandbox storage (`chrome.storage.local`).
- **Manifest V3 Compliant**: Uses modern declarative web security standards with zero `eval()` and zero inline script risks.

---

## 📜 License

MIT License. Feel free to use, modify, and distribute for personal and commercial applications.

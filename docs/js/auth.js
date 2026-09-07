// Password gate.
//
// Everyday use: type the site password, nothing else. The GitHub token sits
// encrypted in vault.json and is decrypted by the password; it is then kept in
// this browser so the password is asked for once per machine.
//
// First run only: vault.json doesn't exist yet, so the gate asks for a token
// once and publishes the vault. After that nobody sees a token again.

import { getToken, setToken, clearToken, validateToken } from './github-api.js';
import { fetchVault, decryptToken, encryptToken, publishVault } from './vault.js';
import { t } from './i18n.js';

const SITE_REPO = 'yechezkelbinstok-dev/mivtzoim';

const MESSAGES = {
  invalid_token: 'token_invalid',
  no_access: 'token_no_access',
  network: 'token_network',
};

const message = (code) => (MESSAGES[code] ? t(MESSAGES[code]) : code);

export function initGate({ onAuthed }) {
  const overlay = document.getElementById('gateOverlay');
  const pw = document.getElementById('pwInput');
  const tokenRow = document.getElementById('setupRow');
  const tokenInput = document.getElementById('setupToken');
  const status = document.getElementById('gateStatus');
  const okBtn = document.getElementById('gateOk');
  const outBtn = document.getElementById('gateOut');
  const openBtn = document.getElementById('gateBtn');

  let vault = null;
  let setupMode = false;

  const setStatus = (text, cls) => {
    status.textContent = text;
    status.className = `status-label ${cls || ''}`;
  };

  const open = async () => {
    overlay.hidden = false;
    pw.value = '';
    tokenInput.value = '';
    setStatus('');
    vault = await fetchVault();
    setupMode = !vault;
    tokenRow.hidden = !setupMode;
    pw.focus();
  };

  const close = () => {
    overlay.hidden = true;
  };

  openBtn.addEventListener('click', open);

  outBtn.addEventListener('click', () => {
    clearToken();
    pw.value = '';
    setStatus('');
  });

  const submit = async () => {
    const password = pw.value.trim();
    if (!password) return;
    okBtn.disabled = true;
    setStatus('…');

    try {
      if (setupMode) {
        const token = tokenInput.value.trim();
        if (!token) {
          setStatus(t('token_invalid'), 'bad');
          return;
        }
        const check = await validateToken(token);
        if (!check.ok) {
          setStatus(message(check.message), 'bad');
          return;
        }
        await publishVault(await encryptToken(token, password), token, SITE_REPO);
        setToken(token);
        setStatus('✓', 'good');
        close();
        onAuthed();
        return;
      }

      const token = await decryptToken(vault, password);
      if (!token) {
        setStatus(t('wrong_password'), 'bad');
        return;
      }
      const check = await validateToken(token);
      if (!check.ok) {
        setStatus(message(check.message), 'bad');
        return;
      }
      setToken(token);
      setStatus('✓', 'good');
      close();
      onAuthed();
    } catch (e) {
      setStatus(e.message || t('token_network'), 'bad');
    } finally {
      okBtn.disabled = false;
    }
  };

  okBtn.addEventListener('click', submit);
  pw.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  return { open, close };
}

// True when this browser already holds a working token, so the password is
// asked for once per machine rather than every visit.
export async function ensureAuthed(ui) {
  const token = getToken();
  if (!token) {
    await ui.open();
    return false;
  }
  const res = await validateToken(token);
  if (!res.ok) {
    clearToken();
    await ui.open();
    return false;
  }
  return true;
}

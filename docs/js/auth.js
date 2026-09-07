// Token gate. The token is kept in localStorage on this machine only and is
// sent to api.github.com and nowhere else.

import { getToken, setToken, clearToken, validateToken } from './github-api.js';

const MESSAGES = {
  invalid_token: 'טוקן לא תקין',
  no_access: 'אין גישה',
  network: 'שגיאת רשת',
};

export function initTokenUI({ onAuthed }) {
  const overlay = document.getElementById('tokenOverlay');
  const input = document.getElementById('tokenInput');
  const status = document.getElementById('tokenStatus');
  const saveBtn = document.getElementById('tokenSave');
  const clearBtn = document.getElementById('tokenClear');
  const openBtn = document.getElementById('tokenBtn');

  const open = () => {
    overlay.hidden = false;
    input.value = getToken();
    status.textContent = '';
    status.className = 'status-label';
    input.focus();
  };
  const close = () => {
    overlay.hidden = true;
  };

  openBtn.addEventListener('click', open);

  clearBtn.addEventListener('click', () => {
    clearToken();
    input.value = '';
    status.textContent = '';
    status.className = 'status-label';
  });

  const submit = async () => {
    const token = input.value.trim();
    if (!token) return;
    saveBtn.disabled = true;
    status.className = 'status-label';
    status.textContent = '…';
    const res = await validateToken(token);
    saveBtn.disabled = false;
    if (res.ok) {
      setToken(token);
      status.className = 'status-label good';
      status.textContent = '✓';
      close();
      onAuthed();
    } else {
      status.className = 'status-label bad';
      status.textContent = MESSAGES[res.message] || res.message;
    }
  };

  saveBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  return { open, close };
}

export async function ensureAuthed(ui) {
  const token = getToken();
  if (!token) {
    ui.open();
    return false;
  }
  const res = await validateToken(token);
  if (!res.ok) {
    ui.open();
    const status = document.getElementById('tokenStatus');
    status.className = 'status-label bad';
    status.textContent = MESSAGES[res.message] || res.message;
    return false;
  }
  return true;
}

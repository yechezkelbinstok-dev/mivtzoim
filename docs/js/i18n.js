// UI language. Addresses and street names are never translated — they stay
// English and LTR in every language, as they are on the printed sheets.

const LANG_KEY = 'mivtzoim_lang';
export const LANGS = ['he', 'en'];

const STRINGS = {
  he: {
    dir: 'rtl',
    brand: 'מבצעים',
    nav_entry: 'רישום',
    nav_board: 'לוח',
    settings: 'הגדרות',
    language: 'שפה',

    save_saving: 'שומר',
    save_saved: 'נשמר',
    save_error: 'שגיאה',
    load_failed: 'טעינה נכשלה',

    search_address: 'חיפוש כתובת',

    answered_yes: 'ענו',
    answered_no: 'לא ענו',
    jewish_yes: 'יהודי',
    jewish_no: 'לא יהודי',
    interest: 'עניין',
    interest_none: 'בכלל לא',
    interest_some: 'קצת',
    interest_a_lot: 'הרבה',
    notes: 'הערות',
    save: 'שמור',
    skip: 'דלג',
    history: 'היסטוריה',
    route: 'חברותא',

    token: 'טוקן',
    sign_in: 'כניסה',
    sign_out: 'יציאה',
    wrong_password: 'סיסמה שגויה',
    ok: 'אישור',
    token_invalid: 'טוקן לא תקין',
    token_no_access: 'אין גישה',
    token_network: 'שגיאת רשת',

    addresses: 'כתובות',
    address: 'כתובת',
    list: 'רשימה',
    coverage: 'כיסוי',
    last_visit: 'ביקור אחרון',
    visits: 'ביקורים',
    cov_visited: 'ביקרו',
    cov_never: 'טרם ביקרו',
    all: 'הכל',
    f_list: '★ רשימה',
    f_kept: 'רלוונטי',
    f_everything: 'הכל כולל זמניות',
    f_cold: 'דלת חדשה',
    still_there: 'עדיין שם?',
    yes: 'כן',
    no: 'לא',
  },
  en: {
    dir: 'ltr',
    brand: 'Mivtzoim',
    nav_entry: 'Entry',
    nav_board: 'Board',
    settings: 'Settings',
    language: 'Language',

    save_saving: 'Saving',
    save_saved: 'Saved',
    save_error: 'Error',
    load_failed: 'Load failed',

    search_address: 'Search address',

    answered_yes: 'Answered',
    answered_no: 'No answer',
    jewish_yes: 'Jewish',
    jewish_no: 'Not Jewish',
    interest: 'Interest',
    interest_none: 'Not at all',
    interest_some: 'A little',
    interest_a_lot: 'A lot',
    notes: 'Notes',
    save: 'Save',
    skip: 'Skip',
    history: 'History',
    route: 'Chavrusa',

    token: 'Token',
    sign_in: 'Sign in',
    sign_out: 'Sign out',
    wrong_password: 'Wrong password',
    ok: 'OK',
    token_invalid: 'Invalid token',
    token_no_access: 'No access',
    token_network: 'Network error',

    addresses: 'Addresses',
    address: 'Address',
    list: 'List',
    coverage: 'Coverage',
    last_visit: 'Last visit',
    visits: 'Visits',
    cov_visited: 'Visited',
    cov_never: 'Never visited',
    all: 'All',
    f_list: '★ List',
    f_kept: 'Kept',
    f_everything: 'Everything',
    f_cold: 'New door',
    still_there: 'Still there?',
    yes: 'Yes',
    no: 'No',
  },
};

export function getLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // ignore
  }
  return 'he';
}

export function setLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // ignore
  }
}

export function t(key) {
  const lang = getLang();
  return (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.he[key] ?? key;
}

export function nextLang() {
  const i = LANGS.indexOf(getLang());
  return LANGS[(i + 1) % LANGS.length];
}

// Applies the current language to the document: direction, and every element
// carrying data-i18n / data-i18n-placeholder / data-i18n-title.
export function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = t('dir');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

// Wires the language picker inside the settings dialog. `onChange` redraws
// whatever the page renders dynamically.
export function initLangPicker(onChange) {
  applyLang();
  const wrap = document.getElementById('langPicker');
  if (!wrap) return;
  const mark = () =>
    wrap.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()))
    );
  mark();
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setLang(btn.dataset.lang);
    applyLang();
    mark();
    if (onChange) onChange();
  });
}

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
    lang_next: 'EN',

    save_saving: 'שומר',
    save_saved: 'נשמר',
    save_error: 'שגיאה',

    import: 'ייבוא',
    import_title: 'ייבוא מסלולים',
    import_none: 'אין שורות',
    import_replace: 'החלפת מסלולים',
    import_open: 'טרם נרשמו',
    cancel: 'ביטול',
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
    route: 'מסלול',

    token: 'טוקן',
    token_create: 'github.com',
    ok: 'אישור',
    clear: 'מחיקה',
    token_invalid: 'טוקן לא תקין',
    token_no_access: 'אין גישה',
    token_network: 'שגיאת רשת',

    addresses: 'כתובות',
    address: 'כתובת',
    list: 'רשימה',
    coverage: 'כיסוי',
    last_visit: 'ביקור אחרון',
    visits: 'ביקורים',
    cov_fresh: 'עדכני',
    cov_stale: 'מתיישן',
    cov_old: 'ישן',
    cov_never: 'טרם',
    all: 'הכל',
    f_list: '★ רשימה',
    f_cold: 'דלת חדשה',
  },
  en: {
    dir: 'ltr',
    brand: 'Mivtzoim',
    nav_entry: 'Entry',
    nav_board: 'Board',
    lang_next: 'עב',

    save_saving: 'Saving',
    save_saved: 'Saved',
    save_error: 'Error',

    import: 'Import',
    import_title: 'Import routes',
    import_none: 'No rows',
    import_replace: 'Replace routes',
    import_open: 'not yet entered',
    cancel: 'Cancel',
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
    route: 'Route',

    token: 'Token',
    token_create: 'github.com',
    ok: 'OK',
    clear: 'Clear',
    token_invalid: 'Invalid token',
    token_no_access: 'No access',
    token_network: 'Network error',

    addresses: 'Addresses',
    address: 'Address',
    list: 'List',
    coverage: 'Coverage',
    last_visit: 'Last visit',
    visits: 'Visits',
    cov_fresh: 'Recent',
    cov_stale: 'Aging',
    cov_old: 'Old',
    cov_never: 'Never',
    all: 'All',
    f_list: '★ List',
    f_cold: 'New door',
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

// Wires the header toggle. `onChange` re-renders whatever the page draws
// dynamically.
export function initLangToggle(onChange) {
  const btn = document.getElementById('langBtn');
  applyLang();
  if (!btn) return;
  btn.addEventListener('click', () => {
    setLang(nextLang());
    applyLang();
    if (onChange) onChange();
  });
}

/**
 * The word, in as many writing systems as the stack can carry.
 *
 * This list is the single source of truth. `site/scripts/bake-chorus.mts` reads
 * it, asks every face what it can actually draw, and bakes each one to exactly
 * the glyphs it ends up owning. Add or change a word and re-run the bake —
 * nothing here needs to know which font will carry it, and the script fails
 * loudly naming the code points if none can.
 *
 * Interleaving these in one stream is not decoration. Latin next to Arabic and
 * Hebrew forces the bidi algorithm to resolve direction runs on every line, the
 * Indic entries need reordering and conjuncts, Arabic needs cursive joining, and
 * the CJK pairs carry no spaces to break at. The field is a shaping proof that
 * happens to read as typography.
 */
export const WORDS = [
  // Latin
  'glyph',
  'glifo',
  'glyphe',
  'Glyphe',
  'glif',
  'glýf',
  'kirjain',
  'tecken',
  'harf',
  'chữ',
  'znak',
  'litera',
  'jel',
  'glifă',
  'písmo',
  'raide',
  // Greek and Cyrillic
  'γλυφή',
  'γράμμα',
  'глиф',
  'гліф',
  'буква',
  'знак',
  // Right-to-left
  'حرف',
  'نويسه',
  'ٹائپ',
  'אות',
  'שריטה',
  // Indic
  'अक्षर',
  'वर्ण',
  'অক্ষর',
  'ਅੱਖਰ',
  'અક્ષર',
  'ଅକ୍ଷର',
  'எழுத்து',
  'అక్షరం',
  'ಅಕ್ಷರ',
  'അക്ഷരം',
  'අකුර',
  // South-east Asia
  'อักขระ',
  'ຕົວອັກສອນ',
  'អក្សរ',
  'စာလုံး',
  // Caucasus and Horn of Africa
  'ასო',
  'տառ',
  'ፊደል',
  // CJK
  '文字',
  '字形',
  '글자',
  '글리프',
] as const;

/**
 * The subset that reorders. Bidi resolves these correctly inside the stream, but
 * a right-to-left run inside a left-to-right justified line reads as a jump, and
 * too many of them make the field look mis-spaced rather than multilingual. The
 * chorus meters how often one is drawn instead of dropping them: their presence
 * is the point, their density is a matter of taste.
 */
export const RTL_WORDS: ReadonlySet<string> = new Set(['حرف', 'نويسه', 'ٹائپ', 'אות', 'שריטה']);

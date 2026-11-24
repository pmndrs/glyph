/**
 * The spread's copy and its geometry. Lengths are world units on the page plane: the page's upper-left corner is
 * the origin of page space, x runs right and y runs down, as paragraph coordinates do.
 */

export const HEADLINE = 'The Living Page';

export const KICKER = 'GLYPH 0.2  /  TYPOGRAPHY AT GPU SPEED';

export const STANDFIRST =
  'Real letters in every script, laid out and edited live. Drag a column, drop a dead star into the text, ' +
  'type anywhere: the page answers inside a frame.';

export const PULL_QUOTE = '“A page is not a picture of text. It is text, deciding where to stand.”';

export const PULL_CREDIT = 'FROM THE ESSAY';

/** Paragraphs of the essay. The first letter is the drop cap the camera dives through, so it keeps its counter. */
const PARAGRAPHS = [
  'Once, a page was a fixed thing. A compositor stood at the case with a stick in one hand and lifted the sorts ' +
    'out one at a time, letter by letter and space by space, until the line was tight enough to be carried without ' +
    'spilling. Then the line was locked into the forme with its neighbours, inked, and pressed, and from that moment ' +
    'nothing on it could move again. Every decision the page contained had been made once, by a person, with lead. ' +
    'The measure was the width of the stick. The gutter was a strip of furniture. The justification was a handful of ' +
    'thin brass spaces pushed in until the line stopped rattling.',
  'We kept that picture long after the lead was gone. Phototype set the same lines on film, and the first screens ' +
    'drew them again in phosphor, and each time the machine was faster and the idea was the same: decide where the ' +
    'letters go, then draw what was decided. A paragraph became a photograph of itself. It could be scaled, and ' +
    'copied, and sent across the world in an instant, and still it could not be touched. Ask it to be a little ' +
    'narrower and it had to be composed again from the first word, somewhere out of sight, while the reader waited.',
  'The trouble is that text was never a picture. A line of type is the visible end of a long argument between the ' +
    'writing system, the typeface and the space on offer. The letters of this sentence are an easy case: they stand ' +
    'beside one another in the order they are read, and a pair of them now and then asks to sit closer, the way a T ' +
    'shelters the o that follows it. Most of the world writes with more at stake. Arabic joins its letters, and each ' +
    'one takes a different shape depending on who its neighbours are; it runs from the right, and when a number or a ' +
    'foreign name turns up in the middle of the line the direction folds back on itself and then recovers. Devanagari ' +
    'gathers consonants into conjuncts and hangs the whole word from a single headstroke. Thai stacks vowels and tone ' +
    'marks above and below a base and leaves no space between words at all, so that finding a place to break the line ' +
    'means knowing the language. Japanese sets three scripts in a row and forbids certain characters from ever ' +
    'starting a line or ending one.',
  'None of that can be faked with a table of letter widths. It has to be shaped: the text is handed to the font ' +
    'itself, which holds the rules its designer wrote, and the font hands back the true glyphs in their true places. ' +
    'Shaping is the honest part of typography, and it is expensive, and for a long time the bargain on a graphics ' +
    'card was to give it up. Real time meant a strip of Latin capitals pasted to a quad, or a texture baked ahead of ' +
    'time that fell apart the moment anyone zoomed in. Words that mattered were left to the document underneath, in ' +
    'another layer, on another clock.',
  'This page is drawn the other way round. Nothing here was laid out in advance. The essay you are reading is one ' +
    'run of text flowing through a few rectangles, and those rectangles are free to change in every frame. Take hold ' +
    'of a gutter and pull. The measure narrows, and every line below your hand is broken again, justified again and ' +
    'set again before the next frame is shown: not an animation of a reflow, but the reflow itself, sixty times a ' +
    'second, with the spaces opening and closing between the words as a compositor would have spaced them. Let go, ' +
    'and the letters that had to travel arrive a moment late and settle, because each one knows where it was and ' +
    'where it now belongs.',
  'Put something heavy on the page and the text makes room. The shape is handed to the layout as a region that ' +
    'words may not enter, and the lines part around it and close up behind it, like water round a stone. Move the ' +
    'stone and they follow. There is no mask, and nothing is hidden underneath: the words in the way have simply ' +
    'gone to stand somewhere else, and every one of them is still a word that can be found, selected and read aloud.',
  'Come closer than a stone allows. Each of these letters is drawn from its outline, the same curves the type ' +
    'designer drew, solved again for every pixel that the letter covers. That is why there is no size at which the ' +
    'edge turns soft, and no distance from which it shimmers. It is also why a letter can be more than ink. An ' +
    'outline is geometry, and geometry can be lit, bent by a lens, pulled out of its line and thrown. A glyph taken ' +
    'from the paragraph keeps its identity: remove it, and the paragraph closes over the gap as it would for any ' +
    'edit; return it, and the gap opens exactly where it should, because the text beneath the picture was never out ' +
    'of date.',
  'Editing is the same act at a smaller scale. A click falls between two letters, and the layout is asked which two. ' +
    'Inside a line of Latin that is a matter of measuring. Inside an Arabic word set in an English sentence it is a ' +
    'small puzzle, because the caret has one position in the text and may have two on the screen, one for each ' +
    'direction of travel. The answer comes back from the same engine that set the line, so it cannot disagree with ' +
    'what is drawn. Type a character and only what has to move is moved. The rest of the page does not notice.',
  'Watch the spaces while it happens. Justified type is a negotiation carried out in the gaps between words: every ' +
    'line has to reach both margins, and the only slack is the white. Stretch it too far and the gaps line up down ' +
    'the column into the pale channels that printers call rivers; squeeze it and the words run together into a ' +
    'grey bar. A careful hand would weigh each line against its neighbours, and move a word up or down to spare the ' +
    'worst of them. The engine weighs them too, and it does so again whenever the measure changes by the width of ' +
    'a hair, which is why the text does not jump from one arrangement to the next but seems to breathe.',
  'There is an arithmetic underneath. A frame is a little under seventeen thousandths of a second, and most of it ' +
    'is already spoken for. Whatever the page wants to decide has to be decided in a millisecond or two: which ' +
    'glyphs, in which order, broken where, spaced how. That budget is the reason so much of the work is kept. ' +
    'Shaping is remembered from one frame to the next, so that a gutter moving does not ask the font the same ' +
    'questions twice, and a change in one place disturbs only what follows from it. A line that still fits is left ' +
    'alone. A column the stone has not reached is not set again. The page is fast in the way a good workshop is ' +
    'fast: by never doing the same job twice.',
  'And it stays text the whole time. This matters more than it sounds. A picture of a paragraph can be admired, ' +
    'but it cannot be searched, or translated, or read out to someone who cannot see it, or copied into a letter. ' +
    'Every glyph on this page still answers to a character in a string, and the string is still the truth. When a ' +
    'letter is flung across the spread it has left the line but not the language: the sentence it came from knows ' +
    'what is missing and where, and will have it back.',
  'It is tempting to call all this an effect, and to file it with the lens flares. But the effects are the least of ' +
    'it. What changes when the page becomes fast enough to be live is who gets to make the decisions. The compositor ' +
    'made them once, for everybody. A live page makes them again for each reader: for this width, this language, this ' +
    'hand on the glass. It can be wide when the room is wide. It can step aside for a picture and return when the ' +
    'picture leaves. It can be corrected while it is being read.',
  'So the page is no longer the place where a text goes to hold still. It is a small machine for standing letters ' +
    'up, and it runs the whole time you look at it. The old constraints are still here, and they are still the craft: ' +
    'a measure that the eye can cross without losing its place, an even colour down the column, a break that falls ' +
    'where the sense allows. They are simply being honoured continuously now, the way a good compositor would have ' +
    'honoured them given unlimited patience and a stick that could change its width while the line was in it.',
  'Lean in. Somewhere near the top of this column a caret is blinking, and it is waiting for you.',
] as const;

/** A paragraph after the first opens with an em quad, the compositor's indent, since the flow is one source. */
export const BODY = PARAGRAPHS.join('\n ');

/** The sentence the attract loop types after the body's last full stop, and takes out again when it loops. */
export const TYPED_LINE = ' Go on: it is listening.';

export const SIDEBAR_TITLE = 'EVERY SCRIPT, SHAPED';

/** One specimen: its label, its text, and where the attract loop's click lands, as an offset into the text. */
export interface Specimen {
  readonly label: string;
  readonly script: 'latin' | 'arabic' | 'devanagari' | 'thai' | 'japanese';
  readonly text: string;
  readonly direction: 'ltr' | 'rtl';
  readonly language: string;
}

export const SPECIMENS: readonly Specimen[] = [
  {
    label: 'ARABIC INSIDE LATIN  /  BIDI',
    script: 'latin',
    text: 'The word for a book is كتاب, and it is read the other way.',
    direction: 'ltr',
    language: 'en',
  },
  {
    label: 'ARABIC  /  JOINING, RIGHT TO LEFT',
    script: 'arabic',
    text: 'الخطّ هندسة روحانية ظهرت بآلة جسمانية',
    direction: 'rtl',
    language: 'ar',
  },
  {
    label: 'DEVANAGARI  /  CONJUNCTS',
    script: 'devanagari',
    text: 'अक्षर वह है जो नष्ट नहीं होता।',
    direction: 'ltr',
    language: 'hi',
  },
  {
    label: 'THAI  /  STACKED MARKS, NO SPACES',
    script: 'thai',
    text: 'ตัวอักษรคือเสียงที่มองเห็นได้',
    direction: 'ltr',
    language: 'th',
  },
  {
    label: 'JAPANESE  /  NO SPACES, KINSOKU',
    script: 'japanese',
    text: '文字組版では、空白なしでも自然に改行します。',
    direction: 'ltr',
    language: 'ja',
  },
];

/** Words in everything the spread sets, for the readout. */
export const WORD_COUNT = [HEADLINE, KICKER, STANDFIRST, PULL_QUOTE, BODY, ...SPECIMENS.map(({ text }) => text)]
  .join(' ')
  .split(/\s+/u)
  .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** The page: a landscape spread. */
export const PAGE = { width: 40, height: 26 } as const;

/** Where the body's flow sits on the page, and the type it is set in. */
export const BODY_BOX = { left: 2.2, top: 8.1, right: 29.6, bottom: 24.4 } as const;
export const BODY_TYPE = { fontSize: 0.262, lineHeight: 1.42 } as const;
export const GUTTER = 0.86;

/** The sidebar's column. */
export const SIDEBAR_BOX = { left: 31.4, top: 8.1, right: 37.8, bottom: 24.4 } as const;

/**
 * The pull quote: centred on the body at this share of its height, as wide as one column, padded above and below.
 */
export const PULL_BOX = { centerX: 0.5, top: 0.27, padding: 0.34 } as const;
export const PULL_TYPE = { fontSize: 0.66, lineHeight: 1.16 } as const;

/** Column counts the page may take, and the one it opens with. */
export const COLUMN_RANGE = { min: 1, max: 5, initial: 3 } as const;

/** Ink colours: warm white stock ink, a dimmer second voice, and the accent. */
export const INK = '#efe9dc';
export const INK_DIM = '#8d877b';
export const ACCENT = '#ff6a3d';

/** Where the fixed texts sit, in page units. */
export const KICKER_AT = { x: 2.25, y: 1.3, fontSize: 0.27 } as const;
export const HEADLINE_AT = { x: 2.0, y: 1.75, fontSize: 4.05 } as const;
export const STANDFIRST_AT = { x: 2.25, y: 6.25, fontSize: 0.5, width: 21 } as const;
export const SPECIMEN_AT = { top: 9.3, pitch: 3.02, label: 0.19, fontSize: 0.6 } as const;

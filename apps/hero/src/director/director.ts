/** Beats run intro → break → rewind → type → hold, then next() returns to intro. */
export type Beat = 'intro' | 'break' | 'rewind' | 'type' | 'hold';

/** Normalized device coordinates, -1..1. */
export interface Aim {
  readonly x: number;
  readonly y: number;
}

export interface DirectorState {
  readonly beat: Beat;
  /** Real seconds since the current beat began. */
  readonly beatTime: number;
  /** Accumulated scene (shader) seconds: realDt × timeScale per tick; never reset. */
  readonly sceneTime: number;
  /** 1 except during the impact ramp in 'break'. */
  readonly timeScale: number;
  /** 0..1 glitch intensity for post-processing. */
  readonly cut: number;
  /** Text for the typed line, scripted or live-typed. */
  readonly headline: string;
  /** How many UTF-16 code units of `headline` are revealed: 0 before 'type', all of it in 'hold'. */
  readonly typedCount: number;
  readonly liveTyping: boolean;
  /** Launch target, set by launch() and cleared when intro starts; undefined selects the default aim. */
  readonly aim: Aim | undefined;
  /** Increments whenever `beat` changes or reset() runs, so React can remount a beat. */
  readonly revision: number;
}

/** Visual length of the title spring in seconds. It drives no transition: intro ends at LAUNCH_AT. */
export const INTRO_SECONDS = 1.2;
/** Real seconds into intro at which the director launches on its own. */
export const LAUNCH_AT = 0.5;
/** Characters per real second in scripted typing. */
export const TYPE_RATE = 24;
export const IMPACT_SLOW_SCALE = 0.08;
/** Seconds to ramp timeScale from 1 to IMPACT_SLOW_SCALE. */
export const IMPACT_RAMP_IN = 0.08;
/** Seconds held at IMPACT_SLOW_SCALE. */
export const IMPACT_HOLD = 1.2;
/** Seconds to ease timeScale from IMPACT_SLOW_SCALE back to 1. */
export const IMPACT_RAMP_OUT = 0.3;
export const CUT_FLASH_SECONDS = 0.12;
export const REWIND_CUT = 0.6;

type Phase =
  | { readonly beat: 'intro' }
  | { readonly beat: 'break'; readonly sinceContact: number | undefined }
  | { readonly beat: 'rewind' }
  | { readonly beat: 'type' }
  | { readonly beat: 'hold' };

const FLASHES_ON_ENTRY: Readonly<Record<Beat, boolean>> = {
  intro: true,
  break: false,
  rewind: true,
  type: true,
  hold: false,
};

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** timeScale as a function of real seconds since the first contact of a break. */
function impactTimeScale(sinceContact: number | undefined): number {
  if (sinceContact === undefined) return 1;
  if (sinceContact < IMPACT_RAMP_IN) return lerp(1, IMPACT_SLOW_SCALE, smoothstep(sinceContact / IMPACT_RAMP_IN));
  const sinceHoldEnd = sinceContact - IMPACT_RAMP_IN - IMPACT_HOLD;
  if (sinceHoldEnd < 0) return IMPACT_SLOW_SCALE;
  if (sinceHoldEnd < IMPACT_RAMP_OUT) return lerp(IMPACT_SLOW_SCALE, 1, easeOutCubic(sinceHoldEnd / IMPACT_RAMP_OUT));
  return 1;
}

function flashEnvelope(sinceFlash: number): number {
  return Math.max(0, 1 - sinceFlash / CUT_FLASH_SECONDS);
}

export class Director {
  readonly #scriptedHeadline: string;
  #phase: Phase = { beat: 'intro' };
  #headline: string;
  #liveTyping = false;
  #aim: Aim | undefined;
  #beatTime = 0;
  #sceneTime = 0;
  #sinceFlash = 0;
  #revision = 0;
  #snapshot: DirectorState | undefined;

  constructor(scriptedHeadline: string) {
    this.#scriptedHeadline = scriptedHeadline;
    this.#headline = scriptedHeadline;
  }

  /** A frozen snapshot, rebuilt after any call and the same object until then (safe for useSyncExternalStore). */
  get state(): DirectorState {
    this.#snapshot ??= Object.freeze({
      beat: this.#phase.beat,
      beatTime: this.#beatTime,
      sceneTime: this.#sceneTime,
      timeScale: this.#timeScale(),
      cut: this.#cut(),
      headline: this.#headline,
      typedCount: this.#typedCount(),
      liveTyping: this.#liveTyping,
      aim: this.#aim,
      revision: this.#revision,
    });
    return this.#snapshot;
  }

  tick(realDt: number): void {
    if (!Number.isFinite(realDt) || realDt < 0) {
      throw new RangeError(`realDt must be a finite, non-negative number of seconds; received ${realDt}`);
    }
    this.#snapshot = undefined;
    this.#beatTime += realDt;
    this.#sinceFlash += realDt;
    const phase = this.#phase;
    if (phase.beat === 'break' && phase.sinceContact !== undefined) {
      this.#phase = { ...phase, sinceContact: phase.sinceContact + realDt };
    }
    // Integrates the timeScale this tick reports, so sceneTime and timeScale agree frame by frame.
    this.#sceneTime += realDt * this.#timeScale();
    if (phase.beat === 'intro' && this.#beatTime >= LAUNCH_AT) this.#launch(undefined);
    else if (phase.beat === 'type' && !this.#liveTyping && this.#scriptedReveal() >= this.#headline.length) {
      this.#enter({ beat: 'hold' });
    }
  }

  next(): void {
    this.#snapshot = undefined;
    switch (this.#phase.beat) {
      case 'intro':
        this.#launch(undefined);
        return;
      case 'type':
        if (!this.#liveTyping || this.#headline.length > 0) this.#enter({ beat: 'hold' });
        return;
      case 'hold':
        this.#enterIntro();
        return;
      case 'break':
      case 'rewind':
        return;
    }
  }

  reset(): void {
    this.#snapshot = undefined;
    this.#enterIntro();
  }

  launch(aim: Aim | undefined): void {
    this.#snapshot = undefined;
    if (this.#phase.beat === 'intro') this.#launch(aim);
  }

  contact(): void {
    this.#snapshot = undefined;
    const phase = this.#phase;
    if (phase.beat !== 'break' || phase.sinceContact !== undefined) return;
    this.#phase = { ...phase, sinceContact: 0 };
    this.#sinceFlash = 0;
  }

  recordingComplete(): void {
    this.#snapshot = undefined;
    if (this.#phase.beat === 'break') this.#enter({ beat: 'rewind' });
  }

  rewindComplete(): void {
    this.#snapshot = undefined;
    if (this.#phase.beat === 'rewind') {
      this.#headline = this.#typeEntryHeadline();
      this.#enter({ beat: 'type' });
    }
  }

  toggleLiveTyping(): void {
    this.#snapshot = undefined;
    this.#liveTyping = !this.#liveTyping;
    // Restarting 'type' keeps its revision: the beat is unchanged, only its text source.
    if (this.#phase.beat === 'type') {
      this.#beatTime = 0;
      this.#headline = this.#typeEntryHeadline();
    }
  }

  typeCharacter(text: string): void {
    this.#snapshot = undefined;
    if (this.#acceptsKeystrokes()) this.#headline += text;
  }

  backspace(): void {
    this.#snapshot = undefined;
    if (this.#acceptsKeystrokes()) this.#headline = this.#headline.slice(0, -1);
  }

  #enter(phase: Phase): void {
    this.#phase = phase;
    this.#beatTime = 0;
    this.#revision += 1;
    if (FLASHES_ON_ENTRY[phase.beat]) this.#sinceFlash = 0;
  }

  #enterIntro(): void {
    this.#aim = undefined;
    if (!this.#liveTyping) this.#headline = this.#scriptedHeadline;
    this.#enter({ beat: 'intro' });
  }

  #launch(aim: Aim | undefined): void {
    this.#aim = aim;
    this.#enter({ beat: 'break', sinceContact: undefined });
  }

  #typeEntryHeadline(): string {
    return this.#liveTyping ? '' : this.#scriptedHeadline;
  }

  #acceptsKeystrokes(): boolean {
    return this.#liveTyping && this.#phase.beat === 'type';
  }

  /** Characters scripted typing has revealed so far in 'type', unclamped. */
  #scriptedReveal(): number {
    return Math.floor(this.#beatTime * TYPE_RATE);
  }

  #typedCount(): number {
    const length = this.#headline.length;
    switch (this.#phase.beat) {
      case 'intro':
      case 'break':
      case 'rewind':
        return 0;
      case 'type':
        return this.#liveTyping ? length : Math.min(length, this.#scriptedReveal());
      case 'hold':
        return length;
    }
  }

  #timeScale(): number {
    const phase = this.#phase;
    return phase.beat === 'break' ? impactTimeScale(phase.sinceContact) : 1;
  }

  #cut(): number {
    const flash = flashEnvelope(this.#sinceFlash);
    return this.#phase.beat === 'rewind' ? Math.max(flash, REWIND_CUT) : flash;
  }
}

// A round keeps submitted occurrences stable. Only unanswered retry slots change.
export type RoundEntry<T> = {
  id: string;
  value: T;
  key: string;
  retry: boolean;
  correct?: boolean;
  answer?: string;
  rating?: string;
  revision: number;
};

export class PracticeRound<T> {
  entries: RoundEntry<T>[] = [];
  cursor = 0;
  private key: (value: T) => string;
  private id: () => string;

  constructor(key: (value: T) => string, id = () => crypto.randomUUID()) {
    this.key = key;
    this.id = id;
  }

  start(values: readonly T[]) {
    this.entries = values.map((value) => this.entry(value, false));
    this.cursor = 0;
  }

  private entry(value: T, retry: boolean): RoundEntry<T> {
    return { id: this.id(), value, key: this.key(value), retry, revision: 0 };
  }

  get current() {
    return this.entries[this.cursor];
  }
  get completed() {
    return this.entries.filter((e) => e.correct !== undefined).length;
  }
  get correct() {
    return this.entries.filter((e) => e.correct === true).length;
  }
  get remaining() {
    return this.entries.length - this.completed;
  }

  settle(
    id: string,
    correct: boolean,
    revision = 0,
    answer?: string,
    rating?: string,
  ) {
    const target = this.entries.find((e) => e.id === id);
    if (!target) return false; // A restored delivery may belong to a previous round.
    target.correct = correct;
    target.revision = revision;
    if (answer !== undefined) target.answer = answer;
    if (rating !== undefined) target.rating = rating;
    const currentId = this.current?.id;
    const latest = new Map<string, RoundEntry<T>>();
    for (const e of this.entries)
      if (e.correct !== undefined) latest.set(e.key, e);
    this.entries = this.entries.filter(
      (e) =>
        !e.retry ||
        e.correct !== undefined ||
        latest.get(e.key)?.correct === false,
    );
    for (const [key, e] of latest) {
      if (
        e.correct === false &&
        !this.entries.some((q) => q.key === key && q.correct === undefined)
      )
        this.entries.push(this.entry(e.value, true));
    }
    const position = this.entries.findIndex((e) => e.id === currentId);
    this.cursor =
      position < 0 ? Math.min(this.cursor, this.entries.length) : position;
    return true;
  }

  previous() {
    if (this.cursor === 0) return false;
    this.cursor--;
    return true;
  }

  next() {
    if (this.current?.correct === undefined) return false;
    this.cursor++;
    return true;
  }

  remove(predicate: (value: T) => boolean) {
    const currentId = this.current?.id;
    const before = this.entries
      .slice(0, this.cursor)
      .filter((e) => !predicate(e.value)).length;
    this.entries = this.entries.filter((e) => !predicate(e.value));
    const position = this.entries.findIndex((e) => e.id === currentId);
    this.cursor = position < 0 ? before : position;
  }
}

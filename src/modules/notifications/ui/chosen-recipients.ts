import { foldName } from "@/modules/registrations/domain/name-fold";

/**
 * «Doar anumiți participanți» (§NNN), the composer's list without the browser: who a typed name finds, which ticks a
 * refused send hands back, and what a tick changes. The island (`ChosenRecipients.tsx`) draws what these answer, so the
 * rules are tested in Node.
 */

/** One line of the list, worded on the server: the registration's id, the name of record, its state, and a test row's mark. */
export type ChoosablePerson = { id: string; name: string; state: string; test: boolean };

/**
 * The people whose name holds what was typed, in the list's own order. A name is compared as every name here is
 * (`foldName`): case, diacritics, spacing and the shape of an apostrophe forgiven — «stef» finds «Ștefan» — and each
 * typed word must be in the name, in any order, so «popescu ana» finds «Ana Popescu». Nothing typed finds everybody.
 */
export function matchingPeople(people: readonly ChoosablePerson[], typed: string): readonly ChoosablePerson[] {
  const words = foldName(typed).split(" ").filter(Boolean);
  if (words.length === 0) return people;
  return people.filter((person) => {
    const name = foldName(person.name);
    return words.every((word) => name.includes(word));
  });
}

/**
 * The ticks the form starts with: the ones a refused send posted (§315), kept to the people still on the list — a
 * registration cancelled meanwhile is no longer there to be ticked. No refusal, no ticks.
 */
export function recalledPicks(people: readonly ChoosablePerson[], posted: readonly string[] | undefined): ReadonlySet<string> {
  if (!posted || posted.length === 0) return new Set();
  const listed = new Set(people.map((person) => person.id));
  return new Set(posted.filter((id) => listed.has(id)));
}

/** The ticks after one box changed: a new set, so the island's state changes with it. */
export function withPick(picked: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(picked);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/** The people ticked, in the list's order — the names the composer says back before the press, and the fields it posts. */
export function pickedPeople(people: readonly ChoosablePerson[], picked: ReadonlySet<string>): readonly ChoosablePerson[] {
  return people.filter((person) => picked.has(person.id));
}

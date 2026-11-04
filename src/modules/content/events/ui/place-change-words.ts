import { getTranslations } from "next-intl/server";
import type { PlaceChangeWords, PlaceEffectKey } from "../domain/place-changes";

const EFFECT_KEYS: readonly PlaceEffectKey[] = [
  "belowTaken",
  "keptAbove",
  "uncapped",
  "free",
  "freeSplit",
  "offers",
  "nobodyAuto",
  "doorDirect",
  "doorWaitlist",
  "doorFull",
  "doorListFull",
  "doorOffersOnly",
  "doorShut",
  "datesClosed",
  "releaseAt",
  "releasePassed",
  "releaseNoEffect",
  "releaseOff",
  "releaseRan",
  "alertOn",
  "alertOff",
];

/**
 * The words of the place settings' summary (§NNN), translated on the server and handed to the browser as strings with
 * their `{name}`s (`t.raw`): the browser fills them at the press (`domain/place-changes.ts#placeChangeLines`). Each
 * setting is named by the editor's own label, so the summary says the box the reader just changed.
 */
export async function placeChangeWords(): Promise<PlaceChangeWords> {
  const t = await getTranslations("Admin");
  const raw = (key: string) => t.raw(key) as string;
  return {
    title: t("confirm.places.title"),
    intro: t("confirm.places.intro"),
    line: raw("confirm.places.line"),
    labels: {
      capacity: t("editor.capacity"),
      placesKeptForClub: t("editor.placesKeptForClub"),
      waitlistCapacity: t("editor.waitlistMode"),
      waitlistAutoOffer: t("editor.waitlistAutoOffer"),
      publicRegistrationOpen: t("editor.publicRegistrationOpen"),
      freePlacesByOfferOnly: t("editor.freePlacesByOfferOnly"),
      releaseUnsignedAtDeadline: t("editor.releaseUnsignedAtDeadline"),
      placesAlertAt: t("editor.placesAlertAt"),
      confirmationOpensDaysBefore: t("editor.confirmationOpensDaysBefore"),
      confirmationDeadlineDaysBefore: t("editor.confirmationDeadlineDaysBefore"),
    },
    empty: t("confirm.places.empty"),
    unlimited: t("confirm.places.unlimited"),
    ticked: t("confirm.places.ticked"),
    unticked: t("confirm.places.unticked"),
    autoYes: t("editor.waitlistAutoOfferYes"),
    autoNo: t("editor.waitlistAutoOfferNo"),
    noWaitlist: t("editor.waitlistModeChoices.NONE"),
    effects: Object.fromEntries(EFFECT_KEYS.map((key) => [key, raw(`confirm.places.effects.${key}`)])) as Record<PlaceEffectKey, string>,
  };
}

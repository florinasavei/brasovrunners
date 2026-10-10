"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  createTeamMember,
  deleteTeamMember,
  moveTeamMember,
  saveTeamMember,
  setTeamMemberVisible,
} from "@/modules/content/team/service";
import { createTeamBox, deleteTeamBox, moveTeamBox, saveTeamBox, setTeamBoxVisible } from "@/modules/content/team/boxes";
import { teamLinkRowsOf } from "@/modules/content/team/links";
import { saveTeamPageIntro, setTeamPagePublished } from "@/modules/content/team/page-settings";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The writes of «Echipa» (§459), the pages actions' shape: every outcome is a redirect to the
 * screen carrying a language-neutral code, except a refused add or save, which returns so every
 * box comes back as typed (§315). Every one asserts its own role in the service (BR-REQ-060-01).
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A rich text's JSON as the editor posts it, or absent when the form carried no editor for it. */
function body(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

function fieldsOf(form: FormData) {
  return {
    name: text(form, "name"),
    roleRo: text(form, "roleRo"),
    roleEn: text(form, "roleEn"),
    // The words about the person, from the rich-text editor (§474).
    bioRoBody: body(form, "bioRoBody"),
    bioEnBody: body(form, "bioEnBody"),
    links: teamLinkRowsOf(form),
    photoAssetId: text(form, "photoAssetId"),
    // The part of the photograph the card shows, as the crop box drew it (§541).
    photoCrop: text(form, "photoCrop"),
    // The organisational chart (§691): the sub-role, the responsibilities, whom the card answers to and where it sits.
    subtitleRo: text(form, "subtitleRo"),
    subtitleEn: text(form, "subtitleEn"),
    responsibilitiesRo: text(form, "responsibilitiesRo"),
    responsibilitiesEn: text(form, "responsibilitiesEn"),
    reportsToId: text(form, "reportsToId"),
    placement: text(form, "placement") === "beside" ? "beside" : "below",
  };
}

/** A box's boxes (§691): the title in both languages and the rich text as the editor posts it. */
function boxFieldsOf(form: FormData) {
  return {
    titleRo: text(form, "titleRo"),
    titleEn: text(form, "titleEn"),
    bodyRoBody: body(form, "bodyRoBody"),
    bodyEnBody: body(form, "bodyEnBody"),
  };
}

function screen(form: FormData): string {
  return getPathname({ locale: toLocale(form.get("uiLocale")), href: "/admin/pages/team" });
}

async function backTo(path: string, outcome: { error?: string; saved?: string }, anchor = "admin-alert"): Promise<never> {
  await flashOutcome(outcome);
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved ?? "1"}`;
  redirect(`${path}${query}#${anchor}`);
}

function outcomeOf(error: unknown): { error: string } {
  if (!isDomainError(error)) throw error;
  return { error: error.code };
}

export async function createTeamMemberAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let id: string;
  try {
    const actor = await requireStaff();
    const created = await createTeamMember(getDb(), { actor, fields: fieldsOf(form) });
    id = created.id;
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "teamMemberCreated" }, `team-${id}`);
}

export async function saveTeamMemberAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const memberId = text(form, "memberId");
  try {
    const actor = await requireStaff();
    await saveTeamMember(getDb(), {
      actor,
      memberId,
      expectedVersion: Number(text(form, "expectedVersion")),
      fields: fieldsOf(form),
    });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "teamMemberSaved" }, `team-${memberId}`);
}

export async function setTeamMemberVisibleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const memberId = text(form, "memberId");
  const wanted = text(form, "visible") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setTeamMemberVisible(getDb(), {
      actor,
      memberId,
      expectedVersion: Number(text(form, "expectedVersion")),
      visible: wanted,
    });
    outcome = { saved: wanted ? "teamMemberShown" : "teamMemberHidden" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : `team-${memberId}`);
}

/** One place up or down; lands on the card it moved, because the order is read on the list. */
export async function moveTeamMemberAction(form: FormData): Promise<void> {
  const memberId = text(form, "memberId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await moveTeamMember(getDb(), { actor, memberId, direction: text(form, "direction") === "up" ? "up" : "down" });
    outcome = { saved: "teamMemberMoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : `team-${memberId}`);
}

export async function deleteTeamMemberAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await deleteTeamMember(getDb(), { actor, memberId: text(form, "memberId") });
    outcome = { saved: "teamMemberDeleted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome);
}

/** The club's introduction, both languages or neither (§352); a refusal returns every box as typed. */
export async function saveTeamPageIntroAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaff();
    await saveTeamPageIntro(getDb(), { actor, fields: { introRoBody: body(form, "introRoBody"), introEnBody: body(form, "introEnBody") } });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "teamPageIntroSaved" }, "team-page");
}

/**
 * «Casetele paginii» (§691): the boxes under the chart, in the cards' own shape — a refused add or
 * save returns so every box comes back as typed (§315); everything else redirects to the box.
 */
export async function createTeamBoxAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let id: string;
  try {
    const actor = await requireStaff();
    id = (await createTeamBox(getDb(), { actor, fields: boxFieldsOf(form) })).id;
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "teamBoxCreated" }, `team-box-${id}`);
}

export async function saveTeamBoxAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const boxId = text(form, "boxId");
  try {
    const actor = await requireStaff();
    await saveTeamBox(getDb(), { actor, boxId, expectedVersion: Number(text(form, "expectedVersion")), fields: boxFieldsOf(form) });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "teamBoxSaved" }, `team-box-${boxId}`);
}

export async function setTeamBoxVisibleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const boxId = text(form, "boxId");
  const wanted = text(form, "visible") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setTeamBoxVisible(getDb(), { actor, boxId, expectedVersion: Number(text(form, "expectedVersion")), visible: wanted });
    outcome = { saved: wanted ? "teamBoxShown" : "teamBoxHidden" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : `team-box-${boxId}`);
}

/** One place up or down; lands on the box it moved, because the order is read on the list. */
export async function moveTeamBoxAction(form: FormData): Promise<void> {
  const boxId = text(form, "boxId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await moveTeamBox(getDb(), { actor, boxId, direction: text(form, "direction") === "up" ? "up" : "down" });
    outcome = { saved: "teamBoxMoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : `team-box-${boxId}`);
}

export async function deleteTeamBoxAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await deleteTeamBox(getDb(), { actor, boxId: text(form, "boxId") });
    outcome = { saved: "teamBoxDeleted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : "team-boxes");
}

/** Put the page on the site in both languages, or take it off — asks first on the screen (§384). */
export async function setTeamPagePublishedAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const wanted = text(form, "published") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setTeamPagePublished(getDb(), { actor, published: wanted });
    outcome = { saved: wanted ? "teamPagePublished" : "teamPageUnpublished" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : "team-page");
}

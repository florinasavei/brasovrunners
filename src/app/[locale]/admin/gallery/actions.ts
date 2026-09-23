"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import type { EditorialStatus } from "@/modules/staff-identity/domain/roles";
import {
  createAlbum,
  deleteAlbum,
  deletePhoto,
  saveAlbum,
  setCover,
  transitionAlbum,
} from "@/modules/content/gallery/service";
import { deleteMediaAsset } from "@/modules/media/references";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The gallery's Server Actions (BR-REQ-054-01): the same shape as the standing pages' — read
 * the form, call the service, redirect to the outcome. Photos are the exception: they arrive
 * through `/api/admin/gallery/[id]/photos`, one request each, because a Server Action's body is
 * the wrong place for a file the uploader may send fifty of.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function outcomeOf(error: unknown): { error: string } {
  return { error: isDomainError(error) ? error.code : "UNKNOWN" };
}

function backTo(path: string, outcome: { error?: string; saved?: string }): never {
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved ?? "1"}`;
  redirect(`${path}${query}#admin-alert`);
}

function albumPath(locale: Locale, id: string): string {
  return getPathname({ locale, href: { pathname: "/admin/gallery/[id]", params: { id } } });
}

function readFields(form: FormData) {
  return {
    takenOn: text(form, "takenOn"),
    eventId: text(form, "eventId"),
    translations: Object.fromEntries(
      routing.locales.map((locale) => [
        locale,
        {
          slug: text(form, `translations.${locale}.slug`),
          title: text(form, `translations.${locale}.title`),
          description: text(form, `translations.${locale}.description`),
        },
      ]),
    ),
  };
}

/** A new album. A refusal comes back with every box still filled (`DECISIONS.md` §306). */
export async function createAlbumAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  let albumId: string;
  try {
    const actor = await requireStaff();
    const album = await createAlbum(getDb(), { actor, fields: readFields(form) });
    albumId = album.id;
  } catch (error) {
    return refused(error, form);
  }
  // Straight to the album, where the photos go in.
  redirect(`${albumPath(locale, albumId)}?saved=created#admin-alert`);
}

export async function saveAlbumAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const albumId = text(form, "albumId");
  try {
    const actor = await requireStaff();
    await saveAlbum(getDb(), {
      actor,
      albumId,
      expectedVersion: Number(text(form, "expectedVersion")),
      fields: readFields(form),
    });
  } catch (error) {
    return refused(error, form);
  }
  backTo(albumPath(locale, albumId), { saved: "album" });
}

export async function transitionAlbumAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const albumId = text(form, "albumId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await transitionAlbum(getDb(), {
      actor,
      albumId,
      expectedVersion: Number(text(form, "expectedVersion")),
      to: text(form, "to") as EditorialStatus,
    });
    outcome = { saved: text(form, "to") };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(albumPath(locale, albumId), outcome);
}

export async function deletePhotoAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const albumId = text(form, "albumId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await deletePhoto(getDb(), { actor, itemId: text(form, "itemId") });
    outcome = { saved: "photoRemoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(albumPath(locale, albumId), outcome);
}

export async function setCoverAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const albumId = text(form, "albumId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setCover(getDb(), { actor, albumId, itemId: text(form, "itemId") });
    outcome = { saved: "cover" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  backTo(albumPath(locale, albumId), outcome);
}

export async function deleteAlbumAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const albumId = text(form, "albumId");
  try {
    const actor = await requireStaff();
    await deleteAlbum(getDb(), { actor, albumId });
  } catch (error) {
    backTo(albumPath(locale, albumId), outcomeOf(error));
  }
  redirect(`${getPathname({ locale, href: "/admin/gallery" })}?saved=deleted#admin-alert`);
}

/**
 * Delete a stored picture from the pictures page (`DECISIONS.md` §73). Refused while it is
 * used anywhere — the page says where — so nothing published can lose its picture.
 */
export async function deletePictureAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const path = getPathname({ locale, href: "/admin/gallery/pictures" });
  try {
    const actor = await requireStaff();
    await deleteMediaAsset(getDb(), { actor, assetId: text(form, "assetId") });
  } catch (error) {
    const outcome = outcomeOf(error);
    backTo(path, outcome.error === "VALIDATION_ERROR" ? { error: "PICTURE_IN_USE" } : outcome);
  }
  backTo(path, { saved: "deleted" });
}


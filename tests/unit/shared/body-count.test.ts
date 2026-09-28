import { describe, expect, it } from "vitest";
import { type ConfirmSpec, resolveBodyCount } from "@/shared/feedback/notice";

/**
 * §532 — a confirm dialog whose body counts the ticks at the press: «Ștergi 2 declarații semnate
 * pentru «Tura pe munte»?». The ticks exist only in the browser, so the server hands the three
 * counted forms and the dialog picks one when it opens; with nothing ticked there is nothing to ask.
 */
const forms = {
  one: "Ștergi {count} declarație semnată pentru «Tura»? Nu se poate recupera.",
  few: "Ștergi {count} declarații semnate pentru «Tura»? Nu se pot recupera.",
  other: "Ștergi {count} de declarații semnate pentru «Tura»? Nu se pot recupera.",
};
const spec: ConfirmSpec = {
  title: "Ștergi declarațiile bifate?",
  body: forms.other,
  bodyCount: { field: "declarationIds", forms, locale: "ro" },
  confirmLabel: "Șterge cele bifate",
  cancelLabel: "Renunță",
  destructive: true,
};
const ticked = (values: string[]) => (field: string) => (field === "declarationIds" ? values : []);

describe("§532 a dialog that counts the ticks", () => {
  it("names the exact number ticked, in the right Romanian form, each id once", () => {
    expect(resolveBodyCount(spec, ticked(["a"]))?.body).toBe("Ștergi 1 declarație semnată pentru «Tura»? Nu se poate recupera.");
    expect(resolveBodyCount(spec, ticked(["a", "b", "b"]))?.body).toBe("Ștergi 2 declarații semnate pentru «Tura»? Nu se pot recupera.");
    const twenty = Array.from({ length: 20 }, (_, index) => `id-${index}`);
    expect(resolveBodyCount(spec, ticked(twenty))?.body).toBe("Ștergi 20 de declarații semnate pentru «Tura»? Nu se pot recupera.");
    expect(resolveBodyCount(spec, ticked(["a", "b"]))?.bodyCount).toBeUndefined();
  });

  it("asks nothing when nothing is ticked — the press goes to the server, which refuses it", () => {
    expect(resolveBodyCount(spec, ticked([]))).toBeNull();
  });

  it("leaves a dialog without a counted body as it was", () => {
    const plain: ConfirmSpec = { title: "t", body: "b", confirmLabel: "c", cancelLabel: "x" };
    expect(resolveBodyCount(plain, ticked([]))).toBe(plain);
  });
});

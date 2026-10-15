import { describe, expect, it } from "vitest";
import { withContactRoad } from "@/modules/contact/domain/recipients";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN (amending §149) — the road «Scrie-ne» is queued on: the club's saved choice, else the default
 * (Mailgun where it transmits), and a road the deployment lacks is replaced by the one it has.
 */
const BOTH = { gmail: true, mailgun: true };
const GMAIL_ONLY = { gmail: true, mailgun: false };
const DELIVERY = { to: ["club@example.invalid"] };

describe("withContactRoad", () => {
  it("queues on the saved Gmail road when both roads exist", () => {
    expect(withContactRoad(DELIVERY, { via: "gmail" }, BOTH)).toEqual({ ...DELIVERY, road: "gmail" });
  });

  it("queues on Mailgun when nothing is saved and both roads exist", () => {
    expect(withContactRoad(DELIVERY, {}, BOTH)).toEqual({ ...DELIVERY, road: "mailgun" });
    expect(withContactRoad(DELIVERY, null, BOTH)).toEqual({ ...DELIVERY, road: "mailgun" });
  });

  it("replaces a saved road the deployment does not have by the one it has", () => {
    expect(withContactRoad(DELIVERY, { via: "mailgun" }, GMAIL_ONLY)).toEqual({ ...DELIVERY, road: "gmail" });
    expect(withContactRoad(DELIVERY, { via: "gmail" }, { gmail: false, mailgun: true })).toEqual({ ...DELIVERY, road: "mailgun" });
  });

  it("keeps the chosen road when neither exists, rather than inventing one", () => {
    expect(withContactRoad(DELIVERY, { via: "gmail" }, { gmail: false, mailgun: false })).toEqual({ ...DELIVERY, road: "gmail" });
  });

  it("stays none when the form has no delivery", () => {
    expect(withContactRoad(null, { via: "gmail" }, BOTH)).toBeNull();
  });
});

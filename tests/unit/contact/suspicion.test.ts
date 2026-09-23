import { describe, expect, it } from "vitest";
import {
  clubIdentity,
  contactSuspicion,
  type ContactSuspicionInput,
  imitatesClub,
  MAX_LINK_HOSTS,
} from "@/modules/contact/domain/suspicion";

/**
 * BR-REQ-070-04 — a contact message that got past every gate, read for what a program leaves
 * behind (the owner, 2026-09-23: "primesc spam cu SEO stuff").
 *
 * The sample that prompted it arrived from `domains@search-<the club's domain>` with a link to
 * an SEO "register", through a form with Turnstile on. It passed because a script that never runs
 * the widget posts no token, and no token passes (§216) — a person with JavaScript off posts the
 * same nothing, and §205 says they must reach the club. So two things mark a message and nothing
 * refuses one: the challenge on with no token at all, and a sender's domain that borrows the
 * club's name. `club.example` stands for the club's domain throughout; the real one belongs in
 * `SETUP.md` §26 and nowhere else.
 */
const ORDINARY: ContactSuspicionInput = {
  botCheckOn: true,
  tokenPresent: true,
  turnstileVerdict: "passed",
  elapsedMs: 47_000,
  senderEmail: "ana@example.com",
  message: "La ce oră începe alergarea de duminică?",
  honeypot: undefined,
  clubHost: "club.example",
};

const reasonKinds = (input: Partial<ContactSuspicionInput>) =>
  contactSuspicion({ ...ORDINARY, ...input }).reasons.map((reason) => reason.kind);

describe("BR-REQ-070-04 a contact message the gates let through, read for suspicion", () => {
  it("finds nothing in a person's message that passed the challenge", () => {
    const verdict = contactSuspicion(ORDINARY);
    expect(verdict.suspicious).toBe(false);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.signals).toEqual({
      botCheck: "passed",
      elapsedSeconds: 47,
      linkCount: 0,
      linkHosts: [],
      linkHostCount: 0,
      honeypot: "empty",
    });
  });

  it("marks a post with no token while the club's challenge is on — the widget never ran", () => {
    const verdict = contactSuspicion({ ...ORDINARY, tokenPresent: false, turnstileVerdict: "unavailable" });
    expect(verdict.suspicious).toBe(true);
    expect(verdict.reasons).toEqual([{ kind: "no-token" }]);
    expect(verdict.signals.botCheck).toBe("no-token");
  });

  it("does not mark a token Cloudflare did not answer for: an outage must not mark every message", () => {
    const verdict = contactSuspicion({ ...ORDINARY, tokenPresent: true, turnstileVerdict: "unavailable" });
    expect(verdict.suspicious).toBe(false);
    expect(verdict.reasons).toEqual([]);
    // Said, as a signal of its own, so a marked message on the same day still shows it.
    expect(verdict.signals.botCheck).toBe("no-answer");
  });

  it("does not mark a missing token when there was no challenge to run — switched off, or no keys", () => {
    expect(reasonKinds({ botCheckOn: false, tokenPresent: false, turnstileVerdict: "not_configured" })).toEqual([]);
    // The switch on but the keys missing is the same "nothing was asked" (`verifyTurnstile`).
    expect(reasonKinds({ botCheckOn: true, tokenPresent: false, turnstileVerdict: "not_configured" })).toEqual([]);
    expect(contactSuspicion({ ...ORDINARY, botCheckOn: false, tokenPresent: false, turnstileVerdict: "not_configured" }).signals.botCheck).toBe("off");
  });

  it("marks a token Cloudflare rejected, should a caller ever let one through (the action refuses it first, §216)", () => {
    expect(reasonKinds({ turnstileVerdict: "failed" })).toEqual(["token-rejected"]);
  });

  it("marks a sender whose domain borrows the club's name, and names the domain", () => {
    for (const email of [
      "domains@search-club.example",
      "x@club-seo.com",
      "y@clubexample.net",
      // Hyphens ignored: the same name spelled apart.
      "v@c-l-u-b.example",
      // The club's whole domain as the front of somebody else's.
      "u@club.example.lookalike.net",
      // Not a subdomain of the club's: the dot is what makes one.
      "t@notclub.example",
      // Case is not a disguise.
      "Domains@Search-Club.Example",
    ]) {
      const verdict = contactSuspicion({ ...ORDINARY, senderEmail: email });
      expect(verdict.reasons, email).toEqual([
        { kind: "imitates-club", senderDomain: email.slice(email.indexOf("@") + 1).toLowerCase() },
      ]);
    }
  });

  it("does not mark the club's own domain, its subdomains, or somebody at an ordinary provider", () => {
    for (const email of ["z@club.example", "w@mail.club.example", "CONTACT@Club.Example", "someone@gmail.com", "ana@example.com"]) {
      expect(reasonKinds({ senderEmail: email }), email).toEqual([]);
    }
  });

  it("reads the club's domain the same from QA's host: the subdomain is not the name", () => {
    expect(clubIdentity("qa.club.example")).toEqual({ domain: "club.example", label: "club" });
    expect(reasonKinds({ clubHost: "qa.club.example", senderEmail: "w@mail.club.example" })).toEqual([]);
    expect(reasonKinds({ clubHost: "qa.club.example", senderEmail: "domains@search-club.example" })).toEqual(["imitates-club"]);
  });

  it("switches the imitation rule off where there is no name worth matching — never 'everything matches'", () => {
    // `APP_BASE_URL` of a laptop: the hostname is a bare word.
    const laptop = new URL("http://localhost:3000").hostname;
    expect(clubIdentity(laptop)).toBeNull();
    expect(reasonKinds({ clubHost: laptop, senderEmail: "someone@gmail.com" })).toEqual([]);
    expect(reasonKinds({ clubHost: laptop, senderEmail: "x@localhost-seo.com" })).toEqual([]);

    for (const host of [
      "127.0.0.1",
      new URL("http://[::1]:3000").hostname,
      "",
      null,
      // A provider's shared domain is the provider's, not the club's.
      "club-git-branch.vercel.app",
      // A label too short to be a name: the rule would match half the internet.
      "run.example",
      // The last two labels of a `co.uk`-shaped host are the registry's; off rather than "co".
      "club.co.uk",
    ]) {
      expect(clubIdentity(host), String(host)).toBeNull();
    }
    expect(reasonKinds({ clubHost: null, senderEmail: "domains@search-club.example" })).toEqual([]);
  });

  it("keeps the name comparison to the label, hyphens dropped, and the club's own subdomains out", () => {
    const club = { domain: "my-club.example", label: "myclub" };
    expect(clubIdentity("www.my-club.example")).toEqual(club);
    expect(imitatesClub("my-club.example", club)).toBe(false);
    expect(imitatesClub("news.my-club.example", club)).toBe(false);
    expect(imitatesClub("myclub-seo.net", club)).toBe(true);
    expect(imitatesClub("my-club-seo.net", club)).toBe(true);
    expect(imitatesClub("gmail.com", club)).toBe(false);
  });

  it("marks for both reasons at once, the challenge first", () => {
    const verdict = contactSuspicion({
      ...ORDINARY,
      tokenPresent: false,
      turnstileVerdict: "unavailable",
      senderEmail: "domains@search-club.example",
    });
    expect(verdict.suspicious).toBe(true);
    expect(verdict.reasons).toEqual([{ kind: "no-token" }, { kind: "imitates-club", senderDomain: "search-club.example" }]);
  });

  it("counts the links and names their hosts, each once, at most five — a signal, never a reason", () => {
    const one = contactSuspicion({
      ...ORDINARY,
      message: "Feature club.example in Google's Search Index … https://searchregister.net/submit?site=club.example.",
    });
    expect(one.suspicious).toBe(false);
    expect(one.signals).toMatchObject({ linkCount: 1, linkHosts: ["searchregister.net"], linkHostCount: 1 });

    const many = contactSuspicion({
      ...ORDINARY,
      message: [
        "http://a.example/1, http://a.example/2 and www.b.example.",
        "HTTPS://C.EXAMPLE (d) https://d.example/x https://e.example https://f.example https://g.example",
      ].join("\n"),
    });
    expect(many.signals.linkCount).toBe(8);
    // The host as written — `www.` included — and the sentence's full stop left off it.
    expect(many.signals.linkHosts).toEqual(["a.example", "www.b.example", "c.example", "d.example", "e.example"]);
    expect(many.signals.linkHosts).toHaveLength(MAX_LINK_HOSTS);
    expect(many.signals.linkHostCount).toBe(7);
    expect(many.suspicious).toBe(false);

    // A bare word with a dot is not counted as a link: "club.example" above is prose.
    expect(contactSuspicion({ ...ORDINARY, message: "Scrieți-mi la ana@example.com sau pe club.example." }).signals.linkCount).toBe(0);
  });

  it("times the post in whole seconds, and says nothing when there was nothing to time (§217)", () => {
    expect(contactSuspicion({ ...ORDINARY, elapsedMs: 1_499 }).signals.elapsedSeconds).toBe(1);
    expect(contactSuspicion({ ...ORDINARY, elapsedMs: 3 * 3_600_000 }).signals.elapsedSeconds).toBe(10_800);
    expect(contactSuspicion({ ...ORDINARY, elapsedMs: null }).signals.elapsedSeconds).toBeNull();
    expect(contactSuspicion({ ...ORDINARY, elapsedMs: Number.NaN }).signals.elapsedSeconds).toBeNull();
  });

  it("reports the hidden field as it was: empty, the sender's own address a browser put there, or filled", () => {
    expect(contactSuspicion({ ...ORDINARY, honeypot: "" }).signals.honeypot).toBe("empty");
    expect(contactSuspicion({ ...ORDINARY, honeypot: "  " }).signals.honeypot).toBe("empty");
    expect(contactSuspicion({ ...ORDINARY, honeypot: " ANA@example.com " }).signals.honeypot).toBe("sender-address");
    expect(contactSuspicion({ ...ORDINARY, honeypot: "http://spam.example" }).signals.honeypot).toBe("filled");
    // A signal only: the trap's verdict is the form's (`looksLikeSpam`), made before this is asked.
    expect(contactSuspicion({ ...ORDINARY, honeypot: "http://spam.example" }).suspicious).toBe(false);
  });
});

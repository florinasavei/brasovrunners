import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { templatePrefill } from "@/modules/legal-documents/templates/catalogue";
import type { ClubFacts } from "@/modules/legal-documents/templates/club-facts";

/**
 * BR-REQ-053-01 and BR-REQ-101-01 (§882): moving the club's identity into `club/club.json` changed no word of a
 * legal template. `filledHash` is what the maintenance job fingerprints a change of the templates by (§639) and
 * what «Regenerează din șabloane» compares with the text in force (§532): one byte moved here would announce
 * every template to the Administrators as newer and ask the club to approve it again.
 *
 * The values were recorded on `origin/qa` before the move, with the fixed facts below. A template edited on
 * purpose changes its hash here, and the edit says so; a hash that moves with no template edited is a leak of
 * the config into the legal text.
 */
const FACTS: ClubFacts = {
  legalName: "Asociația Exemplu",
  contactEmail: "contact@example.invalid",
  contactEmailEn: "contact@example.invalid",
  registeredAddress: "Strada Exemplu nr. 1",
  registrationNumber: "1/2020",
};

const RECORDED: Record<string, { ro: string; en: string; both: string }> = {
  // Edited on purpose (§NNN): the paragraph «Tombola ({{raffle}})» in section 5 and its line in section 7 — the elites named
  // «sportivii de top», as every text a participant reads names them (§917).
  PRIVACY_NOTICE: {
    ro: "2ef3d1a891bf11bd31e0b7ddb50a9b1f223ec1cdfc6c9a7cdf004fe93682ce0e",
    en: "a3e9c5d8cd4299692c86dd37bdeac8fd057b8e7908e8365ebab9c777e2bd5c37",
    both: "bf6a2eebcfbf9703b431df4c8705b5c5169dd03384de6aed55611667f19c0cf2",
  },
  TERMS: {
    ro: "d4f30d2e01521edb464620af19d13fc0af7f3179c40ee2c7cb57b2290162e05c",
    en: "caad1396449f473aefd7d5f8476c8780fff8265539027a513ca5c76b83819c38",
    both: "4354c626ce190197b1508520fa25bbfabff99e847e391e5a12f78b3d4a6e4d3a",
  },
  EVENT_DECLARATION: {
    ro: "63c45e16d2b21d6ff4af207718cd2c422b5c29bdf54188cf29e9283ca58d2b09",
    en: "eb45ff2a1072827709887f8b2ca3c64456de71e7030effaa3e02f9fa3c723b71",
    both: "0cd0c0af42875113defe68396a78b2ef8182b994aa1f7ef4ba13f21de62967fb",
  },
  EVENT_DECLARATION_ROAD: {
    ro: "cc21a1eb0297fe0887e0985df701a782b6f95e1335e668447fd6922643862ebe",
    en: "4ba96fb3d75ddcb0c27a24c4fdbd85c1218e6757310cfc6deb180e7d19f8f735",
    both: "d1178d55aa8e0dd3466aea66ae58a0f05f8de220c7b5fc17798999af22583bdd",
  },
  GROUP_RUN_DECLARATION_ASPHALT: {
    ro: "6f71d38f3a9dffb859ac5771cfdc7f25ee51efda9d3c394463078177a1b8a0da",
    en: "737774a2755689bf7e4842910ba45a702626cdd891af483cdd9e254bffc87a27",
    both: "3851d129c4979010d93da1ce2cf89dcb5a7ca69cb6f5c5e514618176245c7b62",
  },
  GROUP_RUN_DECLARATION_TRAIL: {
    ro: "8d7727e89a9d831641b19dbc65f018f15dfa588a89961ae675d67820c0957507",
    en: "4fcfb3c38e39e83bc05446e0ab855625134a90642ce3c7d43e236aa5f109cb3f",
    both: "02c9bdd615f910748ed92006755906c438cd4eaee431571543c53bae3cc1448d",
  },
  VOLUNTEER_AGREEMENT: {
    ro: "cb659310d0f031ceb595fc65342e5f216bde100e257e9b841a33d07c57ae4d7e",
    en: "d9ebe8f8340ba9d30534eb64eac69f24d1253f99d8d072334e95f96c13bf8762",
    both: "b0910e76c29f7b57e8109a74b1cca7f776f4bb49648c97c0ba59c8697c1ae4aa",
  },
  // «Regulamentul tombolei» (§NNN): a new template, recorded as written — the elites named «sportivii de top» (§917), and the
  // event's sentence saying «are loc» / “takes place” once («Tombola se ține la evenimentul …, care are loc …»).
  RAFFLE_RULES: {
    ro: "64d7c161808ff438d9fd489da55a9ee20418adfabdbc951c714c1a1aef4d7e81",
    en: "df01842273e0a6c3947ce57204a4e6cc88daed90bc7bfb6a904b2a54556d9467",
    both: "882c63752ec8a9afbbf008a8f2e2274931ab2403c88c3b6e27a1a78a3a62a35b",
  },
};

describe("BR-REQ-101-01: every legal template's filled hash is the one recorded on origin/qa (§882)", () => {
  it.each(LEGAL_DOCUMENT_KEYS.map((key) => [key]))("%s", (key) => {
    const prefill = templatePrefill(key, FACTS);
    const ro = computeContentHash([{ locale: "ro", ...prefill.ro }]);
    const en = computeContentHash([{ locale: "en", ...prefill.en }]);
    const both = computeContentHash([
      { locale: "ro", ...prefill.ro },
      { locale: "en", ...prefill.en },
    ]);
    expect({ ro, en, both }).toEqual(RECORDED[key]);
  });
});

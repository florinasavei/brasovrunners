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
  // Edited on purpose (§NNN): the paragraph «Tombola ({{raffle}})» in section 5 and its line in section 7.
  PRIVACY_NOTICE: {
    ro: "6656782e1db5fbc416c80593b7e7b0ffe66a3ac25cbaa9604bc767afead143ca",
    en: "2272bfd9f8814c30f77ef34e55665dce5eb73851442cb59ceb23a1002a133f8c",
    both: "420f9f082c164d2376e187bbbe75bae0b733366bbc4c52dd787e2df18e461456",
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
  // «Regulamentul tombolei» (§NNN): a new template, recorded as written.
  RAFFLE_RULES: {
    ro: "0f20824850abb6bef7138db03feadd674d7e5f63df49b47cb4491f18ada38293",
    en: "60f4411672cbe6108dae5e9ee9d22ac7d5dbbb6b343a23c7e9b49920fcfb62d6",
    both: "d3cafa8fcc25b0abf859278faf8e5a8c5ccfbc71cc96200f68482719afc76003",
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

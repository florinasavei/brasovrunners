import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { participants } from "@/db/schema/participants";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-032-01 criterion 3 and BR-REQ-032-04.
 *
 * The unit tests prove the function computes the right canonical value. These prove the
 * *database* enforces it. That distinction matters: two concurrent registrations both pass an
 * application-level "does this participant exist?" check and both try to insert. Only the
 * UNIQUE constraint stops the second one.
 */
describe("BR-REQ-032 the database enforces one participant per canonical email", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  /** Insert exactly what the application would store for a submitted address. */
  function rowFor(input: string, name = "Ana Pop") {
    const identity = canonicalizeEmail(input);
    return {
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: name,
    };
  }

  it("stores the three addresses separately", async () => {
    const [row] = await db.insert(participants).values(rowFor(" Ana.Pop@Example.RO ")).returning();

    expect(row.deliveryEmail).toBe("Ana.Pop@Example.RO");
    expect(row.normalizedEmail).toBe("ana.pop@example.ro");
    expect(row.canonicalEmail).toBe("ana.pop@example.ro");
    expect(row.canonicalizationVersion).toBe(1);
    expect(row.emailVerifiedAt).toBeNull();
    expect(row.preferredLocale).toBe("ro");
  });

  it("refuses a second participant differing only in case or whitespace", async () => {
    await db.insert(participants).values(rowFor("ana@example.ro"));
    await expectViolation(db.insert(participants).values(rowFor("  ANA@EXAMPLE.RO  ")), {
      code: SQLSTATE.UNIQUE_VIOLATION,
    });
  });

  it("refuses a dotted Gmail alias of an existing participant", async () => {
    await db.insert(participants).values(rowFor("ana@gmail.com"));
    await expectViolation(db.insert(participants).values(rowFor("a.n.a@gmail.com")), {
      code: SQLSTATE.UNIQUE_VIOLATION,
    });
  });

  it("refuses a plus-tagged Gmail alias of an existing participant", async () => {
    await db.insert(participants).values(rowFor("ana@gmail.com"));
    await expectViolation(db.insert(participants).values(rowFor("ana+club@gmail.com")), {
      code: SQLSTATE.UNIQUE_VIOLATION,
    });
  });

  it("refuses a googlemail address for an existing gmail participant", async () => {
    await db.insert(participants).values(rowFor("ana@gmail.com"));
    await expectViolation(db.insert(participants).values(rowFor("ana@googlemail.com")), {
      code: SQLSTATE.UNIQUE_VIOLATION,
    });
  });

  it("allows dotted variants on a custom domain, which may be different people", async () => {
    await db.insert(participants).values(rowFor("ana@example.ro"));
    const [second] = await db
      .insert(participants)
      .values(rowFor("a.n.a@example.ro", "Ana-Maria Pop"))
      .returning();

    expect(second.canonicalEmail).toBe("a.n.a@example.ro");
  });

  it("keeps the submitted domain on a googlemail participant", async () => {
    const [row] = await db.insert(participants).values(rowFor("ana@googlemail.com")).returning();

    // Mail must still be delivered to the address they gave us.
    expect(row.deliveryEmail).toBe("ana@googlemail.com");
    expect(row.normalizedEmail).toBe("ana@googlemail.com");
    // But the identity is the shared inbox.
    expect(row.canonicalEmail).toBe("ana@gmail.com");
  });
});

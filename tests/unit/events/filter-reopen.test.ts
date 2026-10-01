import { describe, expect, it } from "vitest";
import { REOPEN_WINDOW_MS, rememberTick, spendTick, wasTicked } from "@/modules/events/ui/filter-reopen";

/** BR-REQ-041-01 — the panel's reopen memory expires by itself (`DECISIONS.md` §611, §549). */
describe("§611 the filter panel's reopen memory", () => {
  it("opens the ticked scope's panel on the address the tick went to, and no other scope's", () => {
    rememberTick("past", "/ro/evenimente?past-type=RACE", 1000);
    expect(wasTicked("past", "/ro/evenimente?past-type=RACE", 1500)).toBe(true);
    expect(wasTicked("upcoming", "/ro/evenimente?past-type=RACE", 1500)).toBe(false);
  });

  it("ignores a note about another address: a stale tick cannot open a panel reached from a link or the back button", () => {
    rememberTick("past", "/ro/evenimente?past-type=RACE", 1000);
    expect(wasTicked("past", "/ro/evenimente", 1500)).toBe(false);
  });

  it("drops a note that is old, and a spent one", () => {
    rememberTick("past", "/ro/evenimente", 1000);
    expect(wasTicked("past", "/ro/evenimente", 1000 + REOPEN_WINDOW_MS)).toBe(false);
    rememberTick("past", "/ro/evenimente", 1000);
    spendTick();
    expect(wasTicked("past", "/ro/evenimente", 1500)).toBe(false);
  });
});

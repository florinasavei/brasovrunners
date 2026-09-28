import { describe, expect, it } from "vitest";
import {
  centerChosenOption,
  INLINE_LIST_STYLE,
  PICKER_MIN_ROWS,
  PICKER_ROW_PX,
  pickerListboxSx,
  pickerPaperSx,
  SHEET_MEDIA_QUERY,
} from "@/modules/registrations/ui/CountryPicker";

/**
 * BR-REQ-031-04, BR-REQ-041-01 criterion 6 — the one country picker both fields open (§463)
 * opens tall enough to read (§544): the owner's «pop-up-ul cu cetățenia e minuscul!» showed a
 * row and a half. The cause was MUI's `position: absolute` on the popper slot under
 * `disablePortal`, which took the list out of the popover's flow; these pin the fix and the sizes.
 */
describe("the country picker's list height (§544)", () => {
  it("keeps the list in the popover's flow, so the paper is as tall as the list", () => {
    expect(INLINE_LIST_STYLE.position).toBe("static");
    expect(INLINE_LIST_STYLE.minHeight).toBe(0);
  });

  it("shows at least eight 44-pixel rows on a desktop, 40 % of the screen when that is more", () => {
    expect(PICKER_ROW_PX).toBe(44);
    expect(PICKER_MIN_ROWS).toBeGreaterThanOrEqual(8);
    const sx = pickerListboxSx(false);
    // Eight rows plus the listbox's 8-pixel padding top and bottom.
    expect(sx.maxHeight).toBe("max(40vh, 368px)");
    expect((sx as Record<string, unknown>)["& .MuiAutocomplete-option"]).toEqual({ minHeight: 44 });
  });

  it("on a desktop the paper sits under the field with no height cap of its own", () => {
    const paper = pickerPaperSx(false);
    expect(paper).toEqual({ width: "min(22rem, calc(100vw - 32px))" });
  });

  it("is a bottom sheet below sm or on a short screen: full width, search pinned, the list the scroller", () => {
    expect(SHEET_MEDIA_QUERY).toContain("(max-width:599.95px)");
    expect(SHEET_MEDIA_QUERY).toContain("(max-height:519.95px)");
    const paper = pickerPaperSx(true);
    expect(paper).toMatchObject({
      bottom: 0,
      left: 0,
      right: 0,
      width: "100%",
      maxWidth: "100%",
      height: "85vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    });
    const list = pickerListboxSx(true);
    expect(list).toMatchObject({ flex: "1 1 auto", minHeight: 0, maxHeight: "none" });
    expect((list as Record<string, unknown>)["& .MuiAutocomplete-option"]).toEqual({ minHeight: 44 });
  });

  it("puts the chosen country in the middle of the list, scrolling only the list", () => {
    const listbox = { clientHeight: 368, scrollTop: 0 } as unknown as HTMLElement;
    const chosen = { offsetTop: 44 * 180, offsetHeight: 44 } as HTMLElement;
    Object.assign(listbox, {
      querySelector: (selector: string) => (selector.includes('aria-selected="true"') ? chosen : null),
    });
    const root = { querySelector: (selector: string) => (selector === '[role="listbox"]' ? listbox : null) };
    centerChosenOption(root as unknown as ParentNode);
    expect(listbox.scrollTop).toBe(44 * 180 - (368 - 44) / 2);
  });

  it("never scrolls above the top, and does nothing without a list", () => {
    const listbox = { clientHeight: 368, scrollTop: 5 } as unknown as HTMLElement;
    const chosen = { offsetTop: 8, offsetHeight: 44 } as HTMLElement;
    Object.assign(listbox, { querySelector: () => chosen });
    centerChosenOption({ querySelector: () => listbox } as unknown as ParentNode);
    expect(listbox.scrollTop).toBe(0);
    expect(() => centerChosenOption(null)).not.toThrow();
  });
});

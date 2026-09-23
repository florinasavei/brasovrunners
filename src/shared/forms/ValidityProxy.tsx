"use client";

/** The attribute a proxy carries, naming the hidden field it stands in for. */
export const VALIDITY_PROXY_ATTRIBUTE = "data-validity-proxy";

/**
 * A box the browser can point at, for a value that lives in a hidden field (`DECISIONS.md` §315).
 *
 * A rich text posts its document through `<input type="hidden">`, and a hidden input is barred
 * from constraint validation: `required` on it is ignored, and even a custom validity could not
 * be shown, because the browser's bubble needs a control it can focus. So the editor renders
 * this beside its hidden field — an empty, unnamed text input, invisible and out of the tab
 * order, that posts nothing — and the constraint goes here instead. When the rule fails the
 * browser refuses the submit, fires `invalid` on this box (which `LocaleTabPanels` answers by
 * bringing its language forward and opening the fold around it), focuses it and anchors its
 * own bubble, in the browser's own language, at the fold. With JavaScript off the proxy is
 * still in the HTML with its `required`, so a body that the server renders empty is refused by
 * the browser before any script runs.
 *
 * `required` is set by the editor that knows whether its document is empty (the legal text, which
 * is always required), or imperatively for one press by a button that knows a rule the field does
 * not (`CreateAndPublishButton`: the summary is required for publication, not for a draft).
 * `label` names it for `SubmitButton`'s "fill in first" sentence; it is hidden from assistive
 * technology, which reads the editor itself.
 */
export default function ValidityProxy({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <span style={{ position: "relative", display: "block", height: 0 }}>
      <input
        {...{ [VALIDITY_PROXY_ATTRIBUTE]: name }}
        aria-hidden="true"
        aria-label={label}
        tabIndex={-1}
        autoComplete="off"
        required={required}
        value=""
        onChange={() => undefined}
        style={{
          position: "absolute",
          left: 16,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          border: 0,
          padding: 0,
          margin: 0,
        }}
      />
    </span>
  );
}

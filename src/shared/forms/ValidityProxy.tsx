"use client";

/** Names the hidden field the proxy stands in for. */
export const VALIDITY_PROXY_ATTRIBUTE = "data-validity-proxy";

/**
 * An invisible, unnamed, unfocusable-by-tab input that carries the constraint for a value posted
 * through a hidden field (§315): hidden inputs are barred from constraint validation, and the
 * browser's bubble needs a focusable control. Works with JavaScript off.
 *
 * `required` comes from the editor that knows its document is empty (§406: the event summary is
 * checked by `PublishCheck` instead). `label` feeds `SubmitButton`'s "fill in first" sentence.
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

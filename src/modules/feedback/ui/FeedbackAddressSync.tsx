"use client";

import { useEffect } from "react";
import { FEEDBACK_QUERY } from "../domain/branches";
import { writeChoiceToAddress } from "./feedback-address";

/**
 * Writes the event and the day a person picks into the address (§NNN), for the two boxes that are
 * plain native fields — the event's select when the list is short or before the filtering island runs,
 * and the day's date box. It draws nothing: one listener on the form it sits in. The filtering island
 * writes its own choice.
 */
export default function FeedbackAddressSync({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
      if (target.name === "event" && target instanceof HTMLSelectElement) writeChoiceToAddress({ [FEEDBACK_QUERY.event]: target.value });
      if (target.name === "date" && target.type === "date") writeChoiceToAddress({ [FEEDBACK_QUERY.date]: target.value });
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, [formId]);
  return null;
}

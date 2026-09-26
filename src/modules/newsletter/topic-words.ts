import type { NewsletterTopic } from "@/db/schema/newsletter";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { NEWSLETTER_TOPICS } from "./domain/topics";

/**
 * The topics' names outside a request (§NNN): for the privacy notice's `{{newsletterTopics}}`, the
 * emails the outbox renders and the legal editor's token legend, where no translator is at hand.
 *
 * Read from `Newsletter.topics` rather than typed again here, so the approved notice, the pop-up's
 * boxes, the subscriber's own page and the messages name exactly the same topics.
 */
const WORDS: Record<"ro" | "en", Record<NewsletterTopic, string>> = {
  ro: ro.Newsletter.topics,
  en: en.Newsletter.topics,
};

/** Every topic's name in one language. */
export function topicWords(locale: string): Record<NewsletterTopic, string> {
  return locale === "en" ? WORDS.en : WORDS.ro;
}

/**
 * Topics as one phrase, quoted, in that language — „Evenimente mari”, „Coduri de reducere”
 * și „Voluntariat” — for a message that says what somebody subscribed to, and (with every topic) for
 * the privacy notice.
 */
export function topicsPhrase(locale: string, topics: readonly NewsletterTopic[]): string {
  const words = topicWords(locale);
  const quoted = topics.map((topic) => (locale === "en" ? `“${words[topic]}”` : `„${words[topic]}”`));
  if (quoted.length <= 1) return quoted.join("");
  const last = quoted[quoted.length - 1];
  return `${quoted.slice(0, -1).join(", ")} ${locale === "en" ? "and" : "și"} ${last}`;
}

/** What `{{newsletterTopics}}` becomes in the privacy notice: every topic a subscriber may choose. */
export function newsletterMergeValues(locale: string): { newsletterTopics: string } {
  return { newsletterTopics: topicsPhrase(locale, NEWSLETTER_TOPICS) };
}

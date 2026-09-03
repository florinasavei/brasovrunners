/**
 * Emit a JSON-LD block.
 *
 * The content is generated server-side from our own database rows, never from user input, so
 * `dangerouslySetInnerHTML` is safe here. `<` is still escaped because a `</script>` sequence
 * inside a string would otherwise close the tag early — the one injection route that survives
 * JSON encoding.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD has no other mechanism
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

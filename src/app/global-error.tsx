"use client";

/**
 * The last boundary: what a visitor sees when the **root layout itself** failed
 * (`DECISIONS.md` §52).
 *
 * `[locale]/error.tsx` handles everything below the layout and is the page almost every failure
 * reaches. This one exists for the failures that happen above it — a broken locale resolution, a
 * font or theme provider throwing, a layout that never rendered — and it replaces the whole
 * document, `<html>` and `<body>` included, because at that point there is no layout left to
 * render inside.
 *
 * ## Why it says everything twice
 *
 * Because there is no translator here. Replacing the root layout replaces `NextIntlClientProvider`
 * with it, so `useTranslations` would throw — inside the error page, which is the one place a
 * throw has nowhere left to go. Romanian first because that is the club's language and the
 * default locale, English under it because the site is bilingual and somebody reading this may
 * not have Romanian. Two sentences, hard-coded, and that is the honest cost of being the page
 * that runs when nothing else does.
 *
 * `AGENTS.md` §11.3 keeps user-facing strings in the catalogues, and this is the documented
 * exception rather than an oversight: the catalogue is reached through the provider this page
 * has just lost.
 *
 * ## Why the styles are inline
 *
 * Same reason. Emotion's cache and the MUI theme are provided by the layout that is gone, so
 * `sx` would render unstyled at best. These are the few declarations needed to make a bare
 * document legible on a phone, and nothing more.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    // `lang="ro"`: the club's language and the default locale. There is no request locale to
    // read here, and an unlabelled document is worse for a screen reader than one labelled with
    // the language most of its readers speak.
    <html lang="ro">
      <body
        style={{
          margin: 0,
          padding: "2rem 1rem",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          lineHeight: 1.5,
          color: "#1a1a1a",
          background: "#fff",
        }}
      >
        <main style={{ maxWidth: "34rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem", marginTop: 0 }}>Ceva nu a funcționat</h1>
          <p>
            Pagina nu a putut fi afișată. Încearcă din nou peste câteva momente — de cele mai
            multe ori este ceva trecător.
          </p>

          <h2 style={{ fontSize: "1.125rem", marginBottom: "0.25rem" }}>Something went wrong</h2>
          <p style={{ marginTop: 0 }}>
            This page could not be displayed. Try again in a moment — it is usually temporary.
          </p>

          <p>
            <button
              type="button"
              onClick={reset}
              style={{
                // 44 pixels, like every other control a thumb has to find
                // (BR-REQ-041-01 criterion 6). The theme that normally guarantees that is gone.
                minHeight: 44,
                padding: "0 1.25rem",
                fontSize: "1rem",
                cursor: "pointer",
                color: "#fff",
                background: "#1a1a1a",
                border: 0,
                borderRadius: 8,
              }}
            >
              Încearcă din nou / Try again
            </button>
          </p>

          {/*
            Next's own hash for this error, logged beside the stack. Shown so a report can name
            it; never the message or the stack, which carry SQL, provider text and sometimes an
            address (AGENTS.md §14.3, §14.5).
          */}
          {error.digest && (
            <p style={{ color: "#555" }}>
              Referință / Reference: <code style={{ fontSize: "1rem" }}>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

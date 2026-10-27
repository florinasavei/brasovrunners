import type { Entry } from "./scan";

/**
 * The design system's ratchet (§694): today's offenders of the three guards, each with its reason.
 *
 * The list can only shrink. A new offender fails its test (fix it, never add it); a file that was
 * fixed fails its test as a stale entry (delete the entry); and `PINNED` below must equal each
 * list's length and its hits (the sum of the entries' counts), so a shrink is a deliberate edit of the numbers in one reviewed file. There is no
 * inline escape (`// eslint-disable`-style): this file is the only door.
 *
 * Files under `src/modules/content/shop`, `src/modules/content/team` and `src/app/[locale]/admin/shop`,
 * and the pages that edit them (`admin/pages/team/page.tsx`, `admin/pages/members/ShopCard.tsx`), are
 * never listed: they were fixed with a token, a registry name or a primitive, and stay so.
 */
export const ALLOWED: { colours: Entry[]; icons: Entry[]; primitives: Entry[]; toggles: Entry[]; rowBoxes: Entry[]; rowFolds: Entry[]; pageHeadings: Entry[]; headingSizes: Entry[] } = {
  colours: [
    { path: "src/app/api/resting/route.ts", reason: "the resting page is static HTML outside the theme provider; its hairline is a translucent grey that reads on both modes", count: 1 },
    { path: "src/app/global-error.tsx", reason: "the last-resort error page renders without the theme provider (it replaces the root layout), so it carries its own plain colours", count: 5 },
    { path: "src/modules/content/events/fields.ts", reason: "an error message's example («such as #1a73e8»), not a colour used", count: 1 },
    { path: "src/modules/content/events/ui/DifficultyStepField.tsx", reason: "an rgba() built from the theme's own channel variable (§526); the literal is the fallback syntax, not a hue", count: 1 },
    { path: "src/modules/content/events/ui/bib-colours.ts", reason: "the bib colours the club may pick for a race number are data, not the site's palette", count: 6 },
    { path: "src/modules/content/rich-text/ui/ImageCropBox.tsx", reason: "the crop frame's dimming scrim and handle: black and white at an opacity over any picture, in both modes", count: 2 },
    { path: "src/modules/content/rich-text/ui/PictureLightboxDialog.tsx", reason: "the lightbox's near-black backdrop: a scrim over a picture, the same in both modes", count: 1 },
    { path: "src/modules/content/rich-text/ui/RichTextEditor.tsx", reason: "inline styles in the editor's serialised picture-placeholder DOM, which is outside React's theme", count: 2 },
    { path: "src/modules/events/share-card-design.ts", reason: "the share card is drawn to an image (Satori) with no theme provider; it computes rgba() from the brand hex it is given", count: 1 },
    { path: "src/modules/media/video-poster.ts", reason: "the test stub's poster frame, a flat fill that is never shown to a visitor", count: 1 },
    { path: "src/modules/newsletter/ui/NewsletterSignup.tsx", reason: "the native dialog's ::backdrop scrim, which MUI's theme does not reach", count: 1 },
    { path: "src/shared/ui/SocialIcon.tsx", reason: "the social networks' own brand colours (Facebook, Strava, YouTube, Instagram gradient): theirs, not the club's palette", count: 6 },
    { path: "src/shared/ui/VideoFacade.tsx", reason: "the play button's dark scrim over the video poster, the same over any picture", count: 1 },
  ],
  icons: [
    { path: "src/app/[locale]/admin/(list)/page.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/checkin/page.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/error.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/guide/page.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 2 },
    { path: "src/app/[locale]/admin/pages/(list)/page.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 4 },
    { path: "src/app/[locale]/admin/pages/members/page.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 2 },
    { path: "src/app/[locale]/admin/registrations/(list)/page.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 4 },
    { path: "src/app/[locale]/devs/page.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/BibPictureField.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/CoHostRowsEditor.tsx", reason: "the move arrows' bare IconButtons name their icon files directly (§694); the add, the bin and the row fold's pencil ask action-icons.ts by name since the row folds (§842); the arrows follow with an icon-only primitive", count: 2 },
    { path: "src/modules/content/events/ui/EventDraftPreview.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 7 },
    { path: "src/modules/content/events/ui/EventListFields.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 3 },
    { path: "src/modules/content/events/ui/LinkRowsEditor.tsx", reason: "the move arrows' bare IconButtons name their icon files directly (§694); the add, the bin and the row fold's pencil ask action-icons.ts by name since the row folds (§842); the arrows follow with an icon-only primitive", count: 2 },
    { path: "src/modules/content/events/ui/PlaceToBeAnnounced.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/PublishCheck.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/RaceStartNotSet.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/SectionMap.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/content/menu/ui/MenuOrderList.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 9 },
    { path: "src/modules/content/pages/ui/PagesSubNav.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 5 },
    { path: "src/modules/content/rich-text/ui/ImageCropBox.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 2 },
    { path: "src/modules/content/rich-text/ui/LazyRichTextEditor.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/content/rich-text/ui/RichTextEditor.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 33 },
    { path: "src/modules/diagnostics/ui/NetworkProbes.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 2 },
    { path: "src/modules/legal-documents/ui/LegalBodyEditor.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 7 },
    { path: "src/modules/media/ui/GalleryPicker.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 7 },
    { path: "src/modules/newsletter/ui/NewsletterPreview.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/newsletter/ui/SubscriberListFields.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 3 },
    { path: "src/modules/registrations/ui/QueuePanel.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 2 },
    { path: "src/modules/registrations/ui/RegistrationRowMenu.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
    { path: "src/modules/staff-identity/ui/AdminTabs.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 12 },
    { path: "src/modules/staff-identity/ui/ColumnVisibility.tsx", reason: "a backoffice file names its icon file directly, which predates the guard (§694) and violates §318/§521; ask action-icons.ts by name when the file is next touched", count: 1 },
  ],
  primitives: [
    { path: "src/app/[locale]/admin/(list)/page.tsx", reason: "a bare MUI Button: GlyphButton / GlyphButtonLink by an action-icons name when the file is next touched; a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 2 },
    { path: "src/app/[locale]/admin/checkin/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/error.tsx", reason: "a bare MUI Button: GlyphButton / GlyphButtonLink by an action-icons name when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/gallery/(list)/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/gallery/[id]/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/legal/new/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/(list)/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/[id]/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/faq/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/members/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/admin/registrations/(list)/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/contact/feedback/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/contact/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/devs/page.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/app/[locale]/error.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/events/[slug]/declaration/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/registrations/declare/[token]/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/registrations/family/[token]/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/registrations/list/[token]/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/registrations/manage/[token]/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched; a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 2 },
    { path: "src/app/[locale]/registrations/mine/[token]/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched; a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 2 },
    { path: "src/app/[locale]/registrations/mine/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/registrations/resend/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/sign-in/page.tsx", reason: "a bare MUI Button: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (a public page never reaches GlyphButton, whose table is the backoffice's) when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/BibPictureField.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/CoHostRowsEditor.tsx", reason: "a bare MUI IconButton for the move arrows: the house has no icon-only primitive yet, add one before migrating (the add buttons and the bins are GlyphButtons since the row folds, §842)", count: 1 },
    { path: "src/modules/content/events/ui/CreateAndPublishButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/EventDraftPreview.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/LinkRowsEditor.tsx", reason: "a bare MUI IconButton for the move arrows: the house has no icon-only primitive yet, add one before migrating (the add button and the bin are GlyphButtons since the row folds, §842)", count: 1 },
    { path: "src/modules/content/events/ui/PlaceToBeAnnounced.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/gallery/ui/PhotoReplaceButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/gallery/ui/PhotoUploader.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/member-codes/ui/CopyCodeButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/menu/ui/MenuOrderList.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/rich-text/ui/ImageCropBox.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/rich-text/ui/PictureLightboxDialog.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/content/rich-text/ui/RichTextEditor.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/deadlines/ui/DeadlinesPanel.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/diagnostics/ui/NetworkProbes.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched; a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 2 },
    { path: "src/modules/events/ui/CalendarSection.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/events/ui/CalendarStepLink.tsx", reason: "a bare MUI IconButton: the house has no icon-only primitive yet, add one before migrating", count: 1 },
    { path: "src/modules/events/ui/EventCard.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/events/ui/EventPageView.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/events/ui/InstagramShareButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/events/ui/ListingFilterPanel.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/events/ui/NativeShareButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/events/ui/RegistrationDoorButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/events/ui/SeriesCard.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/events/ui/SeriesDates.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/events/ui/ShareLinks.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/feedback/ui/EventFeedbackButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/feedback/ui/EventPickerFilter.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/group-run-declarations/ui/DeclarationOffer.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/group-run-declarations/ui/GroupRunDeclarationsPanel.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/legal-documents/ui/LegalBodyEditor.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/media/ui/GalleryPicker.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/newsletter/ui/NewsletterPreview.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/newsletter/ui/NewsletterSignup.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/notifications/ui/OutboxQueuePanel.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/notifications/ui/ParticipantMessageComposer.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/ActionLinkNotice.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/AskFirstButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/CheckYourEmail.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/DeskEmailChip.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/registrations/ui/EmailTwice.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/HiddenListChip.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/registrations/ui/InvitationsPanel.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/registrations/ui/MemberChip.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/registrations/ui/QrScanButton.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/QueuePanel.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/registrations/ui/ReadAndAgree.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/RegistrationRowMenu.tsx", reason: "a bare MUI IconButton: the house has no icon-only primitive yet, add one before migrating", count: 1 },
    { path: "src/modules/registrations/ui/SummaryStrip.tsx", reason: "a bare MUI Chip: GlyphChip (glyph by name) when next touched", count: 1 },
    { path: "src/modules/registrations/ui/TurnstileWidget.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/registration-form.tsx", reason: "a bare MUI Button: backoffice: GlyphButton / GlyphButtonLink by an action-icons name; public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts when the file is next touched", count: 1 },
    { path: "src/modules/staff-identity/ui/ColumnVisibility.tsx", reason: "a bare MUI IconButton: the house has no icon-only primitive yet, add one before migrating", count: 1 },
  ],
  // §766: no toggle glyph and no Material switch, ever. Empty on purpose: a setting is a tick box (`TickButton`, `CheckboxField`); this list has no entry to shrink and none to add.
  toggles: [],
  // §848: no hand-drawn box around a backoffice row — the row fold draws the row (`ROW_SX`).
  rowBoxes: [
    { path: "src/app/[locale]/admin/gallery/[id]/page.tsx", reason: "a grid of photo tiles, not a list of rows: a tile is a framed picture", count: 1 },
    { path: "src/app/[locale]/admin/pages/(list)/page.tsx", reason: "the standard pages as outlined cards; make them rows (`ROW_SX`) when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/team/BoxesCard.tsx", reason: "«Echipa»'s boxes drawn as cards; make them row folds when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/team/page.tsx", reason: "the team's people drawn as cards with their photo; make them row folds when the file is next touched", count: 1 },
    { path: "src/app/[locale]/devs/page.tsx", reason: "`/devs`'s operational limits, read-only facts per provider; make them rows when the file is next touched", count: 1 },
    { path: "src/modules/appearance/ui/HomePagePanel.tsx", reason: "the home strip's pictures as framed cards with their thumbnail; make them rows when the file is next touched", count: 1 },
    { path: "src/modules/content/menu/ui/MenuOrderList.tsx", reason: "the menu order is a drag-free ordered strip of chips, each entry a small framed token, not a row of boxes", count: 1 },
    { path: "src/modules/content/shop/ui/ProductList.tsx", reason: "the shop's products as framed cards with their photo; make them row folds when the file is next touched", count: 1 },
    { path: "src/modules/content/shop/ui/ProductPicturesCard.tsx", reason: "a product's pictures as framed cards with their image; make them rows when the file is next touched", count: 1 },
    { path: "src/modules/design/ui/SampleSection.tsx", reason: "the design page's sample of a featured card: it draws the public card's frame on purpose", count: 1 },
    { path: "src/modules/notifications/ui/OutboxQueuePanel.tsx", reason: "the outbox queue's read-only rows as framed cards; make them rows when the file is next touched", count: 1 },
    { path: "src/modules/notifications/ui/RelayMessagesPanel.tsx", reason: "the relay's read-only rows as framed cards; make them rows when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/DeskRow.tsx", reason: "the desk's row is a card on purpose (§104): its state's red border marks an ended row at a glance", count: 1 },
    { path: "src/modules/staff-identity/ui/AdminTable.tsx", reason: "`AdminTable`'s phone layout: each table row becomes a card below `md`, the table's own drawing (§256)", count: 2 },
  ],
  // §848: a backoffice row's boxes sit inside the row's fold (`shared/ui/row-fold.ts`, §842).
  // §848: no h1 under the backoffice shell's own.
  pageHeadings: [],
  // §848: no backoffice heading sized by hand.
  headingSizes: [
    { path: "src/app/[locale]/admin/(list)/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/checkin/[code]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/checkin/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/badges/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/bibs/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/erase/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/mesaje/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/results/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/[id]/urgente/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/import/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/events/new/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/gallery/(list)/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/app/[locale]/admin/gallery/[id]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/app/[locale]/admin/gallery/new/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/gallery/pictures/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/guide/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/legal/(list)/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/legal/[id]/delete/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/app/[locale]/admin/legal/[id]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 3 },
    { path: "src/app/[locale]/admin/legal/delete/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 3 },
    { path: "src/app/[locale]/admin/legal/new/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/app/[locale]/admin/network/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/(list)/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 3 },
    { path: "src/app/[locale]/admin/pages/[id]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/faq/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/app/[locale]/admin/pages/members/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/new/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/pages/team/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/registrations/(list)/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 3 },
    { path: "src/app/[locale]/admin/registrations/[id]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/registrations/new/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/registrations/person/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 15 },
    { path: "src/app/[locale]/admin/settings/costs/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/shop/products/[id]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/shop/products/new/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/staff/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/tasks/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 8 },
    { path: "src/app/[locale]/admin/volunteers/(list)/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/admin/volunteers/[id]/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/app/[locale]/devs/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 11 },
    { path: "src/app/[locale]/devs/theme/page.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/modules/content/events/ui/EventNoticeFields.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/modules/design/ui/DesignSystem.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/modules/design/ui/section.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/modules/diagnostics/ui/DatabaseSizesPanel.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 3 },
    { path: "src/modules/diagnostics/ui/MonthCostsPanel.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/modules/diagnostics/ui/NetworkProbes.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/modules/diagnostics/ui/VercelUsagePanel.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/modules/legal-documents/ui/LegalRetireSteps.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/modules/newsletter/ui/NewsletterPanel.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
    { path: "src/modules/newsletter/ui/NewsletterPreview.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/modules/notifications/ui/ParticipantMessageComposer.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 3 },
    { path: "src/modules/registrations/ui/BotCheckPanel.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/modules/registrations/ui/InvitationsPanel.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 1 },
    { path: "src/modules/volunteers/ui/VolunteersCard.tsx", reason: "a heading sized by hand from before the backoffice's scale had a name (§848); size it from HEADING_SX by its level, or make it a Panel, when the file is next touched", count: 2 },
  ],
  rowFolds: [
    { path: "src/modules/content/events/ui/CheckpointsCard.tsx", reason: "a GPX file's offered points: a pick list read once, a tick and its kilometre and name side by side to correct before adding, not an edited list", count: 1 },
    { path: "src/modules/registrations/ui/DeskRow.tsx", reason: "the race-day desk's row is a working surface (§104): its number and verbs must be one tap away at the start line, never behind a fold", count: 1 },
    { path: "src/modules/results/ui/ResultRows.tsx", reason: "the results' typed lines are a data-entry grid read across, one runner a line (§844 labelled them); a fold per line would hide the sheet being copied", count: 2 },
    { path: "src/modules/volunteers/badges/ui/BadgeRoleColours.tsx", reason: "one colour pair per role in one save form, read as a table of swatches; fold each role when the file is next touched", count: 1 },
  ],
};

/**
 * §848: the backoffice's links back that still carry a «←» (`admin-verbs.test.ts`), by catalogue key, the same in both
 * languages. The list only shrinks: drop the arrow from the words, then delete the entry and lower the test's count.
 */
export const BACK_ARROWS: readonly { key: string; reason: string }[] = [
  { key: "Admin.desk.backToDesk", reason: "the desk's own back link, drawn as a plain text link with no glyph; give it the back glyph and drop the arrow" },
  { key: "Admin.gallery.backToList", reason: "«← Toate albumele», a plain text link with no glyph; «Înapoi la albume» with the back glyph when the page is next touched" },
  { key: "Admin.pages.backToList", reason: "«← Toate paginile», a plain text link with no glyph; «Înapoi la pagini» with the back glyph when the page is next touched" },
  { key: "Devs.docs.back", reason: "`/devs`'s documents page links back to «Configurație» as plain text; give it the back glyph when the page is next touched" },
  { key: "Devs.theme.back", reason: "the theme lab links back to «Configurație» as plain text; give it the back glyph when the page is next touched" },
];

/** Per rule, the entries and the hits (the sum of the counts): lower them in the same edit that removes an entry or a count. */
export const PINNED = {
  colours: { entries: 13, hits: 29 },
  icons: { entries: 31, hits: 121 },
  primitives: { entries: 77, hits: 81 },
  toggles: { entries: 0, hits: 0 },
  rowBoxes: { entries: 14, hits: 15 },
  pageHeadings: { entries: 0, hits: 0 },
  headingSizes: { entries: 56, hits: 111 },
  rowFolds: { entries: 4, hits: 5 },
} as const;

/**
 * The icon registries: the files that are a name-to-glyph table and so may import
 * `@mui/icons-material` themselves. An explicit list, not a file-name pattern: a component whose
 * name merely says "Glyph" (`GlyphSelect.tsx`, `GlyphButton.tsx`) is not one, and a new registry is
 * a reviewed edit of this file.
 */
export const ICON_REGISTRIES: ReadonlySet<string> = new Set([
  "src/shared/ui/action-icons.ts",
  "src/modules/events/ui/glyphs.ts",
  "src/modules/weather/ui/glyphs.ts",
  "src/modules/content/events/ui/section-glyphs.ts",
  "src/modules/events/ui/link-glyphs.ts",
  "src/modules/events/ui/difficulty-glyphs.ts",
  "src/modules/events/ui/co-host-glyphs.tsx",
  "src/modules/feedback/ui/branch-glyph.ts",
  "src/shared/ui/button-glyph.ts",
  "src/shared/ui/panel-glyphs.ts",
  "src/shared/ui/status-glyphs.ts",
  "src/modules/content/team/ui/TeamLinkGlyph.tsx",
  // The home page's steps and reasons (§714): its own table, so the public GLYPHS stays as it is (§707).
  "src/modules/home/ui/home-glyphs.ts",
]);

export const isIconRegistry = (file: string): boolean => ICON_REGISTRIES.has(file);

/** Where the primitives are written in a scanned area: not a place to forbid MUI's own button. */
export const PRIMITIVE_FILES: ReadonlySet<string> = new Set(["src/modules/events/ui/GlyphChip.tsx"]);

/** `src/app/**` and every `src/modules/<area>/**\/ui/**`: the pages and the areas' components. */
export const inPrimitiveScope = (file: string): boolean => file.startsWith("src/app/") || (file.startsWith("src/modules/") && file.includes("/ui/"));

/**
 * Where a file is backoffice for the icon guard (§694): a backoffice file asks `action-icons.ts` by
 * name (§318, §521); a public one imports its one icon file directly, so the registry's table stays
 * off public routes. A route and a few areas are backoffice by their path; the rest are the files of
 * a mixed area (`registrations`, `newsletter`) that only the staff's screens render, listed by name.
 */
const BACKOFFICE_PREFIXES = [
  "src/app/[locale]/admin/",
  "src/app/[locale]/devs/",
  "src/modules/club-todo/",
  "src/modules/event-todos/",
  "src/modules/content/",
  "src/modules/design/",
  "src/modules/diagnostics/",
  "src/modules/legal-documents/ui/",
  "src/modules/media/ui/",
  "src/modules/notifications/ui/",
  "src/modules/staff-identity/",
];
/**
 * Public files under a backoffice prefix: the members' zone's codes and the rich text a visitor reads,
 * with the lightbox that enlarges its pictures. A single-file icon import there is the rule.
 */
const PUBLIC_PREFIXES = [
  "src/modules/content/member-codes/",
  "src/modules/content/rich-text/ui/PictureLightbox",
  "src/modules/content/rich-text/ui/RichText.tsx",
  "src/modules/content/rich-text/ui/RichTextVideo.tsx",
];
const BACKOFFICE_FILES: ReadonlySet<string> = new Set([
  // «Spune-ne ceva»'s settings on «Pagini» → «Contact» (§676, rows since §842): the staff's; the public wizard beside it stays public.
  "src/modules/feedback/ui/FeedbackFormsPanel.tsx",
  "src/modules/newsletter/ui/NewsletterPreview.tsx",
  "src/modules/newsletter/ui/SubscriberListFields.tsx",
  // The event editor's «Voluntari» card (§754): the staff's; the public form beside it, `VolunteerBox`, stays public.
  "src/modules/volunteers/ui/VolunteersCard.tsx",
  // One volunteer's block (§839), drawn by the card above and by the person's own page under «Voluntari»: the staff's.
  "src/modules/volunteers/ui/VolunteerPerson.tsx",
  // The card's «Cine se poate oferi» and «Invitații» (§820): the staff's, drawn inside the card above.
  "src/modules/volunteers/ui/VolunteerAccessChoice.tsx",
  "src/modules/volunteers/ui/VolunteerInvitations.tsx",
  // A race's «Clasament» lines (§808): the staff's; the public results beside them are another file of the same area.
  "src/modules/results/ui/ResultRows.tsx",
  "src/modules/registrations/ui/DeskRow.tsx",
  "src/modules/registrations/ui/InviteForm.tsx",
  "src/modules/registrations/ui/QueuePanel.tsx",
  "src/modules/registrations/ui/RegistrationRowMenu.tsx",
  // A registration's state chip (§847): drawn by the list, the registration's page and the desk — the staff's.
  "src/modules/registrations/ui/RegistrationStatusChip.tsx",
]);

export const isBackoffice = (file: string): boolean =>
  !PUBLIC_PREFIXES.some((prefix) => file.startsWith(prefix)) && (BACKOFFICE_FILES.has(file) || BACKOFFICE_PREFIXES.some((prefix) => file.startsWith(prefix)));

# Viewer-proof cover rendering (HTML/CSS → Chromium → PDF) and copy-space prompting

Research date: 2026-10-23. Scope: (1) which Chromium/Skia-exported PDF constructs are fragile across viewers (Edge/Adobe, Acrobat, macOS Preview/Quartz, PDFium, pdf.js, Poppler) and what the safe equivalents are; (2) how to prompt image models to leave clean title space without painting panels/text.

Primary evidence was read directly from current Skia and Chromium source (main branch, fetched 2026-10-23) because the published Skia PDF docs are stale on several points; those file URLs are cited inline.

---

## KQ1. Exactly which Chromium-exported PDF constructs do Edge's PDF viewer (and other viewers) fail to render?

### Takeaway
The one Microsoft-documented limitation ("Function-based shadings are not supported (their presence is ignored)") belongs to the **pre-Chromium (EdgeHTML) Edge PDF reader** spec, not to the Adobe-engine viewer; **no published list of unsupported constructs exists for the Adobe-powered Edge viewer** (GA Oct 2025, legacy viewer retired Sept 2026). The constructs with the strongest cross-viewer failure evidence are: ShadingType 1 (function-based) shadings, which Chromium emits for conic/sweep and repeating gradients; luminosity soft masks (SMask) which Chromium emits for every blurred shadow, every alpha-stop gradient (on Windows/Linux) and every mask-image; blend modes; and text drawn with mask filters (Chromium itself works around PDFium and Preview bugs here).

### Cited Findings

**Edge viewer identity and timeline**
- Microsoft's "[MS-PDF]: Microsoft Edge ISO 32000-1 PDF Standards Support Document" (revision 1.1, last published 1/14/2019, page updated 2025-07-11) is filed under "Internet Explorer Standards Support Documentation" — i.e. it describes the legacy EdgeHTML-era reader. — [Microsoft Learn MS-PDF overview](https://learn.microsoft.com/en-us/openspecs/ie_standards/ms-pdf/)
- That spec, section 8.7.4.5.2: "Microsoft Edge: Function-based shadings are not supported (their presence is ignored)." — [Microsoft Learn MS-PDF §8.7.4.5.2](https://learn.microsoft.com/en-us/openspecs/ie_standards/ms-pdf/ca873dd7-27d4-44f0-823a-381330052c54)
- The PDF Association made the same point about Edge ("Microsoft does not support Type 1 (function-based) shadings… Some pages might be blank. Others, possibly missing images") — search snippet only; the page returned HTTP 403 on fetch so the article date could not be confirmed and it most likely refers to the EdgeHTML-era viewer. — [PDF Association, "What does 'support PDF' really mean?"](https://pdfa.org/what-does-support-pdf-really-mean/)
- Current Microsoft Edge docs (ms.date 2024-07-18): "Because Microsoft Edge is Chromium-based, users can expect the same level of reliability that they're used to seeing in other Chromium-based browsers." Listed constraints: "XML Forms Architecture (XFA)… isn't supported" and JavaScript forms unsupported. No rendering-construct limitations are listed. — [Microsoft Learn: PDF reader in Microsoft Edge](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-pdf)
- Adobe/Microsoft announced in Feb 2023 that Acrobat's engine would become Edge's built-in PDF renderer, promising "improved quality for more accurate colors and graphics". — [BornCity, 2023-02-09](https://borncity.com/win/2023/02/09/microsoft-edge-gets-adobe-acrobat-as-pdf-reader/)
- Microsoft 365 Message Center MC1072406 (published 2025-05-12, updated 2026-05-18): Adobe-engine viewer in Edge for Business "We will begin rolling out mid-October 2025 and expect to complete by late October 2025"; "the legacy PDF viewer will be retired in September 2026". Lists only improvements (color profile support, CJK fonts, text selection); no known issues. — [MC1072406 mirror](https://mc.merill.net/message/MC1072406)
- Windows Latest (2025-04-16) reported the mandatory rollout began Sept 2025 with legacy removal in 2026 — [Windows Latest](https://windowslatest.com/2025/04/16/microsoft-edge-will-auto-update-pdf-to-adobe-engine-wont-kill-off-legacy-pdf-until-2026); Winaero earlier reported the Acrobat engine "fails to render some of the XFA forms" that the classic engine showed. — [Winaero](https://winaero.com/microsoft-will-keep-the-classic-pdf-edge-viewer-until-at-least-2025)
- Microsoft Tech Community thread (2026-07-06): with the "New PDF View" enabled, vendor invoice PDFs "display as blank pages"; the poster attributes it to "a certain logo type or watermark in the header"; the edge://flags opt-out stopped working; a registry policy `NewPDFReaderEnabled = 0` still worked on 2026-07-23; advice was to "have affected PDFs open in a desktop PDF reader until Microsoft fixes the rendering issue". No bug ID. — [Microsoft Tech Community](https://techcommunity.microsoft.com/discussions/edgeinsiderdiscussions/workaround-for-edgeflagsedge-new-pdf-viewer-but-the-new-pdf-view-showing-blank-p/4534214)
- Adobe Community (June 2024): "ff" ligature characters missing in some PDFs viewed in Edge; accepted answer blamed Edge's rendering of unembedded/non-subset fonts and recommended re-embedding fonts. — [Adobe Community](https://community.adobe.com/questions-9/pdfs-opened-in-edge-have-characters-missing-1293719)
- Adobe Community (2021): gradient-filled headings rendered wrong in Chrome and Edge but fine in Acrobat; experts suspected the gradient on type or a non-embedded font; the fix was outlining the text. — [Adobe Community](https://community.adobe.com/t5/acrobat/pdf-graphics-not-rendering-in-chrome-edge/m-p/11867815)

**pdf.js (Firefox, and many embedded web viewers)**
- pdf.js issue #11971 (2020-06-05): printing an HTML page with a `repeating-linear-gradient` background to PDF from a browser produced "Warning: FormatError: Unsupported ShadingType: 1"; Chromium-based Vivaldi rendered it correctly; closed as duplicate of #5046. — [pdf.js #11971](https://github.com/mozilla/pdf.js/issues/11971)
- pdf.js issue #19233 (2024-12-17): PDFs produced with "Puppeteer (or any HTML-to-PDF library)" containing a CSS conic gradient log "Unsupported ShadingType: 1" and "the conic gradient is replaced by a pink fallback color"; Chrome's viewer renders it correctly. A commenter on 2026-01-29 reported it "persists in PDF.js 5.4.445 with Gotenberg-generated PDFs". — [pdf.js #19233](https://github.com/mozilla/pdf.js/issues/19233)
- pdf.js PR #21012 "Add support for function-based shadings (bug 1254066)" was merged into master on 2026-03-31 (commit f33f816), closing #5046 ("Pink background", open since 2014-07-15). Implementation: a mesh covering the pattern rectangle with vertex colours computed from the function, generated in the worker so "the current transform isn't applied when the mesh is drawn". — [pdf.js PR #21012](https://github.com/mozilla/pdf.js/pull/21012); [pdf.js #5046](https://github.com/mozilla/pdf.js/issues/5046)
- Current pdf.js master `src/core/pattern.js` has `class FunctionBasedShading` and still throws `FormatError("Unsupported ShadingType: " + type)` for anything outside types 1–7. — [pdf.js pattern.js](https://github.com/mozilla/pdf.js/blob/master/src/core/pattern.js)

**PDFium (Chrome/Edge-classic viewer) and macOS Preview**
- Skia's PDF device source carries this comment: "TODO: SkPDFFont has code to handle paints with mask filters, but the viewers do not. See https://crbug.com/362796158 for Pdfium and b/325266484 for Preview" — and therefore draws any text run with a mask filter (e.g. a blurred text-shadow) as paths. — [Skia SkPDFDevice.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFDevice.cpp) (the crbug page itself requires sign-in and could not be read)
- Chromium's PDF document factory enables `fRasterizeAlphaGradientsForPrinting = true` **only on macOS**, with the comment "Avoid macOS PDF-to-PostScript aborts on Skia alpha-gradient soft masks." — [Chromium printing/common/metafile_utils.cc (main)](https://chromium.googlesource.com/chromium/src/+/main/printing/common/metafile_utils.cc)
- Firefox bug 1851954: a `linear-gradient` with an alpha mask saved to PDF on macOS 13 rendered as "a red square" in Firefox, Chrome, Acrobat and Foxit alike; "very likely not a pdf.js issue but an issue with Quartz"; Windows output was correct. (Generator-side Quartz bug, but shows the gradient+mask combination is the fragile class.) — [Mozilla Bugzilla 1851954](https://bugzilla.mozilla.org/show_bug.cgi?id=1851954)
- Autodesk forum moderator: "There is a bug in macOS which results in printing alpha channel (fully transparent part of raster image) in black. The workaround is to print from Adobe Reader." Anecdotal; applies to Preview/OS printing path. — [Autodesk forums](https://forums.autodesk.com/t5/autocad-for-mac-forum/hatch-issues-in-pdf-print-outs/m-p/9131341)

**Poppler (Linux viewers: Evince, Okular, pdftoppm)**
- Poppler issue #1210: a file "generated by Chromium v97 printing an SVG file to PDF" containing an ellipse mask over a rectangle: "With the cairo backend, the mask is not working and the whole rectangle shows. The splash backend renders it correctly." — [Poppler issue 1210](https://gitlab.freedesktop.org/poppler/poppler/-/issues/1210)

**Acrobat / Adobe engines and blend modes**
- Adobe Community: Acrobat's Embed API can display a PDF incorrectly when it uses unsupported blend modes; the workaround was flattening the affected areas in Acrobat. — [Adobe Community](https://community.adobe.com/questions-21/adobe-pdf-embeded-api-render-failure-311324)
- Adobe Community (2025): "exclusion" blend mode on text renders wrong only in Acrobat Reader for Windows below a certain zoom, while other viewers were correct. — [Adobe Community](https://community.adobe.com/questions-12/bug-report-blend-mode-exclusion-not-rendered-correctly-1506843)
- Adobe Community expert on masks: "usually with a PDF when it works in Acrobat it's OK, but on other viewers there's no guarantee that it will work"; opacity masks in particular may not work in non-Acrobat readers. — [Adobe Community](https://community.adobe.com/questions-525/image-masking-not-working-in-pdf-on-websites-1535371)

### Inferences
- The "Edge drops Type 1 shadings" claim that circulates online traces to the EdgeHTML-era viewer spec; the current Edge "classic" viewer is PDFium (same engine family as Chrome, so it renders Chromium output faithfully), and the Adobe engine is Acrobat-derived. Any construct that renders in Acrobat Reader is therefore the best available proxy for the Adobe-engine Edge viewer, but blank-page reports for the new viewer (July 2026) show it is not bug-free.
- The constructs that fail in at least one mainstream viewer are exactly the transparency/shading constructs: ShadingType 1 (pdf.js < Mar 2026, legacy Edge), SMask luminosity masks (Poppler-cairo, macOS PostScript path, Preview on text), blend modes (Acrobat Embed API, Reader exclusion bug). A cover built from opaque fills, paths, embedded TrueType text and DCT/Flate images without SMask has no documented failure mode in any viewer surveyed.

### Gaps
- No Microsoft or Adobe document lists unsupported PDF constructs for the Adobe-powered Edge viewer; its behaviour on SMask/ShadingType 1/blend modes could only be established by direct testing.
- crbug.com/362796158 (PDFium text-with-mask-filter bug) could not be read (sign-in wall); only Skia's comment referencing it is available.
- The PDF Association article (pdfa.org) returned 403; its exact wording and date are unverified.
- No release notes or changelog for Edge's PDF rendering engine were found for 2024–2026.

---

## KQ2. How does Chromium's PDF export actually encode web fonts, shadows, gradients, border-radius, opacity, masks and images? (UNSAFE vs SAFE catalogue)

### Takeaway
Read from current Skia/Chromium source: TrueType web fonts are HarfBuzz-subset and embedded; **CFF/OpenType-CFF fonts are downgraded to Type 3 since Sept 2024**; any blur (box-shadow, text-shadow, mask filter) is rasterised into a greyscale image used as a **luminosity soft mask**, and blurred text is converted to paths; clamp-mode linear/radial gradients become ShadingType 2/3, while conic/sweep, repeating and perspective gradients become **ShadingType 1 with a PostScript (Type 4) function**; gradients with any transparent stop also get a soft mask (except on macOS where Chromium rasterises them); JPEG images with YCbCr/Gray colour pass through as DCTDecode, everything else is Flate-encoded with a Flate SMask for alpha; Chromium never re-encodes images to JPEG.

### Cited Findings

**Fonts**
- Skia PDF theory doc: "we embed all fonts in accordance with modern PDF guidelines"; "Chrome uses the HarfBuzz subsetter to provide subsetting support to Skia for TrueType fonts"; "the PDF backend always uses the glyph-id encoding of the text"; Type 3 is used for non-TrueType fonts on non-Linux platforms and for do-not-embed fonts; "a Type3 font is an array of form x-objects (content streams) that draw each glyph of the font" with "no hinting or kerning information" and glyphs segmented "into groups of 255". — [Skia PDF Theory of Operation](https://skia.org/docs/dev/design/pdftheory/)
- `SkPDF::Metadata` default: `fSubsetter = kHarfbuzz_Subsetter`. — [Skia include/docs/SkPDFDocument.h (main)](https://skia.googlesource.com/skia/+/refs/heads/main/include/docs/SkPDFDocument.h)
- Skia commit "[pdf] Give up on embedding CFF" (Ben Wagner, 2024-09-24): "Several attempts have been made to embed CFF data in the generated PDFs"; "OpenType in PDF is still not universally supported"; bare CFF "requires writing out the internal CID values which Skia does not know"; CFF fonts are now forced to the Type3 fallback and the FontFile3 embedding code was removed. — [Skia commit 3541cdf](https://skia.googlesource.com/skia.git/+/3541cdf2fae66d3ab4299eaeba20d234d2f7c84c%5E%21)
- Skia 2016 change "SkPDF: Subset Type3 (fallback) font" — Type3 fallback fonts are also subset to reduce file size. — [Skia commit 88b138d](https://skia.googlesource.com/skia/+/88b138da99328b04cae9a8ee19c3882b8847a550%5E%21)
- Puppeteer `pdf()` option `waitForFonts` (default `true`) "Waits for `document.fonts.ready` before rendering"; `printBackground` default `false` ("Set to `true` to print background graphics"); `preferCSSPageSize` makes a CSS `@page` size take priority; `omitBackground` removes the default white page background (produces transparency — avoid for print). — [Puppeteer PDFOptions](https://pptr.dev/api/puppeteer.pdfoptions)

**Shadows, blur, mask filters (box-shadow, text-shadow, filter: blur/drop-shadow, mask-image)**
- Skia's published limitation table still says SkMaskFilter is "drop" for text and "ignore" for images/everything else, and SkImageFilter is "expand" ("implement something in a non-PDF-ish way… rasterize vector graphics… convert text to paths") with the note "text-as-text is lost". — [Using Skia's PDF Backend](https://skia.org/docs/user/sample/pdf/)
- Current source contradicts the "ignore" entry: `SkPDFDevice::internalDrawPathWithFilter` renders the path to an A8 mask, runs `filterMask`, converts to a greyscale image, then — comment: "PDF doesn't seem to allow masking vector graphics with an Image XObject. Must mask with a Form XObject." — draws the fill rectangle under `GetSMaskGraphicState(... kLuminosity_SMaskMode ...)` and then resets with an ExtGState `/SMask /None`. Images with a mask filter take the same route (`paint->getMaskFilter()` → shader + `internalDrawPath`). — [Skia SkPDFDevice.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFDevice.cpp)
- Same file, glyph drawing: `if (this->localToDevice().hasPerspective() || runPaint.getMaskFilter()) { this->drawGlyphRunAsPath(...); return; }` — text with a mask filter is converted to paths. — [Skia SkPDFDevice.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFDevice.cpp)
- Chromium (Feb 2017, bug 127651) once skipped box-shadows entirely when printing because "Skia's PDF backend lacks support for mask filters, and currently draws solid black boxes." — [Chromium code review 2689733002](https://codereview.chromium.org/2689733002). Current Blink `box_painter_base.cc` has no printing special-case for shadows (only "Avoid image shaders when printing (poorly supported in PDF)" for rounded fills), so shadows now flow through the Skia SMask path above. — [Chromium box_painter_base.cc (main)](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/paint/box_painter_base.cc)
- Skia change note on image filters: "The PDF backend does not support image filters, so it simply removes them… The fix here is to fall back to a raster device for image filters." — [Chromium code review 1115513002](https://codereview.chromium.org/1115513002); current SkPDFDevice has `makeSurface()` and the comment "need to return a raster device, which we will detect in drawDevice()". — [Skia SkPDFDevice.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFDevice.cpp)
- Chromium sets `metadata.fRasterDPI = 300.0f` for all PDF output — so anything rasterised (masks, image filters, fallback shaders) is at 300 DPI. — [Chromium metafile_utils.cc (main)](https://chromium.googlesource.com/chromium/src/+/main/printing/common/metafile_utils.cc)
- Vendor report (2017, Chromium-based EO.Pdf): "The new Chromium browser engine does not render shadow when printing"; a print-media `drop-shadow` filter showed in print preview but not in the PDF. (Old engine; included for history.) — [EssentialObjects forum](https://www.essentialobjects.com/forum/postst10482_CSS-text-shadow-missing.aspx)
- PrinceXML's explanation of why blur is expensive in PDF: shadows "require rendering the text or box to a bitmap image and then applying filter effects to that", making the PDF bigger and possibly pixelated. — [PrinceXML forum](https://www.princexml.com/forum/topic/5250/a-couple-of-issues-with-box-shadow)

**Gradients → shadings**
- `SkPDFGradientShader.cpp` (main): `doStitchFunctions` is true only for Linear/Radial/Conical gradients with tile mode Clamp or Decal, no perspective and no premul interpolation; those become `ShadingType` Axial (2) or Radial (3) with stitched functions (`FunctionType 3` wrapping `FunctionType 2` segments) and `/Extend [true true]`. Everything else — including `kSweep` (CSS conic-gradient), repeat/mirror tile modes (CSS `repeating-*-gradient`), and perspective — falls to `shadingType = ShadingType::Function` (1) with a `FunctionType 4` PostScript calculator. — [Skia SkPDFGradientShader.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFGradientShader.cpp)
- Same file: `if (doc->metadata().fRasterizeAlphaGradientsForPrinting && makeAlphaShader) return SkPDFIndirectReference();` — i.e. when the flag is on, gradients with alpha stops are not emitted as shadings and fall to `make_fallback_shader`, which draws to an `SkSurfaces::Raster` and embeds the result as a clamped image shader. — [SkPDFGradientShader.cpp](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFGradientShader.cpp); [SkPDFShader.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFShader.cpp)
- Skia header: "If true, rasterize gradients with non-opaque stops for print compatibility. Intended only for physical printing; it trades vector fidelity and file size to avoid PDF-to-PostScript converter bugs." Default `false`. Chromium enables it only under `BUILDFLAG(IS_MAC)`. — [SkPDFDocument.h](https://skia.googlesource.com/skia/+/refs/heads/main/include/docs/SkPDFDocument.h); [metafile_utils.cc](https://chromium.googlesource.com/chromium/src/+/main/printing/common/metafile_utils.cc)
- Skia PDF theory: gradient tiling for non-clamp modes is implemented by "extra PostScript" in a type 4 function; image shaders are tiled patterns; mirroring draws the image reversed; clamp mode stretches edge pixels. — [Skia PDF Theory of Operation](https://skia.org/docs/dev/design/pdftheory/)

**Opacity, blend modes, layers**
- Skia PDF theory: layers are implemented as form x-objects; alpha is a graphic-state parameter; "PDF supports some of the xfer modes used in Skia directly" (Multiply, Screen, Overlay, etc. via the graphic-state blend mode); Porter-Duff modes are emulated "by creating form x-objects out of part of the content and drawing it with a another form x-object as a mask"; "SrcAtop Xor, and Plus xfer modes are not supported." — [Skia PDF Theory of Operation](https://skia.org/docs/dev/design/pdftheory/)
- Skia limitation table: unsupported SkXferModes (DstOver, SrcIn, DstIn, SrcOut, DstOut, SrcATop, DstATop, Modulate) are "ignored" — "draw without the effect". — [Using Skia's PDF Backend](https://skia.org/docs/user/sample/pdf/)
- PrinceXML: CSS `mix-blend-mode` looks right in browser but is lost in PDF conversion; supporting it "would require rasterizing parent content". — [PrinceXML forum](https://princexml.com/forum/topic/4029?post=24806)

**Images**
- `SkPDFBitmap.cpp` (main): `serialize_image` first tries `img->refEncodedData()` → `do_jpeg`, which requires `doc->metadata().jpegDecoder`, decodes the header, and accepts only `jpegColorType == kYUV_Color || kGray_Color` with matching dimensions; on success the stream is emitted with `/Filter /DCTDecode` (passthrough, no transcode). Otherwise pixels are obtained; if a `jpegEncoder` exists, `encodingQuality <= 100` and the image `isOpaque`, it is JPEG-encoded; else `do_deflated_image` writes `/Filter /FlateDecode`, and for non-opaque images reserves an `/SMask` ref filled by `do_deflated_alpha`. — [Skia SkPDFBitmap.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFBitmap.cpp)
- `SkPDFDocument.cpp` fills in defaults when the client supplies none: `if (!meta.jpegDecoder) meta.jpegDecoder = SkPDF::JPEG::Decode; if (!meta.jpegEncoder) meta.jpegEncoder = SkPDF::JPEG::Encode;`. — [Skia SkPDFDocument.cpp (main)](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFDocument.cpp)
- `SkPDF::Metadata::fEncodingQuality` defaults to 101: "If this value is set to a value <= 100, and the image is opaque, it will be encoded (using JPEG) with that quality setting." Chromium's `MakePdfDocument` does not set it. — [SkPDFDocument.h](https://skia.googlesource.com/skia/+/refs/heads/main/include/docs/SkPDFDocument.h); [metafile_utils.cc](https://chromium.googlesource.com/chromium/src/+/main/printing/common/metafile_utils.cc)
- Skia issue on DCTDecode: "DCTDecode simply wants a JPG file as the stream content, with no transform of the data needed." — [Skia issue 40031195](https://issues.skia.org/40031195)

**Prepress corroboration**
- KDP cover guidelines: "Flatten all transparencies. These can cause the file to print with missing or distorted content."; "Embed your fonts."; images "flattened to one layer", "a minimum resolution of 300 DPI", CMYK recommended; don't include spot colors. — [KDP Paperback Cover Guidelines](https://kdp.amazon.com/en_US/help/topic/G201953020)
- IngramSpark blog: files without embedded fonts "won't be accepted"; IngramSpark recommends PDF/X-1a (2001) or PDF/X-3 (2002). — [IngramSpark blog](https://www.ingramspark.com/blog/understanding-ingramspark-title-processing)
- Adobe Community: PDF/X-1a cannot contain live transparency, so the producing software must flatten it first. — [Adobe Community](https://community.adobe.com/t5/indesign-discussions/transparency-compliance-with-pdf-x-1a/m-p/9277606)

### UNSAFE vs SAFE catalogue (synthesised from the findings above)

| CSS/HTML construct | What Chromium/Skia emits in the PDF | Risk class | Evidence |
|---|---|---|---|
| `box-shadow` with blur, `text-shadow` with blur | Raster greyscale mask (300 DPI) used as a **luminosity SMask** on a form XObject; shadowed text becomes **paths** | UNSAFE (SMask; text-as-text lost) | SkPDFDevice.cpp; crbug 362796158 / b/325266484 refs |
| `filter: blur()/drop-shadow()`, `backdrop-filter` | Image filter → "expand": content rasterised via raster device fallback | UNSAFE (raster; text lost) | Skia docs table; CL 1115513002 |
| `mask-image`, `-webkit-mask`, SVG `<mask>` | Porter-Duff mask emulated via form XObject soft mask | UNSAFE (SMask; Poppler-cairo ignores; macOS/Quartz issues) | Skia theory doc; Poppler #1210 |
| `linear-gradient`/`radial-gradient` with **opaque** stops, non-repeating | ShadingType 2/3 with stitched Type 2 functions | Medium (widely supported; still a shading; legacy readers vary) | SkPDFGradientShader.cpp |
| Any gradient with an **rgba/transparent stop** | Shading **plus** alpha-shader SMask (Win/Linux); rasterised on macOS | UNSAFE | SkPDFGradientShader.cpp; metafile_utils.cc "macOS PDF-to-PostScript aborts" |
| `conic-gradient`, `repeating-*-gradient`, gradient under perspective transform | **ShadingType 1** + Type 4 PostScript function | UNSAFE (pdf.js pink until Mar 2026; legacy Edge ignores) | SkPDFGradientShader.cpp; pdf.js #19233/#11971; MS-PDF |
| `opacity: <1`, `rgba()` fills | ExtGState `ca`/`CA`, transparency group form XObject | Medium–UNSAFE for print (PDF/X-1a forbids; KDP "flatten all transparencies") | Skia theory doc; KDP |
| `mix-blend-mode` | ExtGState `/BM` (multiply, screen…) or emulated masks; some modes dropped | UNSAFE (viewer-dependent; Acrobat Embed API/Reader bugs) | Skia docs; Adobe threads |
| PNG with alpha, `<img>` with transparency | Flate RGB image + Flate `/SMask` | UNSAFE-ish (large; SMask printing bugs on macOS) | SkPDFBitmap.cpp; Autodesk forum |
| JPEG (YCbCr or Gray), opaque | **DCTDecode passthrough**, no SMask | SAFE | SkPDFBitmap.cpp; SkPDFDocument.cpp defaults |
| CMYK JPEG | Fails `goodColorType` → decoded → Flate (no re-encode because quality=101) | SAFE but bloated | SkPDFBitmap.cpp |
| Solid `background-color`, `border`, `border-radius` | Vector path fills/strokes (`re f`, Bézier paths) | SAFE | Skia theory doc (paths) |
| `clip-path: polygon()/circle()/inset()` on opaque content | Vector clip (`W n`) | SAFE (inference: basic-shape clips are canvas clips, no transparency) | — |
| TrueType / OpenType-TT web font (incl. WOFF2→TTF) | Embedded HarfBuzz subset, glyph-id encoded | SAFE | Skia theory doc; SkPDFDocument.h |
| OpenType-**CFF** (.otf) font | **Type 3** font of glyph form XObjects, no hinting | Medium (renders; text selection/search/accessibility degrade; legacy-viewer font quirks) | Skia commit 3541cdf |
| `-webkit-text-stroke` | Stroked glyph outlines (vector) | SAFE (inference: stroke is a paint style; see KQ3) | — |
| Rounded element with `background-image` | Blink avoids image shaders when printing ("poorly supported in PDF") → clipped image draw | SAFE | box_painter_base.cc |

### Inferences
- Because Chromium leaves `fEncodingQuality` at 101 and only passes through already-encoded JPEG bytes, the only way to get a compact, opaque, SMask-free raster into the PDF is to supply an **sRGB YCbCr JPEG file** (not PNG, not CMYK JPEG) as the `<img>`/`background-image` source. A PNG cover art would be Flate-encoded (lossless, several× larger) and, if it has an alpha channel, would carry an SMask.
- `text-shadow` with `blur-radius: 0` probably avoids the mask filter (Blink only needs a blur mask for non-zero blur), but this was not verified in Blink's text painter source; duplicating the text as a separate offset element is guaranteed-vector and is the recommended path.
- The Skia docs page (skia.org "Using Skia's PDF Backend") is out of date relative to the source on mask filters: shadows are no longer dropped/ignored but rasterised into luminosity soft masks. Treat the source as authoritative.
- A simple "viewer-proof lint" is possible: dump the PDF (e.g. `qpdf --qdf --object-streams=disable in.pdf out.pdf`, or `pdfimages -list`) and fail the build if it contains `/SMask` (other than `/SMask /None`), `/ShadingType 1`, `/BM` other than `/Normal`, `/ca`/`/CA` < 1, `/Subtype /Type3`, or image streams with `/FlateDecode` where a JPEG was intended. (Inference from the constructs catalogued above; tool commands not verified in this session.)

### Gaps
- Blink's handling of `text-shadow` with zero blur (mask filter or not) was not confirmed from source.
- Whether `-webkit-text-stroke` is emitted as a PDF text render mode (`Tr 1/2`) or as stroked paths was not confirmed; either is vector and opaque.
- No measurement of the file-size/quality trade-off of 300-DPI rasterised masks was found.

---

## KQ3. Minimal safe recipe for band/plate, badge, ribbon, outlined title, hard shadow, rounded frame, vignette — zero transparency

### Takeaway
Every decoration can be built from opaque vector fills (solid colours, `border-radius`, `clip-path: polygon()`), opaque vector text (embedded TrueType, `-webkit-text-stroke`, duplicated offset text for hard shadows) and one opaque JPEG hero image with any fade/vignette already baked in; the recipe never emits a shading, soft mask, blend mode or alpha.

### Cited Findings
- Vector shapes: PDF paths are the native representation Skia emits for fills and strokes; alpha, line cap/join, width and blend are graphic-state parameters ("PDF does not allow specifying color in the graphic state object"). — [Skia PDF Theory of Operation](https://skia.org/docs/dev/design/pdftheory/)
- Adobe Community fix for gradient-on-type rendering differences in Chrome/Edge: convert text to outlines. — [Adobe Community](https://community.adobe.com/t5/acrobat/pdf-graphics-not-rendering-in-chrome-edge/m-p/11867815)
- PrinceXML: no easy way to blur in PDF; the approach is to "render the blurred element to an image and embed it". — [PrinceXML forum](https://www.princexml.com/forum/topic/1020?post=7252)
- Inkscape users: a mask exported to PDF came out jagged while a clip path looked clean, attributed to masks being treated as bitmaps. — [Inkscape forum](https://inkscape.org/ar/forums/beyond/why-clip-image-gives-different-result-than-mask-when-exporting-to-pdf)
- Puppeteer: `printBackground: true` is required for background colours/images; `preferCSSPageSize: true` honours `@page` size. — [Puppeteer PDFOptions](https://pptr.dev/api/puppeteer.pdfoptions)

### Inferences (the recipe — each line maps to a SAFE row in the KQ2 table)
1. **Title band / plate**: `<div style="background:#2b1d14">` (hex/rgb only, never rgba/opacity) → one `re f` fill. For a "paper" plate add a 2–4 px solid `border` in a darker tone instead of a shadow.
2. **Badge / sticker circle**: `width/height` equal, `border-radius:50%`, solid background, solid `border` (scalloped edge: a second, slightly larger circle in a contrasting solid colour behind it, or `clip-path: polygon(...)` star/scallop with many points — basic-shape clips stay vector).
3. **Ribbon / banner**: solid-colour `div` with `clip-path: polygon(...)` notched ends (e.g. `polygon(0 0,100% 0,100% 100%,0 100%,8% 50%)`), and a second darker polygon behind for the folded tail. No `transform: skew` needed; if used, keep it affine (no `perspective()`, which forces gradients/shaders to Type 1 and text to paths).
4. **Outlined title**: `-webkit-text-stroke: 6px #2b1d14; paint-order: stroke fill;` with a solid fill colour. Belt-and-braces: render the title twice — bottom copy with the stroke, top copy fill-only — both are opaque vector text.
5. **Hard drop shadow**: duplicate the title in an absolutely positioned element offset `(3px, 4px)` in a solid dark colour, `z-index` under the main copy. Never `text-shadow` with blur (→ SMask + outlines) and avoid even zero-blur `text-shadow` until verified.
6. **Rounded frame / border**: `border: 10px solid #cream; border-radius: 24px;` → vector path. For a double frame, nest two divs. No `box-shadow`, no `outline-offset` tricks with transparency.
7. **Vignette / soft fade behind the title**: bake into the hero JPEG with sharp (KQ4). If a purely vector approximation is needed, a stepped stack of 6–10 solid-colour bands/ellipses (posterised fade) is still SMask-free but visibly banded; the JPEG bake is preferred.
8. **Hero image**: serve as an opaque sRGB YCbCr JPEG (quality ≈ 90, 4:4:4 chroma) sized to the exact print pixel dimensions (≥300 DPI at trim) so Skia passes it through as DCTDecode with no SMask and no resampling.
9. **Fonts**: use TrueType-outline web fonts (`.ttf` or WOFF2 wrapping TTF) so they embed as subset TrueType, not Type 3; keep `waitForFonts` on.
10. **Page**: `@page { size: Wmm Hmm; margin:0 }`, `printBackground:true`, `preferCSSPageSize:true`, `-webkit-print-color-adjust: exact` on the root so Blink's print-economy path never whitens backgrounds (box_painter_base.cc `ShouldForceWhiteBackgroundForPrintEconomy`).

### Gaps
- No published source demonstrates this exact recipe end-to-end; it is assembled from the Skia/Chromium mechanics in KQ2. A one-off lint of a rendered cover (search the PDF for `/SMask`, `/ShadingType`, `/BM`, `/Type3`) would confirm it.

---

## KQ4. How to pre-bake a soft fade/vignette into a JPEG with sharp so the PDF stays opaque

### Takeaway
sharp accepts SVG buffers as inputs/overlays, composites them with `composite()` (blend `over`, `multiply`, etc.), merges alpha with `flatten({background})`, and writes JPEG via `jpeg({quality, chromaSubsampling:'4:4:4'})`; a radial/linear-gradient SVG overlay followed by `flatten` yields an opaque JPEG whose fade Chromium embeds verbatim (DCTDecode), so the PDF carries no gradient shading or soft mask.

### Cited Findings
- sharp input "can be a Buffer / ArrayBuffer / Uint8Array / Uint8ClampedArray containing JPEG, PNG, WebP, AVIF, GIF, SVG or TIFF image data" or a file path to the same formats; `density` is "The DPI at which to render SVG and PDF images, in the range 1 to 100000" (default 72); `create` makes a blank image with `width`, `height`, `channels` ("either 3 (RGB) or 4 (RGBA)"), `background`, optional gaussian `noise`. — [sharp constructor](https://sharp.pixelplumbing.com/api-constructor/)
- `composite(images)`: each overlay has `input` (Buffer/path/`create`/`text`), `blend` default `'over'` with modes including `multiply`, `screen`, `overlay`, `darken`, `soft-light`…; `gravity` default `'centre'`, `top`/`left` offsets "take precedence over `gravity`"; `tile`; `density` default 72 for vector overlays; "The images to composite must be the same size or smaller than the processed image." — [sharp composite](https://sharp.pixelplumbing.com/api-composite/)
- `flatten()`: "Merge alpha transparency channel, if any, with a background, then remove the alpha channel." Background "defaults to black" (example `flatten({ background: '#F0A703' })`). — [sharp operations](https://sharp.pixelplumbing.com/api-operation/)
- `jpeg()`: `quality` 1–100 default 80; `progressive`; `chromaSubsampling` default `'4:2:0'`, "set to '4:4:4' to prevent chroma subsampling"; `mozjpeg` applies trellis quantisation, overshoot deringing, optimised scans. The docs do not state how alpha is handled on JPEG output. — [sharp output](https://sharp.pixelplumbing.com/api-output/)
- Skia passes JPEG bytes through unchanged only when the decoded colour type is YCbCr or Gray and dimensions match (`do_jpeg`). — [Skia SkPDFBitmap.cpp](https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFBitmap.cpp)

### Inferences (recipe — not executed in this session)
```js
import sharp from 'sharp';

const { width: W, height: H } = await sharp(heroPath).metadata();

// Vignette + top-band fade as ONE SVG overlay, same pixel size as the hero.
// Stops go from fully transparent to a dark tint; the SVG is rasterised by sharp
// (density chosen so 1 SVG unit = 1 px) and then flattened, so no alpha survives.
const overlay = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%">
      <stop offset="60%" stop-color="#1a120b" stop-opacity="0"/>
      <stop offset="100%" stop-color="#1a120b" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#f6ead8" stop-opacity="0.85"/>
      <stop offset="0.28" stop-color="#f6ead8" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>   <!-- quiet band for the title -->
</svg>`);

await sharp(heroPath)
  .composite([{ input: overlay, blend: 'over' }])     // 'multiply' for a darker, ink-like vignette
  .flatten({ background: '#ffffff' })                 // guarantees no alpha channel remains
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(outPath);
```
- Keep the overlay exactly `W×H` (sharp requires overlays no larger than the base). Because the result is an opaque YCbCr JPEG, Chromium will embed it with `/Filter /DCTDecode` and no `/SMask`; the fade is now pixels, not a shading.
- For a cream "title plate" that should look painted rather than flat, bake it the same way (opaque rounded rect with `stop-opacity` edges in the SVG), then overlay the live text in HTML on top.
- Do the bake at final print resolution (e.g. 2550×3300 px for 8.5×11 in at 300 DPI) so there is no resampling in the PDF.

### Gaps
- No published, tested sharp vignette example was found; the code above follows the documented API but was not run here.
- sharp's docs do not name the SVG renderer (librsvg) or state whether `jpeg()` silently drops alpha; `flatten()` is used explicitly to avoid relying on that.

---

## KQ5. Which prompt phrasings reliably get image models to leave clean copy space without painting panels, banners, blank rectangles or fake text?

### Takeaway
All four vendor/community sources agree on the same two rules: (a) describe the empty region positively as a natural scene element ("largely empty, solid-colour background", "clear open sky", "calm water") placed relative to the subject, and (b) never use instructive negation inside the prompt ("no text", "don't add a sign") — Google's guides say to avoid "no"/"don't", Midjourney says "without X" still produces X, and DALL·E users report "don't add any text" yields *more* text. Use the model's dedicated negative mechanism (Imagen negative-prompt field, Midjourney `--no text, words, letters, signs, banners`, SD negative prompt "text, watermark, signature") and add the title in your own layout step.

### Cited Findings

**Google Gemini 2.5 Flash Image ("Nano Banana") — official prompting guide**
- Section 5 "Minimalist & negative space design" template: "A minimalist composition featuring a single [subject] positioned in the [bottom-right/top-left/etc.] of the frame." followed by an empty background of a chosen colour that "leaves significant negative space" for text, soft lighting and an aspect ratio. Example: "A minimalist composition featuring a single, delicate red maple leaf positioned in the bottom-right of the frame." on an off-white backdrop "that leaves room for text", diffused light from the upper left, square format. — [Google Developers Blog](https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/)
- Core principle: "Describe the scene, don't just list keywords." — same source.
- "Semantic negative prompts": describe the desired result positively; replace "no cars" with "an empty, deserted street with no signs of traffic." — same source.
- Text rendering: "Gemini 2.5 Flash Image can render text within images"; be explicit about exact wording, font style and design; "Complex typography may need refinement through follow-up prompts." — same source.

**Google Imagen (Vertex AI) prompt guide**
- Negative prompts: name unwanted elements plainly, e.g. "wall, frame"; "Avoid instructive language or words like "no" or "don't"."; examples of phrasing to avoid: "no walls", "don't show walls". — [Imagen prompt guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide)
- Text in images: "Limit text to 25 characters or less for optimal generation."; two or three phrases work, avoid more than three; placement is attempted "but expect occasional variations"; precise font replication "isn't reliable". — same source.
- Composition modifiers listed: "close up", "zoomed out", "aerial", "from below"; lens types 35mm/50mm/fisheye/wide angle/macro; aspect ratios — Widescreen (16:9) "for capturing more background, such as scenic landscapes"; Fullscreen (4:3) "captures more of the scene horizontally". — same source.

**Midjourney**
- Official `--no` docs (via search summary; the page returned 403 on direct fetch): `--no` "accepts multiple words separated with commas"; the bot does not read natural-language negation — phrases like "without fruit" or "don't add fruit" can still produce fruit — so "focus your prompt on what you do want to see in the image and use the "--no" parameter for unwanted concepts"; "--no modern clothing" is read as "no modern" and "no clothing"; `--no` is equivalent to a multi-prompt weight of -0.5. — [Midjourney docs: --no](https://docs.midjourney.com/docs/no)
- Third-party testing (Why Try AI, 2023-09-21): "--no text", "--no words", "--no writing" help remove text; recommends positive prompting first ("yellow sunset over a city" instead of "sunset over a city --no red"); "Using the '--no camel' parameter… is functionally equivalent to using a negative weight of -0.5". — [Why Try AI](https://www.whytryai.com/p/midjourney-negative-prompt)
- aituts: "--no text font letters" works "much better than just --no text" because more specific terms work better; exclusions are not perfect ("some elements might sneak in due to contextual associations"). — [aituts](https://aituts.com/midjourney-negative-prompts/)
- A logo-design experiment notes it "turns out to be difficult to enforce that all generated images actually use negative space" — expect iteration. — [creativeai.substack.com](https://creativeai.substack.com/p/the-champions-league-of-logo-design)

**DALL·E 3 (OpenAI developer community; anecdotal but consistent)**
- Daller: you cannot stop unwanted text by writing "don't add any text" — it tends to produce more text; DALL·E "cannot process negations"; describe what you want rather than what you don't; "drawing" or "cartoon" styles are more prone to nonsense text; long text fails, add it with external software; and for overlays "tell DallE where to leav out space for it". Also: "Start with the most important thing, then details… and finally technical instructions"; "describe locations in a geometric or topological context to other objects". — [OpenAI community: DALL·E 3 tips collection](https://community.openai.com/t/collection-of-dall-e-3-prompting-tips-issues-and-bugs-simplified/994822)
- @polepole tip: adding "For unlettered viewers only" "helps suppress text". — same thread.
- Forum reply: text in the background "especially if not specified, will result in garbled text"; specifying the focus text improves results. — [OpenAI community](https://community.openai.com/t/does-anyone-experience-issues-with-dall-e3-generating-typos-in-text-within-images/472966)

**Stable Diffusion / Flux**
- Community negative-prompt lists consistently include "text, watermark, signature" alongside quality terms; no official Stability list exists. — [ghacks](https://www.ghacks.net/?p=193666); [nerdschalk](https://nerdschalk.com/what-is-a-negative-prompt-in-stable-diffusion/)
- ComfyUI composition-styler node note: "prompting for composition is a bias, not a guarantee. SDXL will lean toward symmetry or rule-of-thirds, but it's not a layout engine"; composition prompts underdeliver on distilled/LLM-encoded models; "a busy, edge-to-edge scene conflicts with negative-space instructions." — [comfy.icu SDXLPromptStylerbyComposition](https://comfy.icu/node/SDXLPromptStylerbyComposition)
- A Flux LoRA exists specifically to "consciously control negative space in your FLUX generations", with trigger words at the start of the prompt and weight 0.7–1.0. — [CivArchive](https://civarchive.com/seaart/models/68cce154d5daa4a6a81ce8e3f51ff9cb/versions/dfdec8f159e8ba6c741faf22a3984b97)
- Example composition phrasing from a cinematic-prompt guide: "side profile of a woman looking to the right, negative space on the right side of the frame". — [atlabs.ai (ES)](https://www.atlabs.ai/es/blog/guia-de-42-prompts-de-composicion-de-ia-cinematografica)

**"Copy space" — the photography/stock term**
- iStockphoto launched a "CopySpace" search feature in 2005 letting designers "indicate exactly where on an image they need to insert text or branding". — [CreativePro](https://creativepro.com/?p=4503)
- Editorial photography: briefs asking for "room on one side" are "basically code for negative space and how they want that space to be organized"; buyers put "advertisement text, magazine titles, or article headlines" there. — [Sigma blog](https://blog.sigmaphoto.com/2016/negative-space-for-editorial-photography-using-sigma-lenses/)
- Vendor guidance (Morphic): include phrases like "empty center space for text" and "no lettering, no words", ask for "a simple, low-clutter composition", then add text in an editor. — [Morphic](https://morphic.com/resources/images/banner-background)
- Cover-prompt guides: state exactly where to leave quiet area ("an open upper third or an uncluttered sky") and add typography later in a design tool. — [DreamPixelForge prompt guide](https://www.dreampixelforge.com/blog/sample-book-cover-prompt-guide); [fluxnote children's-book prompts](https://fluxnote.io/guides/childrens-book-art-prompts)

### Inferences (prompt patterns — grounded in the above, not independently tested here)
- **Never name the artifact you fear.** The negation-backfire evidence (Imagen, Midjourney, DALL·E) implies that tokens like "banner", "sign", "blank rectangle", "placeholder", "space for the title", "label" prime the model to paint those objects. Describe the quiet region as a *natural* element instead:
  - Top sky: "…the upper third of the frame is a wide, clear, softly graded evening sky with nothing in it; all characters and trees sit in the lower two-thirds."
  - Bottom ground: "…a broad stretch of smooth, snow-covered meadow fills the bottom quarter of the frame, completely plain."
  - Side column: "…a tall, calm, uncluttered wall of soft fog fills the entire right third of the frame; the character stands in the left third, looking right."
  - Central badge zone: harder — models fill centres; prefer "the characters are arranged around the edges of a calm, empty pond at the centre" rather than "leave a circle in the middle".
- **Say the composition in camera language the guides list**: "wide shot", "zoomed out", "16:9", "subject positioned in the bottom-left of the frame" (Gemini template), "negative space on the right side of the frame".
- **Put text exclusion in the model's negative channel, with synonyms**: Midjourney `--no text, words, letters, writing, signs, banners, labels, captions, watermark`; SD negative "text, watermark, signature, letters, words, logo, sign, banner, frame, border"; Imagen negative field "text, lettering, sign, banner, frame, border, wall"; DALL·E/Gemini (no negative channel): positive wording only ("a wordless picture-book illustration", "the sky is completely plain") plus, for DALL·E, the community trick "For unlettered viewers only".
- **Picture-book/cartoon style raises gibberish-text risk** (DALL·E reports); so keep "wordless" in the style sentence and never ask for the title in the art — add it in the HTML layer (KQ3), which also keeps the typography fully vector.
- **Expect a bias, not a guarantee** (ComfyUI note; Midjourney negative-space experiment) — generate several candidates and pick by a cheap automated "quiet-region" check (e.g. edge-density/variance of the intended title zone) before compositing, which is consistent with the project's existing human-selection-from-multiple-draws approach.

### Gaps
- No source directly documents the "model draws a blank sign/banner when asked to leave space" failure; it is inferred from the well-documented negation-backfire behaviour. No controlled study comparing phrasings was found.
- Midjourney's official `--no` page could not be fetched (403); its wording is taken from a search summary and a 2023 third-party article.
- No official Gemini/Imagen guidance addresses *children's-book* covers specifically; the Gemini "negative space" template is for product/graphic layouts.
- Stable Diffusion/Flux findings are community sources only; effectiveness varies by checkpoint.

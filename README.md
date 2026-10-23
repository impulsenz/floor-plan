# Station Planner

Floor plans and bait-station maps for pest control sites. One HTML file, runs in the browser, no install.

## What it does

- **Sites as folders.** Create a site (e.g. *Teagle*), and every plan for that site is kept inside it.
- **Printed sheet layout.** A fixed-height black heading band across the top, with your logo on the right (upload it once in the Plan tab, shared by every plan). The heading never moves; the logo has size, left/right and up/down controls. A fixed-height bottom bar fills itself from the site and plan details (Title, Address, Department, Date, Version, Site Ref, Drawn By, Contract No) plus a KEY of every station type.
- **Sites.** Every field on the site form is required, so the bottom bar is always complete.
- **Versions.** Each time you close a plan you changed, its version goes up by one (01 → 02) and its date updates. Typing a version yourself overrides this for that session.
- **A4 by default.** New plans are sized so the whole printed sheet is A4 landscape. Switch to A4 portrait in the Plan tab. Imported backgrounds and satellite photos fit inside the page instead of changing its shape.
- **Click to edit.** Click any detail in the bottom bar or header (department, version, contract no, logo…) to jump straight to that field.
- **Drawing.** A Draw drawer (wall, fence line, line, arrow), rooms (drag a box), and a Shapes drawer (rectangle/zone, ellipse, area outline). Text has colour, size, font, bold/italic and a white outline for readability on photos.
- **Objects library** with a picture of every item, grouped and searchable: 12 door, window and opening types that snap into walls, plus storage, building services, safety and outdoor objects. Objects can be resized, rotated (drag the round handle, use the ±15° buttons, or `[` `]`) and labelled.
- **Rooms.** When you finish a room (or close a wall outline), name it, pick a fill colour, and choose solid or dashed walls (for fence lines). Any wall can be switched to dashed later.
- **Stations with auto-numbering.** Pick a type in the Stations tab (or press 1–8), then click the plan: T001, T002, T003… Drag to move. Each station records its type (e.g. *Snap trap*) and notes, shown in Properties and the Register.
  - **Jumping ahead:** while placing, type a *Next number* (e.g. 40). New stations take the first free number from there, so 1–10, then 40, 41…, then set it back to 11 to carry on 11, 12… (numbers already used are skipped).
  - **New station type** adds a type with its own prefix, shape, colour and starting number.

  | Prefix | Meaning | Colour |
  |---|---|---|
  | T | Third line control | Red if toxic, green if non-toxic |
  | S | Second line control | Red if toxic, green if non-toxic |
  | F | Fence line station | Red if toxic, green if non-toxic |

  Types that can be either are shown in the legend as one shape split diagonally, half red and half green.

  | Prefix | Meaning | Colour |
  |---|---|---|
  | V | Insect monitoring | Black |
  | U | Flying insect monitoring | Blue |
  | X | Inspection point | Black |
  | W | Vertebrate monitoring | Brown |
  | CP | Control panel | Purple |

  Prefixes, names, shapes and colours can be changed under **Edit station types**.
- **Satellite background** (Import › Satellite photo). Start typing an address and pick it from the drop-down, frame the property, and rotate it with the slider or ±15° buttons. The photo becomes the plan background with the scale and north arrow set automatically (Esri World Imagery).
- **Import** PNG, JPG, GIF, WEBP, BMP, SVG and PDF (any page) as a background or a movable image. On a site page, Import plan accepts `.json` and `.svg` plan files; SVGs exported from Station Planner come back fully editable, and any other drawing becomes a new plan with it as the background.
- **Export** PNG, JPG, PDF and SVG with no margins (an A4 plan exports as an exact A4 page), a station register as CSV, and plan or whole-site backups as JSON.
- **Register tab:** every station in one list, search and filter, duplicate-number warnings, and *Close gaps* renumbering.
- Scale calibration from any known length, grid with snapping, undo/redo, marquee select, duplicate, keyboard shortcuts, touch pinch-zoom, light and dark themes.

## Storage

Everything is stored in the browser (IndexedDB). It stays on that device and browser only, so use **Back up** on a site to keep a copy. All storage calls go through the `Store` object in `index.html`, which is the one place to swap in a cloud database (e.g. Supabase with Google login) later.

## Keyboard shortcuts

`V` select · `H` pan · `W` wall · `F` fence · `R` room · `O` objects · `B` rectangle · `E` ellipse · `P` area · `L` line · `A` arrow · `T` text · `1`–`8` station types · `Ctrl+Z / Ctrl+Y` undo/redo · `Ctrl+D` duplicate · `Delete` remove · arrows nudge · `[` `]` rotate objects · `Space`+drag pan · `0` fit to screen

## Hosting

Turn on GitHub Pages (Settings → Pages → Deploy from branch → `main` / root) and open the site URL. Opening `index.html` straight from disk also works.

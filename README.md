# Station Planner

Floor plans and bait-station maps for pest control sites. One HTML file, runs in the browser, no install.

## What it does

- **Sites as folders.** Create a site (e.g. *Teagle*), and every plan for that site is kept inside it.
- **Drawing.** Walls (click corners), rooms (drag), rectangles/zones, ellipses, area outlines, lines, arrows, dimensions and text with colour, size, font, bold/italic and a white outline for readability on photos.
- **Doors and windows** that snap into walls: single, double, sliding, roller, fire exit, window, opening. Drag them to slide along a wall; flip side or hinge.
- **Stations with auto-numbering.** Pick a type in the Stations tab (or press 1–8), then click the plan: T001, T002, T003… Drag to move. Each station shows its ID with its type underneath (e.g. *Snap trap*), plus notes.

  | Prefix | Meaning | Colour |
  |---|---|---|
  | T | Third line control | Red if toxic, green if non-toxic |
  | S | Second line control | Red if toxic, green if non-toxic |
  | F | Fence line station | Red if toxic, green if non-toxic |
  | V | Insect monitoring | Black |
  | FI | Flying insect monitoring | Blue |
  | X | Inspection point | Black |
  | W | Vertebrate monitoring | Brown |
  | CP | Control panel | Purple |

  Prefixes, names, shapes and colours can be changed under **Edit station types**.
- **Satellite background.** Search an address, frame the property, and the aerial photo becomes the plan background with the scale set automatically (Esri World Imagery).
- **Import** PNG, JPG, GIF, WEBP, BMP, SVG and PDF (any page) as a background or a movable image, plus plan/site `.json` files.
- **Export** PNG, JPG, PDF (A4, A3 or plan-shaped) and SVG, a station register as CSV, and plan or whole-site backups as JSON.
- **On the page:** station legend with counts, title block (site, address, plan, prepared by, date, revision), north arrow, scale bar.
- **Register tab:** every station in one list, search and filter, duplicate-number warnings, and *Close gaps* renumbering.
- Scale calibration from any known length, grid with snapping, undo/redo, marquee select, duplicate, keyboard shortcuts, touch pinch-zoom, light and dark themes.

## Storage

Everything is stored in the browser (IndexedDB). It stays on that device and browser only, so use **Back up** on a site to keep a copy. All storage calls go through the `Store` object in `index.html`, which is the one place to swap in a cloud database (e.g. Supabase with Google login) later.

## Keyboard shortcuts

`V` select · `H` pan · `W` wall · `R` room · `D` door · `B` rectangle · `E` ellipse · `P` area · `L` line · `A` arrow · `M` dimension · `T` text · `1`–`8` station types · `Ctrl+Z / Ctrl+Y` undo/redo · `Ctrl+D` duplicate · `Delete` remove · arrows nudge · `Space`+drag pan · `0` fit to screen

## Hosting

Turn on GitHub Pages (Settings → Pages → Deploy from branch → `main` / root) and open the site URL. Opening `index.html` straight from disk also works.

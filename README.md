# Station Planner

Floor plans and bait-station maps for pest control sites. One HTML file, runs in the browser, no install.

## What it does

- **Sites as folders.** Create a site (e.g. *Teagle*), and every plan for that site is kept inside it. Each site card can show a photo of the site (add it when creating or editing the site); inside a site, plan cards show a preview of each map. Search finds sites by name, address, site ref, contract, client, owner or plan name, and **Mine** shows only your own.
- **Your files and everyone else's.** You can create, edit and delete your own sites and plans. Anyone else's can be opened (view only, with export) and duplicated; the copy is yours to edit. Admins can edit and delete everything.
- **Printed sheet layout.** A fixed-height black heading band across the top, with your logo on the right (upload it once in the Settings tab, shared by every plan). The heading never moves; the logo has size, left/right and up/down controls. A fixed-height bottom bar fills itself from the site and plan details (Title, Address, Department, Date, Version, Site Ref, Drawn By, Contract No) plus a KEY of every station type.
- **Sites.** Every field on the site form except Notes is required, so the bottom bar is always complete.
- **Stays on the page.** Stations, objects, text, shapes and walls can't be moved or drawn into the heading band or bottom bar.
- **Versions.** Each time you close a plan you changed, its version goes up by one (01 → 02) and its date updates. Typing a version yourself overrides this for that session.
- **A4 by default.** New plans are sized so the whole printed sheet is A4 landscape. Switch to A4 portrait in the Settings tab. Imported backgrounds and satellite photos fit inside the page instead of changing its shape.
- **Click to edit.** Click any detail in the bottom bar or header (department, version, contract no, logo…) to jump straight to that field.
- **Drawing.** A Draw drawer (wall, fence line, line, arrow), rooms (drag a box), and a Shapes drawer (rectangle/zone, ellipse, area outline). Text has colour, size, font, bold/italic and an adjustable white outline (thicker, thinner or none) for readability on photos.
- **Walls, fences and lines.** Place nodes by clicking, or switch to **Freehand** in the bar at the top of the plan and drag to draw; the stroke is turned into clean nodes. After the third node, **Enclose space** joins the last node to the first and asks for a room name. Fences show dashed while you draw.
- **Objects library** with a picture of every item, grouped and searchable: 12 door, window and opening types that snap into walls, plus storage, building services, safety and outdoor objects. Every object can be resized (corner square), rotated (round handle, ±15° buttons, or `[` `]`), recoloured (line and fill) and labelled. Doors and windows can be recoloured and resized too.
- **Rooms.** When you finish a room (or close a wall or fence outline), name it, pick a fill colour, and choose solid or dashed walls. The colour and name follow the walls: drag the round nodes at the corners to reshape a building or fence line and the fill reshapes with it. Click the room name to select the room and drag it, walls and all.
- **Stations with auto-numbering.** Pick a type in the Stations tab (or press 1–8), then click the plan: T001, T002, T003… Drag to move. Each station records its type (e.g. *Snap trap*) and notes, shown in Properties and the Register. The ID sits to the right of the marker and moves to the left automatically when something is in the way (or set it to always left/right). Switching away from the Stations tab stops placing.
  - **Jumping ahead:** while placing, type a *Next number* (e.g. 40). New stations take the first free number from there, so 1–10, then 40, 41…, then set it back to 11 to carry on 11, 12… (numbers already used are skipped).
  - **New station type** adds a type with its own prefix, shape, colour and starting number.

  | Prefix | Meaning | Colour |
  |---|---|---|
  | T | Third line control | Green by default (non-toxic); red if set to toxic |
  | S | Second line control | Red by default (toxic bait); green if set to non-toxic |
  | F | Fence line station | Red by default (toxic bait); green if set to non-toxic |

  Types that can be either are shown in the legend as one shape split diagonally, half red and half green.

  | Prefix | Meaning | Colour |
  |---|---|---|
  | V | Insect monitoring | Black |
  | U | Flying insect monitoring | Blue |
  | X | Inspection point | Black |
  | W | Vertebrate monitoring | Brown |
  | CP | Control panel | Purple |

  All types are circles by default. Prefixes, names, shapes and colours can be changed under **Edit types**.
- **Satellite background** (Import › Satellite photo). Start typing an address and pick it from the drop-down, frame the property, and rotate it with the slider or ±15° buttons. The photo becomes the plan background with the scale and north arrow set automatically (Esri World Imagery).
- **Import** PNG, JPG, GIF, WEBP, BMP, SVG and PDF (any page) as a background or a movable image. On a site page, Import plan accepts `.json` and `.svg` plan files; SVGs exported from Station Planner come back fully editable, and any other drawing becomes a new plan with it as the background.
- **Export** PNG, JPG, PDF and SVG with no margins (an A4 plan exports as an exact A4 page), always at print resolution (3×) with backgrounds included. The Register tab exports a station register as CSV, and sites back up as JSON.
- **Register tab:** every station in one list, search and filter, duplicate-number warnings, and *Close gaps* renumbering.
- **Undo history** of 100 steps per plan, saved with the plan so you can still undo after closing and reopening it.
- Scale calibration from any known length, grid with snapping, marquee select, duplicate, keyboard shortcuts, touch pinch-zoom, light and dark themes.

## Storage

Plans are saved on your own **Station Planner server** (Node.js + SQLite, behind HTTPS), so they're the same on every device. Setup for an Oracle Cloud instance is in [`server/README.md`](server/README.md): open ports 80/443, then run `server/setup-floorplan-server.sh` on the instance.

- The server also serves the app, so its address is all you need.
- To use the GitHub Pages copy, open it once with `?api=https://your-server-address`, or set the address with the **Server** button on the Sites page.
- Plans made before the server existed can be copied up with **Server → Copy them to the server**.
- **Several servers.** **Server** on the Sites page (or your picture → Servers) shows each saved server as a card with its own name and picture. Click one to switch; each keeps its own sites, plans and sign-in.
- **Google sign-in:** your Google picture sits at the top right of every page. Only approved Google accounts (or a whole company domain) can get in, admins manage the list under **Users and access**, and people are signed out after 5 minutes without activity. Setup steps are in [`server/README.md`](server/README.md#google-sign-in).

## Keyboard shortcuts

`V` select · `H` pan · `W` wall · `F` fence · `R` room · `O` objects · `B` rectangle · `E` ellipse · `P` area · `L` line · `A` arrow · `T` text · `1`–`8` station types · `Ctrl+Z / Ctrl+Y` undo/redo · `Ctrl+D` duplicate · `Delete` remove · arrows nudge · `[` `]` rotate objects · `Space`+drag pan · `0` fit to screen

## Hosting

The server serves the app at its own address. GitHub Pages (Settings → Pages → Deploy from branch → `main` / root) also works, pointed at the server with `?api=`.

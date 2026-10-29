# Station Planner

Floor plans and bait-station maps for pest control sites. One HTML file, runs in the browser, no install.

## What it does

- **Sites as folders.** Create a site (e.g. *Teagle*), and every plan for that site is kept inside it. Each site card can show a photo of the site (add it when creating or editing the site); inside a site, plan cards show a preview of each map. Search finds sites by name, address, site ref, contract, client, owner or plan name, and **My sites** shows only your own.
- **Your settings follow you.** Your picture → **Settings**: theme (match device, light or dark), accent colour, the *Drawn by* name and page shape for new floor plans, grid defaults, and how the Sites page is filtered and sorted. They're saved to your account on the server, so they're the same on any device you sign in on.
- **Live editing.** When two or more people have the same plan open, each change shows up for the others as it's made, including walls, fences, lines and boxes while they're still being drawn, along with their pointers and a picture of who's there at the top. Nothing to switch on; it only sends anything while someone else is on the plan.
- **Activity log** (admins only: your picture → Activity log): every change to sites and plans with who made it, when, and a summary of what changed (stations added, removed or moved, walls, rooms, text, details). Filter by site, plan or person, or search. Saves by the same person to the same plan within 15 minutes show as one entry.
- **Ask to edit.** On someone else's site or plan, **Ask to edit** sends a request to its owner (and admins). They approve or turn it down under your picture → **Access requests**, and can remove the access later. Access to a site covers all its plans; only the owner or an admin can delete.
- **Your files and everyone else's.** You can create, edit and delete your own sites and plans. Anyone else's can be opened (view only, with export) and duplicated; the copy is yours to edit. Admins can edit and delete everything.
- **Printed sheet layout.** A fixed-height black heading band across the top, with your logo on the right (upload it once in the Settings tab, shared by every plan). The heading never moves; the logo has size, left/right and up/down controls. A fixed-height bottom bar fills itself from the site and plan details (Title, Address, Department, Date, Version, Site Ref, Drawn By, Contract No) plus a KEY of every station type.
- **Sites.** Every field on the site form except Notes is required, so the bottom bar is always complete.
- **Stays on the page.** Stations, objects, text, shapes and walls can't be moved or drawn into the heading band or bottom bar.
- **Versions.** The first change after you open a plan starts a new version (01 → 02) and updates the date; further changes in that sitting stay on the same version. Typing a version yourself overrides this for that session.
- **Drawn By** fills itself in with the name of the last person who changed the plan (it can't be typed over when sign-in is on).
- **A4 by default.** New plans are sized so the whole printed sheet is A4 landscape. Switch to A4 portrait in the Settings tab. Imported backgrounds and satellite photos fit inside the page instead of changing its shape.
- **Click to edit.** Click any detail in the bottom bar or header (department, version, contract no, logo…) to jump straight to that field.
- **Drawing.** A Draw drawer (wall, fence line, line, arrow), rooms (drag a box), and a Shapes drawer (rectangle/zone, ellipse, area outline). Text has colour, size, font, bold/italic and an adjustable white outline (thicker, thinner or none) for readability on photos.
- **Walls, fences and lines.** Place nodes by clicking, or switch to **Freehand** in the bar at the top of the plan and drag to draw; the stroke is turned into clean nodes. After the third node, **Enclose space** joins the last node to the first and asks for a room name. Fences show dashed while you draw.
- **Objects library** with a picture of every item, grouped and searchable: 9 door, window and opening types that snap into walls, plus storage, building services, safety and outdoor objects. Every object can be resized (corner square), rotated (round handle, ±15° buttons, or `[` `]`), recoloured (line and fill) and labelled. Doors and windows can be recoloured and resized too.
- **Walls work like area outlines.** Click a wall and you get the whole room, or the whole joined run of walls; drag to move it as one, drag a round corner node to reshape it, and the room colour stays inside the new shape. <kbd>Alt</kbd>+click picks a single wall section; moving it stretches the walls joined to it. Walls and fences have quick thickness picks (thin to heavy) and line styles: solid, dashed, long dash, dotted, dash dot and double line.
- **Colour wheel** next to every colour choice, for any colour you like.
- **Rooms.** When you finish a room (or close a wall or fence outline), name it, pick a fill colour, and choose solid or dashed walls. The colour and name follow the walls: drag the round nodes at the corners to reshape a building or fence line and the fill reshapes with it. Click the room name to select the room and drag it, walls and all.
- **Stations with auto-numbering.** Pick a type in the Stations tab (or press 1–8), then click the plan: T001, T002, T003… Drag to move. Each station records its type (e.g. *Snap trap*) and notes, shown in Properties and the Register. The ID sits to the right of the marker and moves to the left automatically when something is in the way (or set it to always left/right). Switching away from the Stations tab stops placing.
  - **Jumping ahead:** while placing, type a *Next number* (e.g. 40). New stations take the first free number from there, so 1–10, then 40, 41…, then set it back to 11 to carry on 11, 12… (numbers already used are skipped).
  - **Outlines:** the Stations tab also sets the outline around station IDs (thickness and colour); a single station can have its own.
  - **Sizes:** the Stations tab sets the icon and text size for every station on the plan. Click a single station to give it its own icon and text size (relative to the plan's), or put it back to the plan's sizes.

  | Prefix | Meaning | Colour |
  |---|---|---|
  | T | Third line control | Green by default (non-toxic); red if set to toxic |
  | S | Second line control | Red by default (toxic bait); green if set to non-toxic |
  | F | Fence line station | Red by default (toxic bait); green if set to non-toxic |
  | W | Vertebrate control | Red by default (toxic bait); green if set to non-toxic |

  Types that can be either are shown in the legend as one shape split diagonally, half red and half green.

  | Prefix | Meaning | Colour |
  |---|---|---|
  | V | Insect monitoring | Black |
  | U | Flying insect monitoring | Blue |
  | X | Inspection point | Black |

  | CP | Control panel | Purple |

  All types are circles by default.
- **Satellite background** (Import › Satellite photo). Start typing an address and pick it from the drop-down, frame the property, and rotate it with the slider or ±15° buttons. The photo becomes the plan background with the scale and north arrow set automatically (Esri World Imagery).
- **SVG drawings come in as editable pieces** that look exactly like the original (same fonts, letter spacing, positions, line styles and colours): every shape, line and text is its own item you can move, recolour, edit or delete. You can also use the SVG as a background or one picture instead.
- **Letter-by-letter text** (common in PDF-to-SVG conversions) is joined back into whole words and lines, so a label like T1071 is one editable text.
- **Groups.** Parts that were grouped in the SVG (and lines of one text block) stay together: click one to pick the whole group, Alt+click to pick one part. Select several things and press **Group** (Ctrl+G) to group them yourself, **Ungroup** (Ctrl+Shift+G) to split them. A selected group, or several selected items, can be resized and turned together with the corner and round handles or the Bigger / Smaller / turn buttons.
- **Background settings** (the **Background** button in the left toolbar, double-click the background, or Settings tab → Background): make the background see-through, resize, turn (slider or 90° steps), flip, move with arrows or unlock and drag it, centre, fit to page, reset, or replace the file.
- **Import** PNG, JPG, GIF, WEBP, BMP, SVG and PDF (any page) as a background or a movable image. On a site page, Import plan accepts `.json` and `.svg` plan files; SVGs exported from Station Planner come back fully editable, and any other drawing becomes a new plan with it as the background.
- **Export** PNG, JPG, PDF and SVG with no margins (an A4 plan exports as an exact A4 page), with backgrounds included, in **Standard** (3×, print resolution) or **HD** quality (60% more resolution). The Register tab exports a station register as CSV, and sites back up as JSON.
- **Print** (next to Export) prints just the plan, filling one A4 page in the plan's orientation, with no date, title or web address added by the browser.
- **Register tab:** every station in one list, search and filter, duplicate-number warnings, and *Close gaps* renumbering.
- **Change log** (your picture → Change log) lists what's new in each app version.
- **Ctrl+D** puts the copy where your mouse is.
- **Undo history** of 100 steps per plan, saved with the plan so you can still undo after closing and reopening it.
- **Zoom:** fit to screen is 100%; the + and − buttons, keys and mouse wheel go up and down in 5% steps.
- **On the server** (Settings tab): how big this plan's drawing, pictures and undo history are on the server, and when it was last saved.
- grid with snapping, marquee select, duplicate, keyboard shortcuts, touch pinch-zoom, light and dark themes.

## Storage

Plans are saved on your own **Station Planner server** (Node.js + SQLite, behind HTTPS), so they're the same on every device. Setup for an Oracle Cloud instance is in [`server/README.md`](server/README.md): open ports 80/443, then run `server/setup-floorplan-server.sh` on the instance.

- The server also serves the app, so its address is all you need.
- To use the GitHub Pages copy, open it once with `?api=https://your-server-address`, or set the address with the **Server** button on the Sites page.
- Plans made before the server existed can be copied up with **Server → Copy them to the server**.
- **Uses as little data as possible.** While you edit, changes are kept on the device and sent to the server at most once a minute (only if something changed), and when you leave the plan or close the tab. Plans, pictures and lists you've opened before are kept on the device and only downloaded again if someone changed them; site pages fetch a light list of plans without the drawings.
- **Save indicator** (left of undo). The top bar shows *Saved to server* with the time only once the server has confirmed it has the latest version. If it can't be reached, it says why, keeps your changes in the browser, and sends them as soon as the server answers (press **Retry** to reconnect straight away). Click it to see how much data each floor plan has sent and received, this session and on this device. Changes still waiting are sent the next time you open the app.
- **Several servers.** **Server** on the Sites page (or your picture → Servers) shows each saved server as a card with its own name and picture. Click one to switch; each keeps its own sites, plans and sign-in.
- **Google sign-in:** your Google picture sits at the top right of every page. Only approved Google accounts (or a whole company domain) can get in, admins manage the list under **Users and access**, and people stay signed in until they sign out. Each account can be signed in in one browser at a time: signing in somewhere else signs the first browser out, so a login can't be shared. Setup steps are in [`server/README.md`](server/README.md#google-sign-in).

## Keyboard shortcuts

`V` select · `H` pan · `W` wall · `F` fence · `R` room · `O` objects · `B` rectangle · `E` ellipse · `P` area · `L` line · `A` arrow · `T` text · `1`–`8` station types · `Ctrl+Z / Ctrl+Y` undo/redo · `Ctrl+D` duplicate · `Delete` remove · arrows nudge · `[` `]` rotate objects · `Space`+drag pan · `0` fit to screen

## Hosting

The server serves the app at its own address. GitHub Pages (Settings → Pages → Deploy from branch → `main` / root) also works, pointed at the server with `?api=`.

# Mission Control

Home-network web app (PC + phone) for running a household: Recipes, What's in my Pantry, What's in my Freezer
and Meal Planner. The product spec lives outside this repo; every feature traces to a requirement ID there
(R1–R5, P1–P5, F1–F5, M1–M11, T1–T11). Alexa is paused for this version.

This folder is its own git repo. The Alexa skill is a separate repo; don't merge or port code between them
unless asked.

**Owner- and machine-specific details** (who the owner is, local paths, where the specs and the Alexa skill
live, AWS resource names and how access is set up) are in `LOCAL_INSTRUCTIONS.md`, which is gitignored:
@LOCAL_INSTRUCTIONS.md

**Keep those details out of checked-in files** (docs, comments, commit messages): no names, home paths,
bucket/role/profile names, CA or certificate details. Put them in `LOCAL_INSTRUCTIONS.md` instead.

## Status (20 Nov 2026)

All modules in this version are built: items (central list), Recipes (R1–R5), Pantry (P1–P5), Freezer
(F1–F5) and Meal Planner (M1–M11), plus AWS A6/A7, backups, `serve.py` and a home dashboard. The Recipe Tool
(T1–T11: create/edit recipes, phone first) is built too. Left: Phase 7 (hosting and replication, deferred).
The server runs on port 5683. **`docs/DECISIONS.md` logs every judgement call
and the open questions for the owner; add to it when making a choice the spec doesn't settle.**

- `app/core/aws.py` builds every boto3 session (`aws.session(settings)`) and does the A6/A7 checks.
- `app/core/local_name.py` announces `http://mission-control.local:5683` (mDNS) when `MC_LOCAL_NAME` is set,
  which `serve.py` does. Zeroconf calls block, so they stay on its own thread, never the event loop.
- `app/core/backup.py` + `scripts/backup.py` / `scripts/restore.py`: one dated zip of the DB (SQLite online
  backup) and recipe folders.
- Recipes has its own reference hook (`register_recipe_references`) like items; the planner uses it to report
  planned meals before a recipe is deleted.
- Each frontend module may give the home page a card via `AppModule.summary`.
- The Recipe Tool (`recipe_tool` backend, `recipe-tool` frontend) owns no tables: it converts recipe.json to plain
  rows and back, saving through `recipes.service.store`. Fields it doesn't show are kept; unchanged lines keep
  their `<b>` markup. The app no longer stores `card.pdf` (printing is a print stylesheet on the recipe page).
  It has no tab of its own: its editor is at `/recipes/new` and `/recipes/<slug>/edit` (old `/recipe-tool` links
  redirect).
- The frontend uses a data router (`createBrowserRouter` in `main.tsx`) so the editor can `useBlocker`; tests of
  pages that block navigation need `createMemoryRouter`, not `MemoryRouter`.
- Label form fields with `htmlFor`/`id`, not by wrapping the input in its `<label>`: a wrapped input's typed text
  becomes part of its accessible name.
- When editing files from a shell heredoc, don't put Windows paths with backslashes in Python string literals
  (`\b`, `\r` become control characters). Use the Edit tool for those.

- The Meal Planner only reads other modules, through their services (`levels_by_item`, `totals_by_item`,
  `recipes.get`); it never writes to them.
- Drag and drop (`@dnd-kit/core`) targets whatever is under the pointer (`pointerWithin`), so dropping on
  "Add new" under a meal doesn't replace that meal. jsdom can't lay out a page, so the drop rules live in
  `planner/dropAction.ts` for unit tests; check real dragging (mouse and touch) in a browser.

## Stack and decisions

- Backend: FastAPI (Python), SQLAlchemy 2.0 + SQLite (WAL), Alembic migrations, boto3 for S3 sync.
- Frontend: React + Vite + TypeScript, React Router, `@dnd-kit` for meal-planner drag and drop.
- Storage: SQLite DB and recipe folders under `data/` (gitignored). The S3 bucket (`MC_S3_BUCKET`,
  `recipes/<slug>/`) is only touched when the user uploads or presses Sync; nothing syncs automatically.
- AWS access follows the AWS access spec (A1–A10): its own least-privilege role, selected with
  `MC_AWS_PROFILE`. Never widen S3 permissions or put AWS credentials anywhere the browser can reach.
- The app never calls the Claude API. Recipe cards are made in Claude chat and uploaded by hand.
- Hosting and replication between the home servers are undecided; don't bake in assumptions.

## Layout (planned)

```
backend/app/
  main.py               FastAPI app; mounts module routers under /api/<module>; serves frontend/dist
  core/                 config, db session, migrations
  modules/<name>/       router.py · service.py · repository.py · models.py · schemas.py
                        items/ recipes/ pantry/ freezer/ planner/
backend/tests/          pytest; S3 faked with moto
frontend/src/modules/<name>/   pages/components per module
frontend/src/shared/           API client, ItemAutocomplete, ConfirmDialog, layout
data/                   (gitignored) mission-control.db, recipes/<slug>/...
```

## Module rules

- Business logic in `service.py`, storage only in `repository.py`; routers stay thin.
- A new module = new folder + router registration + nav entry. Don't rework existing modules to add one.
- One central list of known items (`items` module) is shared by Recipes (R1), Pantry and Freezer.
- `recipe.json` shape is owned by the recipe-card Claude skill (samples: see `LOCAL_INSTRUCTIONS.md`, and
  `backend/tests/fixtures/`). Read it as-is; never change its shape here.
- Keep `recipes/index.json` in S3 up to date on upload/delete so the Alexa skill still sees recipes.
- Every delete, rename and overwrite asks "Are you sure?" first (shared `ConfirmDialog`).
- Modules that point at items (pantry, freezer, recipe ingredients) register an `ItemReferences` provider
  with `items.service.register_references(...)` (usage / reassign on merge / detach on delete). The items
  module never imports other modules.
- Item names match on `normalise_key` (case, whitespace, markup, last word singular): "Carrots" = "carrot".

## Commands

```bash
python dev.py                                         # backend :5683 + frontend :5173 (development)
python serve.py                                       # the real server: built frontend + API on :5683
cd backend && .venv/Scripts/python -m pytest          # backend tests
cd frontend && npm test && npm run build && npm run lint
cd backend && .venv/Scripts/python scripts/new_migration.py "msg"   # after changing models; review the file
```

Migrations run on app start-up. A new module's name must be added to `MODULES` in `app/core/modules.py`
before autogenerate can see its models.

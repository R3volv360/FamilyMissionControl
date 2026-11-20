# Mission Control

Home-network web app for recipes, pantry and freezer inventories, and meal planning. Details specific to the
owner's setup (people, paths, AWS resources) are in `LOCAL_INSTRUCTIONS.md`, which isn't checked in.

## Setup (once)

Needs Python 3.12+ and Node.js 22+.

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # Linux/macOS: .venv/bin/pip
cd ../frontend
npm install
```

On Python 3.15, PyYAML (a test dependency) has no prebuilt wheel yet. Install it first with
`PYYAML_FORCE_LIBYAML=0 .venv/Scripts/pip install pyyaml` (PowerShell: `$env:PYYAML_FORCE_LIBYAML=0`).

## Develop

```bash
python dev.py          # backend on :5683 (auto-reload) + frontend on :5173
```

Open http://localhost:5173, or http://<pc-ip>:5173 from a phone on the home Wi-Fi.

## Test

```bash
cd backend  && .venv/Scripts/python -m pytest
cd frontend && npm test
```

## Run for real (a PC as the server)

From `MissionControl\`:

```powershell
python serve.py
```

It rebuilds the frontend if anything in it changed, then serves the app and its API together on port 5683.
Open **http://mission-control.local:5683** on any PC or phone on the home Wi-Fi (or the PC's IP,
`ipconfig` shows it, with `:5683`).

The `.local` name works the way `homeassistant.local` does: while it runs, the server answers
"who is mission-control.local?" on the home network (multicast DNS, also called Bonjour or zeroconf), so no
router or DNS setup is needed. It follows the PC's address if that changes. `python serve.py --name kitchen`
uses `kitchen.local` instead; `--no-name` turns it off. Keep it to one word before `.local`. If a phone
can't find the name, check its Private DNS setting is Automatic (Android: Settings > Network & internet >
Private DNS). If Chrome on Android can't reach the server at all (even by IP) while Firefox can, allow
Chrome's **Nearby devices** permission (Settings > Apps > Chrome > Permissions): Android blocks apps from
the home network without it. The development server (`python dev.py`, port 5173) doesn't announce a name and
is only for that PC.
Data (database and recipe folders) lives in `data\`; set `MC_DATA_DIR` in `backend\.env` to put it
elsewhere.

**Let phones and other PCs in** (once, in an *Administrator* PowerShell). This only allows devices on the
home network, and only when Windows has the Wi-Fi marked as a Private network:

```powershell
New-NetFirewallRule -DisplayName "Mission Control" -Direction Inbound -Protocol TCP -LocalPort 5683 `
  -Profile Private -RemoteAddress LocalSubnet -Action Allow
```

The name lookups use UDP port 5353, which Windows' built-in "mDNS (UDP-In)" rule already allows on Private
networks. If phones still can't find the name, add the same for Python:

```powershell
New-NetFirewallRule -DisplayName "Mission Control (name lookups)" -Direction Inbound -Protocol UDP -LocalPort 5353 `
  -Profile Private -RemoteAddress LocalSubnet -Action Allow
```

**Start it automatically when you sign in, with no window** (once, in PowerShell; set `$root` to your
`MissionControl` folder):

```powershell
$root     = "<path-to>\MissionControl"
$action   = New-ScheduledTaskAction -Execute "$root\backend\.venv\Scripts\pythonw.exe" `
              -Argument "serve.py --log logs\server.log" -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
              -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Mission Control server" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Serves Mission Control on port 5683"
Start-ScheduledTask "Mission Control server"
```

`pythonw.exe` is Python without a console window, so the server runs invisibly in the background (Task
Manager shows it as *pythonw.exe*). `-ExecutionTimeLimit 0` stops Windows ending it after 3 days, the default
limit. Output goes to `logs\server.log`; look there if the app doesn't answer.

```powershell
Get-ScheduledTask "Mission Control server" | Select-Object State   # Running?
Stop-ScheduledTask  "Mission Control server"                       # stop the server
Start-ScheduledTask "Mission Control server"                       # start it (rebuilds the frontend if needed)
Get-Content "$root\logs\server.log" -Tail 20                       # what it's been doing
```

After pulling new code, stop it and start it again. Stop it too before running `python serve.py` or
`python dev.py` yourself: they all want port 5683.

## Configuration

Environment variables (or `backend/.env`):

| Variable | Meaning |
| --- | --- |
| `MC_DATA_DIR` | SQLite DB and recipe folders (default `./data`) |
| `MC_S3_BUCKET` | S3 bucket the app syncs recipes with. No default: S3 upload and sync need it set |
| `MC_AWS_PROFILE` | AWS profile used for S3 sync (default: the default credentials) |
| `MC_AWS_REGION` | The bucket's AWS region (default: the AWS profile's region) |
| `MC_AWS_CERT_PATH` | Server certificate, for the expiry warning on the Sync page (default: read from the AWS profile) |
| `MC_BACKUP_DIR` | Where `scripts\backup.py` writes backups (default `./backups`) |

### AWS access for recipe sync

The app reaches AWS only when you upload a recipe or use the Sync page. Give it its own AWS profile whose
credentials can only list `recipes/` in the bucket and get, put and delete objects under `recipes/`, and point
the app at it in `backend\.env` with `MC_AWS_PROFILE`. Uploads also keep `recipes/index.json` up to date for
other apps that read the bucket (their extra fields in it are kept).

The Sync page shows whether the connection works. If the profile uses a certificate, the page warns 30 days
before it expires.

### First use

Open Recipes → Sync with S3 → Sync, then "Sync down" each recipe to bring the existing S3 recipes into
the app.

## Backups

Everything the app knows lives in `data\`: the database (recipes, known items, pantry, freezer, meal plans) and
the recipe folders. S3 only has the recipes, so back up `data\` too. The backup script makes one dated zip,
is safe to run while the app is running, and keeps the newest 14 (`--keep` changes that).

From `backend\`:

```powershell
.venv\Scripts\python scripts\backup.py                       # into MissionControl\backups (or MC_BACKUP_DIR)
.venv\Scripts\python scripts\backup.py --to E:\MCBackups      # somewhere else, ideally another drive
.venv\Scripts\python scripts\backup.py --list
```

Put backups on another drive, a NAS, or a synced folder such as OneDrive, so they survive the PC. Set
`MC_BACKUP_DIR` in `backend\.env` to make that the default.

**Daily backup at 3 am** (run once, in PowerShell; set `$backend` to your `MissionControl\backend` folder):

```powershell
$backend = "<path-to>\MissionControl\backend"
$action  = New-ScheduledTaskAction -Execute "$backend\.venv\Scripts\pythonw.exe" `
             -Argument "scripts\backup.py" -WorkingDirectory $backend
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Mission Control backup" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily backup of Mission Control's data"
```

`pythonw.exe` keeps a console window from popping up at 3 am. `-StartWhenAvailable` runs a missed backup
as soon as the PC is next on. To check it worked, run `.venv\Scripts\python scripts\backup.py --list`.
The task reads `backend\.env` because it starts in `backend\`. By default it only runs while you're signed in;
to run it regardless, open Task Scheduler, open the task, and choose "Run whether user is logged on or not".

**Restoring.** Stop the app first (`Stop-ScheduledTask "Mission Control server"`, or Ctrl+C in its window), then from `backend\`:

```powershell
.venv\Scripts\python scripts\restore.py ..\backups\mission-control-20261120-030000.zip
```

It asks before doing anything. The current `data\` folder isn't deleted: it's moved aside to
`data.before-restore-<date-time>`, so you can go back. Start the app again afterwards.

## Moving the server to another machine

Two things move: the app's **data** (SQLite database and recipe folders) and its **AWS access**. Neither is
tied to a machine.

1. **Set up the app** on the new machine: install Python and Node, clone the repo, and follow
   **Setup (once)** above. Don't start the app yet.
2. **Give it AWS access**: the new machine gets its own credentials for the recipe-sync profile (the steps
   for this setup are in `LOCAL_INSTRUCTIONS.md`), and its own `backend\.env`.
3. **Move the data.** On the old machine, stop the app first so the database is fully written, then zip
   `data\`:

   ```powershell
   Compress-Archive -Path <path-to>\MissionControl\data -DestinationPath $env:USERPROFILE\Desktop\mc-data.zip
   ```

   Copy `mc-data.zip` to the new machine and unpack it as `MissionControl\data`:

   ```powershell
   Expand-Archive -Path $env:USERPROFILE\Desktop\mc-data.zip -DestinationPath <path-to>\MissionControl
   ```

   Or unpack it anywhere and set `MC_DATA_DIR` to that folder in `backend\.env`. If there's a
   `mission-control.db-wal` file, it must stay next to `mission-control.db`. Copy the folder; don't just sync
   recipes down from S3. S3 only has recipes, and the database also holds the known items, pantry, freezer
   and meal plans.
4. **Start the app** on the new machine (see **Run for real**), check that recipes, pantry and freezer look
   right, and press Sync on the Recipes page to confirm S3 access. Then remove the old machine's AWS
   credentials and its `backend\.env`.

On Linux, copy the data with `scp` or `rsync`, or unpack the zip with `unzip`.

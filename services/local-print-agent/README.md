# Sinshin Local Print Agent for Windows

This is the primary invoice transport for Sinshin. A signed-in administrator can
request printing from a phone, tablet, PWA, or another computer. The website puts
the invoice in its server queue. This C# application, running on the restaurant's
Windows PC, fetches the job over outbound HTTPS and submits it to an installed
Windows printer. No browser-to-localhost connection, inbound port, router port
forwarding, QZ Tray installation, or cloud-server route to the printer LAN is
needed.

The existing invoice builder and Persian/Arabic canvas rendering are reused. The
agent receives a monochrome image, so Windows does not need the website's fonts
and cannot reshape the invoice text differently.

## Requirements

- A Windows 10/11 PC that stays on and connected while the restaurant prints.
  Use a Windows edition/version supported by .NET 10 and a current printer driver.
- A physical printer installed in **Windows Settings → Printers & scanners** under
  the same Windows account that will run the agent. USB and LAN printers both
  work through their Windows queue.
- The updated Sinshin API/web deployment and its local-print database migration.
- The published `win-x64` package for normal Intel/AMD Windows PCs. It includes the
  .NET runtime; installing a developer SDK on the restaurant PC is unnecessary.
- Outbound HTTPS access to the site's API. Phones do not need access to the
  restaurant LAN, but the Windows PC must be able to reach its printers.

## 1. Deploy the website and API

Deploy the accompanying API and web changes together. The new database migration
is `apps/api/drizzle/0017_local_print_queue.sql`. Before pairing a station, the
site deployer applies it through the existing migration runner, with the normal
deployment database configuration:

```sh
cd apps/api
bun run db:migrate
```

For the repository's Docker deployment, run these commands from the repository
root with PostgreSQL available:

```sh
docker compose build migrate api web
docker compose run --rm migrate
docker compose up -d --no-deps api web
```

Do not replace the migration runner with ad-hoc table creation. The required
routes are:

| Caller | Routes |
| --- | --- |
| Authorized administrators | `/api/admin/print/agents`, `/local-assignment`, `/local-jobs` under the same prefix |
| Windows agent | `/api/print-agent/heartbeat`, `/claim`, `/jobs/{id}/result` |

The main administrator and secondary administrators use the same invoice print
center. Existing `printingManage` permissions still govern setup and printing;
the worker token does not grant general administrator access.

## 2. Install or replace a Windows printer

1. Install the manufacturer's Windows driver and add the USB/LAN printer.
2. Give each queue a recognizable name, for example `Sinshin Sales` and
   `Sinshin Kitchen`.
3. In the driver's printing preferences select the correct receipt roll width
   (usually 80 mm or 58 mm), portrait orientation, and no scaling or rotation.
   Set the driver's cutter option if needed.
4. Verify the printer using Windows' own test page before pairing it with
   invoices. This guide and the automated tests do not print a test page for you.

Default **Windows driver** mode supports different printer models through their
installed driver. It prints the invoice image at its physical dimensions rather
than stretching it to the page. The driver must support the receipt stock/custom
paper length. If it imposes a shorter page, the invoice continues on another page
at the same scale. An insufficient printable width is reported, not silently
shrunk or cropped. Avoid selecting virtual PDF/XPS printers, which may require an
interactive file-name dialog.

Optional **ESC/POS** mode sends RAW raster commands. Use it only if the printer
supports Epson-compatible `GS v 0` raster printing. Cutter commands apply to this
mode; driver mode uses the driver's cutter preferences. ESC/POS compatibility
must be checked for each model.

## 3. Extract and pair the agent

1. Extract `Sinshin.PrintAgent-win-x64.zip` to a permanent location, such as
   `C:\SinshinPrintAgent`, then open the inner `Sinshin.PrintAgent-win-x64`
   folder containing `Sinshin.PrintAgent.exe`. Run the following commands from
   that inner folder; keep `scripts` beside the executable.
2. Sign in to the Windows account that will operate the restaurant POS.
3. In the website's invoice print center create a station, for example
   `Restaurant POS`. Copy its **API base URL** and **one-time pairing token**.
4. Open PowerShell in the extracted folder and run:

   ```powershell
   .\Sinshin.PrintAgent.exe --configure
   ```

5. Enter the complete API base URL shown by the website, for example
   `https://your-domain.example/api`. Paste the token when prompted; it is not
   echoed. Do not put the token in a URL, command-line argument, screenshot, or
   support message.
6. Configuration is stored under `%LOCALAPPDATA%\Sinshin\PrintAgent\agent.json`.
   Windows DPAPI encrypts the token for the current Windows account. Run the agent
   under that same account. Re-pair after moving to another PC/account.

The production URL must be HTTPS and must end in `/api`. HTTP is accepted only
for a loopback development API. Redirects are not followed with the bearer token;
use the final canonical API address from the website.

## 4. Start and assign the printers

Run the executable without arguments:

```powershell
.\Sinshin.PrintAgent.exe
```

The agent reports its installed queues every 15 seconds and checks for jobs every
2 seconds. Network failures back off automatically. It does not create or print
an invoice merely by starting. Keep this console open for the first setup.

In the website's print center:

1. Refresh the station/printer list and confirm the station is online.
2. Select the station and Windows printer separately for **Sales** and **Kitchen**.
3. Select the correct raster width: **576 dots for 80 mm stock** (72 mm ink),
   **384 dots for 58 mm stock** (48 mm ink), or **420 dots for a compatible 58 mm
   head** (52.5 mm ink).
4. Start with **Windows driver** mode. Save the assignments.
5. Open a real order, choose the invoice copy, and send it to the local agent.
   Verify the physical output once before using the station during service.

All administrator devices send to these shared assignments. Browser printing is
an explicit emergency action; an uncertain agent job is never automatically
sent to the browser and printed a second time.

## 5. Enable startup at Windows sign-in

After the first successful setup, stop the console worker with **Ctrl+C**, then run:

```powershell
.\scripts\Install-Startup.ps1
```

This creates a Task Scheduler task for the current Windows user, starts it now,
and runs it hidden at future sign-ins. It does not install a privileged Windows
service. Keep that Windows account signed in; a locked screen is fine, signing
out is not. The task uses the same account's printers and encrypted token.

If organizational PowerShell policy blocks unsigned scripts, have the machine's
administrator approve/sign these scripts according to that policy. Do not disable
endpoint protection or use a blanket execution-policy bypass.

The task name starts with `Sinshin Print Agent -` followed by the current user's
SID. View it in **Task Scheduler**. The current run's status log is:

```text
%LOCALAPPDATA%\Sinshin\PrintAgent\logs\agent.log
```

To stop automatic startup without deleting pairing or the journal:

```powershell
.\scripts\Remove-Startup.ps1
```

## 6. Change a printer later

Install the replacement driver/queue in Windows. Within approximately 15 seconds
the new queue appears in the station's list. Select it in the same website print
center and save the Sales/Kitchen assignment. No C# source change or agent rebuild
is needed. Existing queued jobs keep their original printer; cancel an unclaimed
job and explicitly create a new one when its destination must change. A removed
printer is reported as failed instead of silently switching to Windows' default.

## Job results and recovery

- **Queued:** safely stored on the server, awaiting the station.
- **Claimed:** owned by a worker; it is not automatically requeued.
- **Spooled:** Windows accepted submission. This is not proof that paper came out.
- **Failed:** the agent knows submission did not reach the spooler, for example a
  selected queue was removed.
- **Uncertain:** the process/connection stopped during submission or a claimed job
  became stale. Inspect the physical printer and Windows queue before deciding
  to reprint. Create a new explicit print job only when appropriate.

If the browser shows a **pending request**, recover/retry that request first;
recovery keeps its original job ID instead of producing another invoice copy.
To abandon it, use **Discard pending request**: the server keeps a cancellation
record so a late original submission cannot print afterward. **Cancel queued
job** applies only before the agent claims it; for claimed or uncertain jobs,
inspect the printer and Windows queue before requesting another copy.

The local `stations/<pairing fingerprint>/jobs` directory is an atomic receipt
journal. It records job IDs,
payload hashes, claim receipts, and results; it does not store invoice bitmap
contents. The journal is written before printing. Repeated IDs never produce
another paper copy. After a crash, unfinished submissions become uncertain.
Lost result acknowledgements are retried without printing again.

Do not delete the journal to fix a connection problem, run two workers with
different data directories for the same station, or clone a pairing token onto
another PC. Revoke and create a separate station/token when replacing the PC.
If the journal is damaged, the agent stops rather than forgetting duplicate
protection. Keep its data folder private and include it in workstation backups.
Reconfiguring with a newly issued station token preserves the previous station's
journal separately. Re-entering the same token reuses the same journal. Old
uncertain jobs remain visible for review in their original server station; a new
station does not claim or acknowledge them.

## Browser emergency printing

The web print center opens a separate invoice document. Choose the receipt stock
in the browser/driver dialog, **100% scale**, portrait, and disable browser headers
and footers. Adjust supported margins there. Browser menus do not provide a
universal image-cropping feature, and a printer's unprintable hardware margins
cannot be removed by website CSS. Use the local agent for routine POS printing.

## Build and verify from source

Install Microsoft's **.NET 10 SDK** on a Windows development machine, then from
this source directory run:

```powershell
dotnet build .\Sinshin.PrintAgent\Sinshin.PrintAgent.csproj -c Release
dotnet run --project .\Sinshin.PrintAgent.Tests\Sinshin.PrintAgent.Tests.csproj -c Release
.\scripts\Publish.ps1
```

The verifier uses fake printers and covers the protocol, raster framing,
physical dimensions, token encryption, deduplication, partial failure, crash
recovery, and acknowledgement retries. It never sends a job to a physical
printer. Real printer/driver acceptance still needs the setup check above.

`Publish.ps1` creates a self-contained Windows executable package, a separate
source ZIP, and `SHA256SUMS.txt` under `artifacts`. A `win-arm64` build can be
requested with `-Runtime win-arm64`. The release archive deliberately excludes
SDK caches, test fixtures, station credentials, logs, and job journals. Build
artifacts are ignored by Git.

The generated executable is an unsigned development release. For managed
production distribution, sign it with the organization's code-signing
certificate. `SHA256SUMS.txt` verifies package integrity; it does not establish
publisher identity or replace code signing. Windows may apply SmartScreen checks
to a newly downloaded unsigned executable.

For isolated development fixtures, all commands also accept a data-directory
override:

```powershell
.\Sinshin.PrintAgent.exe --configure --data-dir C:\SinshinDevData
.\Sinshin.PrintAgent.exe --data-dir C:\SinshinDevData
.\Sinshin.PrintAgent.exe --list-printers
```

## Operational limits

The agent transports invoices to Windows printer queues; it does not integrate
with payment terminals, cash drawers, or a POS vendor's proprietary order API.
Windows/driver acceptance cannot guarantee physical print completion. Receipt
width, custom paper support, cutter behavior, and density must be verified for
the installed hardware. The worker requires a running Windows PC and the API;
offline server jobs wait until connectivity returns. Other devices use the web
interface and do not run this Windows executable.

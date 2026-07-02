# Workday Time Tracker

Workday Time Tracker is a small desktop app for tracking the shape of a workday: when work starts, when pauses happen, why those pauses happened, and how the day adds up.

It is built for simple, repeated use: large buttons, local storage, quick pause reasons, daily/weekly/monthly stats, and an XLSX export when you want a spreadsheet copy.

## Features

- Start work, pause, resume, and end the day from one screen.
- Track pause reasons such as Bathroom, Family, Break, Admin, Meal, and custom categories.
- Add optional notes to pause or stop events.
- View live work time, pause time, and the current clock.
- Review daily, weekly, and monthly summaries.
- Export an XLSX workbook with raw segments, summary totals, and category summaries.
- Store data locally in SQLite.
- Use the Electron desktop build on macOS or Windows, including a macOS menu bar status item.
- Use the newer Tauri desktop build as an alternate Windows packaging path.

## Requirements

All development paths need:

- Node.js LTS
- npm

The recommended Tauri path also needs:

- Rustup/Cargo
- Visual Studio Build Tools with the C++ workload on Windows
- WebView2 Runtime, which is included on current Windows installs

The Electron fallback path also needs:

- Native build tools for `better-sqlite3`
- Windows Node/npm when building directly on Windows
- Xcode Command Line Tools when building the macOS app on macOS

## Getting Started

Clone the repo and install dependencies:

```bash
git clone https://github.com/itsauctions/TimeTracking.git
cd TimeTracking
npm install
```

From there, choose one of the two paths below.

## Path 1: Tauri

Tauri is the recommended path for normal desktop use. It produces a smaller Windows app and starts faster than the Electron version.

Run the app in development:

```bash
npm run tauri:dev
```

Build the Windows app:

```bash
npm run tauri:build
```

Expected Windows build outputs:

```text
dist/tauri/Workday Time Tracker_0.2.0_x64-setup.exe
dist/tauri/workday-time-tracker-0.2.0.exe
```

Use the setup `.exe` for normal installation. The raw `.exe` is useful for quick local testing.

## Path 2: Electron

Electron is the preferred path when you want the macOS app or the older Windows packaging workflow. It uses the same UI and local SQLite data model.

Run the app in development:

```bash
npm start
```

Build a portable Windows executable:

```bash
npm run package:win
```

Build the universal macOS app, DMG, and ZIP for both Intel and Apple Silicon Macs:

```bash
npm run package:mac
```

On macOS, the Electron app also appears in the upper menu bar with quick timer controls.

If you are packaging from WSL and need to skip Windows executable signing/editing, use:

```bash
npm run package:win:wsl
```

Because `better-sqlite3` is a native module, keep the `postinstall` rebuild step in `package.json`. It rebuilds SQLite for Electron's runtime after install.

## Using The App

1. Click **Start Work** when the workday begins.
2. Click **Pause** or a quick pause reason when stepping away.
3. Click **Resume** when returning to work.
4. Click **End Day** when finished.
5. Open **Stats** to review totals.
6. Click **Export XLSX** to create a spreadsheet copy of the tracked time.

Custom pause categories can be added from the settings button in the app navigation.

## Local Data

The app stores its SQLite database locally as:

```text
workday-time.sqlite
```

In Electron, this lives in Electron's `userData` folder. In Tauri, this lives in the app data directory resolved by Tauri.

Exports are only created when requested. The XLSX export includes:

- `Segments`: raw work and pause segments
- `Summary`: day, week, and month totals
- `Category Summary`: pause totals grouped by category

## Useful Commands

```bash
npm install
npm start
npm run package:mac
npm run tauri:dev
npm run tauri:build
npm run package:win
npm run package:win:wsl
```

Run the Electron SQLite smoke test:

```bash
ELECTRON_RUN_AS_NODE=1 npx electron scripts/db-smoke.js
```

## Troubleshooting

If Electron fails to launch in WSL, install the missing GUI/runtime libraries or run the app from Windows Node/npm instead.

If Tauri build commands fail, confirm that Rustup/Cargo and Visual Studio Build Tools are installed and available in the same shell where you run npm.

If SQLite fails after dependency changes, rerun:

```bash
npm install
```

That triggers the Electron rebuild step for `better-sqlite3`.

## License

MIT. See [LICENSE](LICENSE).

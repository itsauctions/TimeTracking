# Workday Time Tracker

A small Windows-first desktop time tracker with a large-button UI, local SQLite storage, on-demand CSV export, and system tray behavior.

## Current Features

- Start work, pause, resume, and end the day from the main screen.
- Large click targets, no hotkeys.
- Live work time, paused time, and current clock display.
- Fixed pause presets with a settings menu for adding custom categories.
- SQLite database stored in Electron's user data folder.
- CSV export only when requested.
- Closing the window hides it to the tray instead of quitting.

## Run

```bash
npm install
npm start
```

Because `better-sqlite3` is a native module, keep the `postinstall` rebuild step in `package.json`. It rebuilds SQLite for Electron's runtime.

## Package For Windows

```bash
npm run package:win
```

The package script creates a portable Windows build through Electron Builder.

## Local Data

The app stores its database as:

```text
workday-time.sqlite
```

inside Electron's `userData` folder for the app.

## Notes

This project was scaffolded from WSL. Static JavaScript checks pass, but Electron could not launch in the current WSL environment because `libnss3` is missing. Since SQLite is rebuilt for Electron, the SQLite smoke test should be run with Electron:

```bash
ELECTRON_RUN_AS_NODE=1 npx electron scripts/db-smoke.js
```

That command is also blocked in this WSL image until the missing Electron runtime libraries are installed. Running as a Windows desktop app will need either Windows Node/npm installed or the missing WSL GUI libraries installed.

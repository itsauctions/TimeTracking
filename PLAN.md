# Time Tracking App Plan

## Brief Questions

1. Windows desktop app first. A lightweight browser shell is acceptable if it behaves like a standalone app.
2. No hotkeys for now. Use large, easy click targets in the app.
3. Pause reasons should use fixed presets, with a simple settings menu to add custom categories.
4. Track workday time only for now, not named projects/tasks.
5. CSV files should only be created when the user requests an export. Normal storage is SQLite.
6. The app should always keep running in the system tray.

## Proposed Scope

Build a small standalone time tracking app with:

- A clean desktop UI for the current timer state.
- One-click controls for start, pause, resume, and end day.
- Large click targets instead of hotkeys.
- Pause reason capture with fixed presets, custom categories, and optional notes.
- Local SQLite storage.
- Fast on-demand CSV export.
- Basic daily history view.
- System tray behavior so closing/minimizing does not quit tracking.

## Suggested Tech Stack

- App shell: Tauri or Electron.
- UI: React or simple HTML/CSS/TypeScript.
- Database: SQLite.
- Export: CSV generated directly from SQLite records.

Preferred initial direction: Electron if dependencies are available quickly, because it provides reliable Windows tray behavior and a browser-like desktop shell. Tauri is the fallback if Electron setup friction is too high.

## Data Model Draft

### sessions

- id
- started_at
- ended_at
- status
- created_at
- updated_at

### events

- id
- session_id
- event_type: start, pause, resume, stop
- reason
- note
- occurred_at

### settings

- key
- value

## CSV Export Draft

Export rows should include:

- date
- session_id
- segment_start
- segment_end
- duration_minutes
- segment_type: work or pause
- pause_reason
- note

## Implementation Plan

1. Confirm answers to the brief questions.
2. Scaffold the desktop app inside `TimeTracking`.
3. Add SQLite schema and a small data access layer.
4. Build the main timer UI.
5. Add pause reason picker, notes, and editable custom categories.
6. Add daily history and CSV export.
7. Add system tray behavior.
8. Package or document how to run as a standalone app.

## First Milestone

Create a minimal runnable app that can:

- Start work.
- Pause with a reason.
- Resume work.
- End the day.
- Persist those events to SQLite.
- Export the current day to CSV.

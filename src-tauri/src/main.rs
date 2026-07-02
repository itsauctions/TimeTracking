#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{Datelike, Local, TimeZone, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};
use zip::write::FileOptions;

const DEFAULT_CATEGORIES: [&str; 6] = ["Bathroom", "Family", "Break", "Admin", "Meal", "Other"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventRow {
    id: i64,
    #[serde(rename = "type")]
    event_type: String,
    reason: Option<String>,
    note: Option<String>,
    occurred_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Category {
    id: i64,
    name: String,
    is_default: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    #[serde(rename = "type")]
    segment_type: String,
    start: String,
    end: String,
    duration_minutes: f64,
    reason: String,
    note: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    work_ms: i64,
    pause_ms: i64,
    segments: Vec<Segment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct State {
    status: String,
    active_since: Option<String>,
    events: Vec<EventRow>,
    categories: Vec<Category>,
    totals: Totals,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct PeriodStats {
    key: String,
    work_ms: i64,
    pause_ms: i64,
    total_ms: i64,
    categories: BTreeMap<String, i64>,
}

#[derive(Debug, Serialize)]
struct Stats {
    days: Vec<PeriodStats>,
    weeks: Vec<PeriodStats>,
    months: Vec<PeriodStats>,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Could not resolve app data directory: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("Could not create app data directory: {err}"))?;
    Ok(dir.join("workday-time.sqlite"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|err| err.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| err.to_string())?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL CHECK(event_type IN ('start', 'pause', 'resume', 'stop')),
          reason TEXT,
          note TEXT,
          occurred_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        ",
    )
    .map_err(|err| err.to_string())?;

    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    for category in DEFAULT_CATEGORIES {
        conn.execute(
            "INSERT OR IGNORE INTO categories (name, is_default, created_at) VALUES (?1, 1, ?2)",
            params![category, now],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(conn)
}

fn today_key_from_local_now() -> String {
    let now = Local::now();
    format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day())
}

fn local_day_range() -> (String, String) {
    let now = Local::now();
    let start = Local
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
        .single()
        .unwrap();
    let end = start + chrono::Duration::days(1);
    (start.with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true), end.with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn events_between(conn: &Connection, start: &str, end: &str) -> Result<Vec<EventRow>, String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT id, event_type, reason, note, occurred_at
            FROM events
            WHERE occurred_at >= ?1 AND occurred_at < ?2
            ORDER BY occurred_at ASC, id ASC
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![start, end], |row| {
            Ok(EventRow {
                id: row.get(0)?,
                event_type: row.get(1)?,
                reason: row.get(2)?,
                note: row.get(3)?,
                occurred_at: row.get(4)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn all_events(conn: &Connection) -> Result<Vec<EventRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, event_type, reason, note, occurred_at FROM events ORDER BY occurred_at ASC, id ASC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(EventRow {
                id: row.get(0)?,
                event_type: row.get(1)?,
                reason: row.get(2)?,
                note: row.get(3)?,
                occurred_at: row.get(4)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn categories(conn: &Connection) -> Result<Vec<Category>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, is_default FROM categories ORDER BY is_default DESC, lower(name) ASC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                is_default: row.get(2)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn calculate_totals(events: &[EventRow]) -> Totals {
    let mut totals = Totals::default();
    let mut open_type = String::new();
    let mut open_at: Option<chrono::DateTime<Utc>> = None;
    let mut open_reason = String::new();
    let mut open_note = String::new();
    let now = Utc::now();

    for event in events {
        let occurred = chrono::DateTime::parse_from_rfc3339(&event.occurred_at)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(now);
        if event.event_type == "start" || event.event_type == "resume" {
            if open_type == "pause" {
                if let Some(start) = open_at {
                    add_segment(&mut totals, "pause", start, occurred, &open_reason, &open_note);
                }
            }
            open_type = "work".into();
            open_at = Some(occurred);
            open_reason.clear();
            open_note.clear();
        }

        if event.event_type == "pause" {
            if open_type == "work" {
                if let Some(start) = open_at {
                    add_segment(&mut totals, "work", start, occurred, "", "");
                }
            }
            open_type = "pause".into();
            open_at = Some(occurred);
            open_reason = event.reason.clone().unwrap_or_default();
            open_note = event.note.clone().unwrap_or_default();
        }

        if event.event_type == "stop" {
            if let Some(start) = open_at {
                if !open_type.is_empty() {
                    add_segment(&mut totals, &open_type, start, occurred, &open_reason, &open_note);
                }
            }
            open_type.clear();
            open_at = None;
            open_reason.clear();
            open_note.clear();
        }
    }

    if let Some(start) = open_at {
        if !open_type.is_empty() {
            add_segment(&mut totals, &open_type, start, now, &open_reason, &open_note);
        }
    }

    totals
}

fn add_segment(totals: &mut Totals, segment_type: &str, start: chrono::DateTime<Utc>, end: chrono::DateTime<Utc>, reason: &str, note: &str) {
    let duration_ms = (end - start).num_milliseconds().max(0);
    if segment_type == "work" {
        totals.work_ms += duration_ms;
    } else {
        totals.pause_ms += duration_ms;
    }
    totals.segments.push(Segment {
        segment_type: segment_type.into(),
        start: start.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        end: end.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        duration_minutes: ((duration_ms as f64 / 60000.0) * 100.0).round() / 100.0,
        reason: reason.into(),
        note: note.into(),
    });
}

fn stats_summary_from_segments(segments: &[Segment]) -> Stats {
    let mut days = BTreeMap::new();
    let mut weeks = BTreeMap::new();
    let mut months = BTreeMap::new();
    for segment in segments {
        let start = chrono::DateTime::parse_from_rfc3339(&segment.start).unwrap().with_timezone(&Local);
        add_period(&mut days, format!("{:04}-{:02}-{:02}", start.year(), start.month(), start.day()), segment);
        let week_start = start.date_naive() - chrono::Duration::days(start.weekday().num_days_from_sunday() as i64);
        add_period(&mut weeks, week_start.format("%Y-%m-%d").to_string(), segment);
        add_period(&mut months, format!("{:04}-{:02}", start.year(), start.month()), segment);
    }
    Stats {
        days: days.into_values().rev().collect(),
        weeks: weeks.into_values().rev().collect(),
        months: months.into_values().rev().collect(),
    }
}

fn add_period(map: &mut BTreeMap<String, PeriodStats>, key: String, segment: &Segment) {
    let bucket = map.entry(key.clone()).or_insert_with(|| PeriodStats { key, ..Default::default() });
    let duration_ms = (segment.duration_minutes * 60000.0).round() as i64;
    bucket.total_ms += duration_ms;
    if segment.segment_type == "work" {
        bucket.work_ms += duration_ms;
    } else {
        bucket.pause_ms += duration_ms;
        let category = if segment.reason.is_empty() { "Uncategorized" } else { &segment.reason };
        *bucket.categories.entry(category.into()).or_insert(0) += duration_ms;
    }
}

#[tauri::command]
fn get_state(app: AppHandle) -> Result<State, String> {
    let conn = open_db(&app)?;
    let (start, end) = local_day_range();
    let events = events_between(&conn, &start, &end)?;
    let latest = events.last();
    let status = match latest.map(|event| event.event_type.as_str()) {
        Some("start") | Some("resume") => "working",
        Some("pause") => "paused",
        Some("stop") => "stopped",
        _ => "idle",
    };
    Ok(State {
        status: status.into(),
        active_since: if status == "working" || status == "paused" { latest.map(|event| event.occurred_at.clone()) } else { None },
        categories: categories(&conn)?,
        totals: calculate_totals(&events),
        events,
    })
}

#[tauri::command]
fn get_stats(app: AppHandle) -> Result<Stats, String> {
    let conn = open_db(&app)?;
    let totals = calculate_totals(&all_events(&conn)?);
    Ok(stats_summary_from_segments(&totals.segments))
}

#[tauri::command]
fn add_event(app: AppHandle, event_type: String, reason: Option<String>, note: Option<String>) -> Result<State, String> {
    add_event_record(&app, &event_type, reason, note)?;
    get_state(app)
}

fn add_event_record(app: &AppHandle, event_type: &str, reason: Option<String>, note: Option<String>) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO events (event_type, reason, note, occurred_at) VALUES (?1, ?2, ?3, ?4)",
        params![event_type, reason, note, Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_category(app: AppHandle, name: String) -> Result<State, String> {
    let clean_name = name.trim().to_string();
    if !clean_name.is_empty() {
        let conn = open_db(&app)?;
        conn.execute(
            "INSERT OR IGNORE INTO categories (name, is_default, created_at) VALUES (?1, 0, ?2)",
            params![clean_name, Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)],
        )
        .map_err(|err| err.to_string())?;
    }
    get_state(app)
}

#[tauri::command]
fn export_today(app: AppHandle) -> Result<String, String> {
    let conn = open_db(&app)?;
    let totals = calculate_totals(&all_events(&conn)?);
    let stats = stats_summary_from_segments(&totals.segments);
    let workbook = create_workbook(&totals.segments, &stats)?;
    let path = dirs::download_dir()
        .unwrap_or(std::env::current_dir().map_err(|err| err.to_string())?)
        .join(format!("workday-time-export-{}.xlsx", today_key_from_local_now()));
    fs::write(&path, workbook).map_err(|err| err.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn create_workbook(segments: &[Segment], stats: &Stats) -> Result<Vec<u8>, String> {
    let mut segment_rows = vec![vec![
        "date".into(),
        "segment_start".into(),
        "segment_end".into(),
        "segment_type".into(),
        "pause_reason".into(),
        "note".into(),
        "duration_minutes".into(),
    ]];
    segment_rows.extend(segments.iter().map(|segment| vec![
            segment.start[0..10].into(),
            segment.start.clone(),
            segment.end.clone(),
            segment.segment_type.clone(),
            segment.reason.clone(),
            segment.note.clone(),
            segment.duration_minutes.to_string(),
        ]));
    let summary_rows = summary_rows("day", &stats.days)
        .into_iter()
        .chain(summary_rows("week", &stats.weeks))
        .chain(summary_rows("month", &stats.months))
        .collect::<Vec<_>>();
    let category_rows = category_rows("day", &stats.days)
        .into_iter()
        .chain(category_rows("week", &stats.weeks))
        .chain(category_rows("month", &stats.months))
        .collect::<Vec<_>>();
    write_xlsx(vec![
        ("Segments", segment_rows),
        ("Summary", summary_rows),
        ("Category Summary", category_rows),
    ])
}

fn summary_rows(period_type: &str, periods: &[PeriodStats]) -> Vec<Vec<String>> {
    let mut rows = vec![vec!["period_type".into(), "period_key".into(), "work_minutes".into(), "pause_minutes".into(), "total_minutes".into()]];
    for period in periods {
        rows.push(vec![period_type.into(), period.key.clone(), mins(period.work_ms), mins(period.pause_ms), mins(period.total_ms)]);
    }
    rows
}

fn category_rows(period_type: &str, periods: &[PeriodStats]) -> Vec<Vec<String>> {
    let mut rows = vec![vec!["period_type".into(), "period_key".into(), "category".into(), "category_minutes".into()]];
    for period in periods {
        for (category, ms) in &period.categories {
            rows.push(vec![period_type.into(), period.key.clone(), category.clone(), mins(*ms)]);
        }
    }
    rows
}

fn mins(ms: i64) -> String {
    format!("{:.2}", ms as f64 / 60000.0)
}

fn write_xlsx(sheets: Vec<(&str, Vec<Vec<String>>)>) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut out);
    let sheet_overrides = (1..=sheets.len()).map(|i| format!(r#"<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#)).collect::<String>();
    zip.start_file("[Content_Types].xml", zip_options()).map_err(|err| err.to_string())?;
    write!(zip, r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>{sheet_overrides}</Types>"#).map_err(|err| err.to_string())?;
    zip.start_file("_rels/.rels", zip_options()).map_err(|err| err.to_string())?;
    write!(zip, r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#).map_err(|err| err.to_string())?;
    let sheet_tags = sheets.iter().enumerate().map(|(idx, sheet)| format!(r#"<sheet name="{}" sheetId="{}" r:id="rId{}"/>"#, xml_escape(sheet.0), idx + 1, idx + 1)).collect::<String>();
    zip.start_file("xl/workbook.xml", zip_options()).map_err(|err| err.to_string())?;
    write!(zip, r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheet_tags}</sheets></workbook>"#).map_err(|err| err.to_string())?;
    let rels = (1..=sheets.len()).map(|i| format!(r#"<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>"#)).collect::<String>();
    zip.start_file("xl/_rels/workbook.xml.rels", zip_options()).map_err(|err| err.to_string())?;
    write!(zip, r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#).map_err(|err| err.to_string())?;
    for (idx, sheet) in sheets.iter().enumerate() {
        zip.start_file(format!("xl/worksheets/sheet{}.xml", idx + 1), zip_options()).map_err(|err| err.to_string())?;
        write!(zip, "{}", sheet_xml(&sheet.1)).map_err(|err| err.to_string())?;
    }
    zip.finish().map_err(|err| err.to_string())?;
    Ok(out.into_inner())
}

fn zip_options() -> FileOptions<'static, ()> {
    FileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

fn sheet_xml(rows: &[Vec<String>]) -> String {
    let rows_xml = rows.iter().enumerate().map(|(row_idx, row)| {
        let cells = row.iter().enumerate().map(|(col_idx, value)| {
            format!(r#"<c r="{}{}" t="inlineStr"><is><t>{}</t></is></c>"#, column_name(col_idx + 1), row_idx + 1, xml_escape(value))
        }).collect::<String>();
        format!(r#"<row r="{}">{cells}</row>"#, row_idx + 1)
    }).collect::<String>();
    format!(r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows_xml}</sheetData></worksheet>"#)
}

fn column_name(mut index: usize) -> String {
    let mut name = String::new();
    while index > 0 {
        let remainder = (index - 1) % 26;
        name.insert(0, (b'A' + remainder as u8) as char);
        index = (index - 1) / 26;
    }
    name
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "show_timer" => emit_nav(app, "timer"),
                "show_stats" => emit_nav(app, "stats"),
                "next_theme" => {
                    let _ = app.emit("menu:cycle-theme", ());
                }
                "export_xlsx" => {
                    let _ = export_today(app.clone());
                }
                "start_work" => {
                    let _ = add_event_record(app, "start", None, None);
                }
                "resume_work" => {
                    let _ = add_event_record(app, "resume", None, None);
                }
                "pause_bathroom" => pause_from_menu(app, "Bathroom"),
                "pause_family" => pause_from_menu(app, "Family"),
                "pause_break" => pause_from_menu(app, "Break"),
                "pause_admin" => pause_from_menu(app, "Admin"),
                "pause_meal" => pause_from_menu(app, "Meal"),
                "pause_other" => pause_from_menu(app, "Other"),
                "end_day" => {
                    let _ = add_event_record(app, "stop", None, None);
                }
                "hide_to_tray" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "help" => {
                    let _ = app.emit("menu:help", ());
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![get_state, get_stats, add_event, add_category, export_today])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let status = SubmenuBuilder::new(app, "Ready")
        .text("show_timer", "Show Timer")
        .text("show_stats", "Show Stats")
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .text("export_xlsx", "Export XLSX")
        .separator()
        .text("quit", "Quit")
        .build()?;
    let pause_for = SubmenuBuilder::new(app, "Pause For")
        .text("pause_bathroom", "Bathroom")
        .text("pause_family", "Family")
        .text("pause_break", "Break")
        .text("pause_admin", "Admin")
        .text("pause_meal", "Meal")
        .text("pause_other", "Other")
        .build()?;
    let timer = SubmenuBuilder::new(app, "Timer")
        .text("start_work", "Start Work")
        .text("resume_work", "Resume")
        .item(&pause_for)
        .text("end_day", "End Day")
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .text("show_timer", "Timer")
        .text("show_stats", "Stats")
        .text("next_theme", "Next Theme")
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .text("hide_to_tray", "Hide To Tray")
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .text("help", "How This Works")
        .build()?;
    MenuBuilder::new(app)
        .item(&status)
        .item(&file)
        .item(&timer)
        .item(&view)
        .item(&window)
        .item(&help)
        .build()
}

fn emit_nav(app: &AppHandle, page: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("menu:navigate", page);
}

fn pause_from_menu(app: &AppHandle, reason: &str) {
    let _ = add_event_record(app, "pause", Some(reason.into()), None);
}

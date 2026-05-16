# FFR Property OS Desktop

The desktop build wraps the existing full-stack app in Electron for macOS.

## What It Does

- Starts the Node/Express server locally on port `3152`.
- Stores the desktop SQLite database in the macOS app data folder unless `DATABASE_PATH` is set.
- Loads the React app inside a desktop window.
- Exposes native desktop notifications to the Team Home screen.
- Uses the same Google Calendar connection as the web app.

## Commands

```bash
npm run desktop:dev
npm run desktop:pack:mac
npm run desktop:zip:mac
npm run desktop:dist:mac
```

`desktop:pack:mac` creates an unpacked `.app` for local testing. `desktop:zip:mac` creates a downloadable zip of the `.app`. `desktop:dist:mac` creates a DMG when local macOS disk image tooling is available.

## Railway Safety

The Railway web deployment still uses `npm start`, which starts `server/index.js`. The Electron entrypoint is only used by the desktop scripts and packaged app metadata.

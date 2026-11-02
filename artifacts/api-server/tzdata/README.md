# ICU time zone files

Compiled ICU time zone data (format 44, little-endian: ICU 74+, so Node 22 and 24) from
https://github.com/unicode-org/icu-data/tree/main/tzdata/icunew, copied unchanged.

Node reads them when `ICU_TIMEZONE_FILES_DIR` points here, and uses them instead of the tz database
built into the Node binary. The Nix Node on Replit ships 2026a; these carry 2026e, where
`America/Vancouver` stays on UTC-07:00 all year, matching GitHub Actions' Node.

Set in `package.json` (`start`) and `.replit-artifact/artifact.toml` (production run env). A wrong
directory is ignored silently, so check the `[request-dates]` boot line: its `tz database` must read the
version shipped here.

To update: copy `metaZones.res`, `timezoneTypes.res`, `windowsZones.res` and `zoneinfo64.res` from
`icunew/<version>/44/le/` into a new `tzdata/<version>/` folder, then change the two paths above and the
test in `src/request-dates.test.ts`. Drop this folder once Node on Replit bundles a new enough database.

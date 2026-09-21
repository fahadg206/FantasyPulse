# Player value crawler

Scrapes [KeepTradeCut](https://keeptradecut.com) dynasty/redraft, 1QB/superflex
player market values, maps them to Sleeper player IDs, and replaces the
`fantasypulse.playersValues` MongoDB collection with the fresh snapshot. This
is the data source behind `src/lib/playerValue.ts` and the trade calculator's
player values.

## Running locally

```
cd scripts/player-value-crawler
pip install -r requirements.txt
MONGO_PASSWORD=<the real password> python3 webcrawler.py
```

If `MONGO_PASSWORD` isn't set it falls back to the same default used
elsewhere in this app. A `players_data.json` snapshot is written next to the
script for inspection; MongoDB is the actual source of truth the app reads
from.

## Scheduled run

`.github/workflows/update-player-values.yml` runs this script every Sunday at
09:00 UTC via GitHub Actions, and can also be triggered manually from the
Actions tab ("Run workflow"). It reads the Mongo password from the
`MONGO_PASSWORD` repository secret — set that under
Settings → Secrets and variables → Actions before relying on the schedule.

## Notes

- The script does a full refresh (`delete_many({})` then `insert_many()`) on
  every run, not an incremental update, so the collection always mirrors the
  latest KTC snapshot with no stale duplicates left behind.
- `Value` / `RdrftValue` are the 1QB dynasty/redraft markets; `SFValue` /
  `SFRdrftValue` are the superflex dynasty/redraft markets.

# Auto-posting scheduler (macOS launchd)

Runs one full **cycle** per day — a finance + entertainment + hot-take + brainrot
video, learning from analytics and experimenting with length/captions/hooks/visuals
each time — and posts them public.

## Create a runner script

Save this as `run-cycle.sh` in the project root and make it executable:

```bash
#!/bin/zsh
export PATH="/opt/homebrew/bin:$HOME/.nvm/versions/current/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export YOUTUBE_PRIVACY=public
cd "$(dirname "$0")" || exit 1
npx tsx src/cli.ts cycle >> cycle.log 2>&1
```

## Create a launchd plist

Save this as `scheduler/com.shortsrev.cycle.plist` (replace the path with your own machine's path):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.shortsrev.cycle</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>/path/to/your/run-cycle.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>16</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/path/to/your/cycle.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/your/cycle.log</string>
</dict>
</plist>
```

## Activate (you run this — it's a standing action)

```bash
chmod +x run-cycle.sh
cp scheduler/com.shortsrev.cycle.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.shortsrev.cycle.plist
```

That's it — it runs daily at 16:00 (your Mac must be awake at that time).

## Change cadence
Edit `Hour`/`Minute` in the plist, or add more time entries, then reload:
```bash
launchctl unload ~/Library/LaunchAgents/com.shortsrev.cycle.plist
launchctl load   ~/Library/LaunchAgents/com.shortsrev.cycle.plist
```

## Run one cycle right now (test)
```bash
npx tsx src/cli.ts cycle --privacy=public
```

## Stop the auto-poster
```bash
launchctl unload ~/Library/LaunchAgents/com.shortsrev.cycle.plist
```

## Watch it
```bash
tail -f cycle.log
```

## ⚠️ Prerequisites for "very regularly"
- **ElevenLabs credits** are the bottleneck. Free tier ≈ 14 videos total. At 4/day
  you need a paid plan: Starter ($5/mo ≈ 40 videos) or Creator ($22/mo ≈ 130 videos ≈ 4/day).
- YouTube quota caps ~6 uploads/day by default (a cycle uses 4).
- If credits run out mid-cycle, slots just skip — no broken videos get posted.

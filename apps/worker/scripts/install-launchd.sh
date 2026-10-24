#!/bin/sh
# 렌더 작업자를 맥 로그인 때마다 자동으로 켜고, 꺼지면 다시 켠다 (launchd).
#
#   RENDER_API_URL=https://내도메인 RENDER_WORKER_TOKEN=토큰 ./scripts/install-launchd.sh
#   ./scripts/install-launchd.sh --uninstall      # 끄고 지우기
#   ./scripts/install-launchd.sh --print          # 설정 파일만 보기 (등록 안 함)
#
# 로그: ~/Library/Logs/beautypost-worker.log
set -e
LABEL=com.beautypost.worker
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/beautypost-worker.log"

if [ "$1" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "작업자 자동 실행을 껐어요."
  exit 0
fi

: "${RENDER_API_URL:?RENDER_API_URL 을 지정해 주세요 (예: https://beautypost.shop)}"
: "${RENDER_WORKER_TOKEN:?RENDER_WORKER_TOKEN 을 지정해 주세요 (Vercel 에 넣은 값과 같게)}"
NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "node 를 찾을 수 없어요"; exit 1; }
FILMCRAFT_DIR="${FILMCRAFT_DIR:-$(cd "$DIR/../../.." && pwd)/filmcraft}"
[ -x "$FILMCRAFT_DIR/br" ] || { echo "filmcraft 를 찾을 수 없어요: $FILMCRAFT_DIR (FILMCRAFT_DIR 로 지정)"; exit 1; }

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

PLIST_XML="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$(xml "$DIR")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$DIR/node_modules/tsx/dist/cli.mjs")</string>
    <string>src/main.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")</string>
    <key>RENDER_API_URL</key><string>$(xml "$RENDER_API_URL")</string>
    <key>RENDER_WORKER_TOKEN</key><string>$(xml "$RENDER_WORKER_TOKEN")</string>
    <key>FILMCRAFT_DIR</key><string>$(xml "$FILMCRAFT_DIR")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>"

if [ "$1" = "--print" ]; then
  printf '%s\n' "$PLIST_XML"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
printf '%s\n' "$PLIST_XML" > "$PLIST"
chmod 600 "$PLIST" # 토큰이 들어 있으므로 본인만 읽기
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "작업자를 켰어요. 로그: tail -f $LOG"

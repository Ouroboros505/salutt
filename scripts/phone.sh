#!/usr/bin/env bash
# Prints every address the dev server is reachable on, with a QR code to scan.
# Usage:  npm run phone            (after `npm run dev` is running)
#         npm run phone -- 4173    (for `npm run preview`)
set -uo pipefail

PORT="${1:-5173}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim()  { printf '\033[2m%s\033[0m\n' "$1"; }

if ! ss -ltn "sport = :$PORT" 2>/dev/null | grep -q ":$PORT"; then
  bold "Nothing is listening on port $PORT."
  dim  "Start it first:  npm run dev     (then re-run this)"
  exit 1
fi

# Interface -> friendly label. ZeroTier devices are ztXXXXXXXXXX.
label_for() {
  case "$1" in
    zt*)               echo "ZeroTier  (works anywhere, phone must join the network)" ;;
    wl*|wlan*)         echo "Wi-Fi     (same network only; campus wifi often blocks this)" ;;
    en*|eth*)          echo "Ethernet  (same network only)" ;;
    *)                 echo "$1" ;;
  esac
}

primary=""
bold "Salutt dev server — port $PORT"
echo

while read -r iface addr; do
  ip="${addr%%/*}"
  url="http://$ip:$PORT"
  printf '  \033[1m%-28s\033[0m %s\n' "$url" "$(label_for "$iface")"
  # Prefer ZeroTier: it is the address that keeps working off this network.
  if [[ -z "$primary" || "$iface" == zt* ]]; then
    [[ -z "$primary" || "$iface" == zt* ]] && primary="$url"
  fi
done < <(ip -4 -o addr show scope global | awk '{print $2, $4}')

echo
printf '  \033[1m%-28s\033[0m %s\n' "http://localhost:$PORT" "USB       (run: adb reverse tcp:$PORT tcp:$PORT)"
echo

if command -v qrencode >/dev/null; then
  bold "Scan this on your phone  →  $primary"
  echo
  qrencode -t ANSIUTF8 -m 2 "$primary"
fi

cat <<EOF

$(bold 'Secure context')
Plain http:// gives you the UI and live reload, but NOT the camera (barcode
scanning), Web Bluetooth (the scale) or Add to Home Screen. To unlock those,
either:

  USB      adb reverse tcp:$PORT tcp:$PORT, then open http://localhost:$PORT
           on the phone. localhost counts as secure — no flags needed.

  Flag     chrome://flags/#unsafely-treat-insecure-origin-as-secure
           add  $primary  ->  Enabled  ->  relaunch Chrome.

$(dim "Data is stored per-origin. Whichever URL you install from owns your log,")
$(dim "so pick the permanent one before you start logging real meals.")
EOF

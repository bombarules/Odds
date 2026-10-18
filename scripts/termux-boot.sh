#!/data/data/com.termux/files/usr/bin/sh
# Start Pool with a public link whenever the phone boots.
# Needs the Termux:Boot add-on (open it once after installing). Run once:
#   sh scripts/termux-boot.sh
set -e
POOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HOME/.termux/boot" "$POOL_DIR/data"
cat > "$HOME/.termux/boot/start-pool" <<SCRIPT
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$POOL_DIR"
exec npm run share >> "$POOL_DIR/data/share.log" 2>&1
SCRIPT
chmod +x "$HOME/.termux/boot/start-pool"
echo "Done. After the next restart Pool starts by itself."
echo "To see the new link: cd $POOL_DIR && npm run link"

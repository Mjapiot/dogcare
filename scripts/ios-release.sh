#!/usr/bin/env bash
# Builds a signed App Store / TestFlight package of the iOS app.
#   scripts/ios-release.sh            → ios/App/build/export/App.ipa
#   scripts/ios-release.sh --upload   → also uploads to App Store Connect
#
# Why not a plain `xcodebuild archive`: automatic signing first needs a
# *development* profile, which requires a registered device. We archive
# unsigned, ad-hoc sign with the app's entitlements (push, universal links),
# then let Xcode re-sign for App Store distribution during export.
set -euo pipefail
cd "$(dirname "$0")/../ios/App"

BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
ARCHIVE=build/Dogcare.xcarchive
DESTINATION=export
[[ "${1:-}" == "--upload" ]] && DESTINATION=upload

(cd ../.. && env -u CAP_SERVER_URL npx cap sync ios >/dev/null)
grep -q '"url": "https://dogcare-gamma.vercel.app"' App/capacitor.config.json || {
  echo "capacitor.config.json does not point to production" >&2; exit 1; }

rm -rf "$ARCHIVE" build/export
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" CODE_SIGNING_ALLOWED=NO archive -quiet

APP="$ARCHIVE/Products/Applications/App.app"
for f in "$APP"/Frameworks/*; do codesign -f -s - "$f"; done
codesign -f -s - --entitlements App/App.entitlements "$APP"

cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>G2SC6845GS</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath build/export \
  -exportOptionsPlist build/ExportOptions.plist -allowProvisioningUpdates
echo "Build $BUILD_NUMBER done ($DESTINATION)."

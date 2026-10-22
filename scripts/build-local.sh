#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ARXIVPDFREADER_BUILD_APP:-${PAPERTRAIL_BUILD_APP:-$ROOT/ArxivPDFReader.app}}"
EXT="$APP/Contents/PlugIns/ArxivPDFReader Extension.appex"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$EXT/Contents/MacOS" "$EXT/Contents/Resources"
cp -R "$ROOT/extension/." "$EXT/Contents/Resources/"
xcrun clang -fobjc-arc -fmodules -fmodules-cache-path="${TMPDIR:-/tmp}/papertrail-clang-cache" -mmacosx-version-min=13.0 -framework Cocoa -framework SafariServices "$ROOT/native/Host.m" -o "$APP/Contents/MacOS/ArxivPDFReader"
xcrun clang -fobjc-arc -fmodules -fmodules-cache-path="${TMPDIR:-/tmp}/papertrail-clang-cache" -mmacosx-version-min=13.0 -fapplication-extension -framework Foundation -framework SafariServices -Wl,-e,_NSExtensionMain "$ROOT/native/Extension.m" -o "$EXT/Contents/MacOS/ArxivPDFReaderExtension"
python3 - "$APP" "$EXT" <<'PY'
import plistlib,sys
app,ext=sys.argv[1:]
common={'CFBundleInfoDictionaryVersion':'6.0','CFBundleShortVersionString':'0.3.13','CFBundleVersion':'18','CFBundleDevelopmentRegion':'en','CFBundleSupportedPlatforms':['MacOSX'],'LSMinimumSystemVersion':'13.0'}
for path,info in [(app,dict(CFBundleName='ArxivPDFReader',CFBundleDisplayName='ArxivPDFReader',CFBundleIdentifier='dev.papertrail.reader',CFBundleExecutable='ArxivPDFReader',CFBundlePackageType='APPL',NSPrincipalClass='NSApplication',NSHighResolutionCapable=True)),(ext,dict(CFBundleName='ArxivPDFReader Extension',CFBundleDisplayName='ArxivPDFReader',CFBundleIdentifier='dev.papertrail.reader.Extension',CFBundleExecutable='ArxivPDFReaderExtension',CFBundlePackageType='XPC!',NSExtension={'NSExtensionPointIdentifier':'com.apple.Safari.web-extension','NSExtensionPrincipalClass':'ArxivPDFReaderExtensionHandler'}))]:
 with open(path+'/Contents/Info.plist','wb') as f:plistlib.dump(common|info,f)
PY
xattr -cr "$APP"
codesign --force --sign - --entitlements "$ROOT/native/extension.entitlements" "$EXT"
codesign --force --sign - "$APP"
xattr -cr "$APP"
codesign --verify --deep --strict "$APP"
echo "Built local development app: $APP"

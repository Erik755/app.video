#!/bin/bash
# Build GuionViral APK locally
# Requirements: Java JDK 17+, Android SDK (build-tools, platforms, ndk)

set -e

echo "🔨 GuionViral APK Build Script"
echo "================================"

# Check Java
if ! command -v java &> /dev/null; then
    echo "❌ Java not found. Install Java 17+ (brew install openjdk@17 or apt install openjdk-17-jdk)"
    exit 1
fi

java_version=$(java -version 2>&1 | grep -oP 'version "\K[0-9.]+' | head -1)
echo "✓ Java found: $java_version"

cd "$(dirname "$0")"
frontend_dir="$PWD"

# Build APK
echo "📦 Building APK..."
cd android
./gradlew assembleRelease --build-cache -x bundleReleaseResources

echo ""
echo "✅ Build complete!"
apk_path="$frontend_dir/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$apk_path" ]; then
    echo "📱 APK location: $apk_path"
    echo "📊 Size: $(du -h "$apk_path" | cut -f1)"
else
    echo "⚠️  Debug APK (if release failed):"
    echo "  $frontend_dir/android/app/build/outputs/apk/debug/app-debug.apk"
fi

echo ""
echo "📲 To install on device:"
echo "  adb install -r \"$apk_path\""

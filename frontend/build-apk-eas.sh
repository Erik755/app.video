#!/bin/bash
# GuionViral APK Build via EAS (Cloud) - Simplest Approach

set -e

echo "🚀 GuionViral EAS Build Setup"
echo "=============================="
echo ""
echo "This builds your APK in the cloud (no local dependencies needed)"
echo ""

# Check if eas-cli is installed
if ! command -v eas &> /dev/null; then
    echo "📦 Installing EAS CLI..."
    npm install -g eas-cli
fi

cd "$(dirname "$0")/frontend"

echo ""
echo "📱 Logging in to Expo..."
echo "Note: You'll need a free Expo account (signup at expo.dev if needed)"
echo ""

if [ -n "$EXPO_TOKEN" ]; then
    echo "Using EXPO_TOKEN from environment (non-interactive)."
else
    echo "No EXPO_TOKEN found. Performing interactive eas login."
    eas login
fi

echo ""
echo "🔨 Starting APK build in the cloud..."
echo "This will take 5-15 minutes depending on queue"
echo ""

eas build --platform android --profile preview --non-interactive

echo ""
echo "✅ Build complete!"
echo "Check your Expo Dashboard for download link:"
echo "   https://expo.dev/accounts/[your-username]/projects/frontend/builds"
echo ""
echo "📲 You can also scan the QR code to install directly on device"

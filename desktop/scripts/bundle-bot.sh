#!/bin/bash
# Bundle bot source code for embedding in Tauri app

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$DESKTOP_DIR")"
RESOURCES_DIR="$DESKTOP_DIR/src-tauri/resources"

echo "📦 Bundling bot source code..."
echo "   Project root: $PROJECT_ROOT"
echo "   Resources dir: $RESOURCES_DIR"

# Create resources directory if it doesn't exist
mkdir -p "$RESOURCES_DIR"

# Create a temporary directory for staging
STAGING_DIR=$(mktemp -d)
BOT_STAGING="$STAGING_DIR/bot"
mkdir -p "$BOT_STAGING"

echo "📁 Copying bot files..."

# Copy essential files
cp "$PROJECT_ROOT/package.json" "$BOT_STAGING/"
cp "$PROJECT_ROOT/pnpm-lock.yaml" "$BOT_STAGING/"
cp "$PROJECT_ROOT/tsconfig.json" "$BOT_STAGING/"
cp "$PROJECT_ROOT/.env.example" "$BOT_STAGING/"

# Copy source directory
cp -r "$PROJECT_ROOT/src" "$BOT_STAGING/"

# Copy workers if exists (optional)
if [ -d "$PROJECT_ROOT/workers" ]; then
    cp -r "$PROJECT_ROOT/workers" "$BOT_STAGING/"
fi

echo "🗜️  Creating archive..."

# Create tar.gz archive
cd "$STAGING_DIR"
tar -czf "$RESOURCES_DIR/bot-bundle.tar.gz" bot

# Clean up
rm -rf "$STAGING_DIR"

# Get file size
SIZE=$(ls -lh "$RESOURCES_DIR/bot-bundle.tar.gz" | awk '{print $5}')
echo "✅ Bot bundle created: $RESOURCES_DIR/bot-bundle.tar.gz ($SIZE)"

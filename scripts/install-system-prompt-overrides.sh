#!/bin/bash
#
# System Prompt Override Installer
# 
# This script installs the system prompt override feature into an OpenClaw installation.
# It copies new files and verifies the installation compiles correctly.
#
# Usage:
#   ./install-system-prompt-overrides.sh [target-openclaw-path]
#
# If no path is provided, it installs to the current OpenClaw source directory.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory (this script's location in the source repo)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

# Target directory (default to source repo, or use provided path)
TARGET_REPO="${1:-$SOURCE_REPO}"

echo -e "${BLUE}=== System Prompt Override Installer ===${NC}"
echo ""
echo "Source: $SOURCE_REPO"
echo "Target: $TARGET_REPO"
echo ""

# Check if target exists
if [ ! -d "$TARGET_REPO" ]; then
    echo -e "${RED}Error: Target directory does not exist: $TARGET_REPO${NC}"
    exit 1
fi

# Check if target looks like an OpenClaw repo
if [ ! -d "$TARGET_REPO/src/agents" ]; then
    echo -e "${RED}Error: Target does not appear to be an OpenClaw repository${NC}"
    echo "Expected to find: $TARGET_REPO/src/agents"
    exit 1
fi

# Files to copy (new files only)
NEW_FILES=(
    "src/config/types.system-prompt.ts"
    "src/agents/system-prompt-override.ts"
)

# Files that need to be modified (for reference - these require manual merge)
MODIFIED_FILES=(
    "src/plugins/types.ts"
    "src/plugins/hooks.ts"
    "src/agents/pi-embedded-runner/run/attempt.ts"
    "src/agents/system-prompt.ts"
)

# Copy new files
echo -e "${BLUE}Copying new files...${NC}"
for file in "${NEW_FILES[@]}"; do
    target_path="$TARGET_REPO/$file"
    source_path="$SOURCE_REPO/$file"
    
    if [ -f "$source_path" ]; then
        mkdir -p "$(dirname "$target_path")"
        cp "$source_path" "$target_path"
        echo -e "  ${GREEN}✓${NC} Created: $file"
    else
        echo -e "  ${YELLOW}!${NC} Source file not found: $file"
    fi
done

echo ""
echo -e "${YELLOW}The following files need manual merging (changes from this feature):${NC}"
for file in "${MODIFIED_FILES[@]}"; do
    echo -e "  ${YELLOW}→${NC} $file"
done

echo ""
echo -e "${BLUE}To see the changes needed for these files, run:${NC}"
echo "  cd $SOURCE_REPO"
echo "  git diff HEAD -- ${MODIFIED_FILES[*]}"
echo ""

# Verify TypeScript compilation
echo -e "${BLUE}Verifying TypeScript compilation...${NC}"
cd "$TARGET_REPO"
if npx tsc --noEmit --skipLibCheck 2>&1 | grep -v "nodes-tool.test.ts" | grep -q "error"; then
    echo -e "${YELLOW}⚠ TypeScript has errors. You may need to apply the modifications manually.${NC}"
    echo ""
    echo "Common fixes needed:"
    echo "  1. Add the hook types to src/plugins/types.ts"
    echo "  2. Add the hook runner to src/plugins/hooks.ts"
    echo "  3. Add the override loading to src/agents/pi-embedded-runner/run/attempt.ts"
else
    echo -e "${GREEN}✓ TypeScript compiles successfully${NC}"
fi

echo ""
echo -e "${BLUE}=== Installation Summary ===${NC}"
echo ""
echo "New files created:"
for file in "${NEW_FILES[@]}"; do
    if [ -f "$TARGET_REPO/$file" ]; then
        echo -e "  ${GREEN}✓${NC} $file"
    fi
done

echo ""
echo "Next steps:"
echo "  1. Apply the modifications to the files listed above"
echo "  2. Run: npm run build"
echo "  3. Create SYSTEM_PROMPT_OVERRIDE.md in your workspace to customize"
echo "  4. Check .openclaw/system-prompt-log.txt to see the built prompt"
echo ""
echo -e "${GREEN}Done!${NC}"
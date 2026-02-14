#!/bin/bash
set -e

# Configuration
TRUENAS_USER="${TRUENAS_USER:-truenas_admin}"
TRUENAS_HOST="${TRUENAS_HOST:-your-truenas-ip}"
TRUENAS_PATH="/mnt/apps-pool/app_configs/carelink-bridge"

echo "=== CareLink Bridge TrueNAS Deployment Script ==="
echo ""

# Check if logindata.json exists locally
if [ ! -f "logindata.json" ]; then
    echo "❌ Error: logindata.json not found in current directory"
    echo "   Run 'npm run login' first to generate it"
    exit 1
fi

echo "✓ Found logindata.json locally"
echo ""

# Check if we can reach TrueNAS
echo "Testing connection to TrueNAS..."
if ! ssh -o ConnectTimeout=5 "${TRUENAS_USER}@${TRUENAS_HOST}" "echo 'Connected'" > /dev/null 2>&1; then
    echo "❌ Error: Cannot connect to TrueNAS at ${TRUENAS_USER}@${TRUENAS_HOST}"
    echo "   Set TRUENAS_USER and TRUENAS_HOST environment variables if needed"
    echo "   Example: TRUENAS_USER=admin TRUENAS_HOST=192.168.1.100 ./deploy-to-truenas.sh"
    exit 1
fi

echo "✓ Connected to TrueNAS"
echo ""

# Create directory structure on TrueNAS
echo "Creating directory structure on TrueNAS..."
ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "mkdir -p ${TRUENAS_PATH}" 2>/dev/null || \
    ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "sudo mkdir -p ${TRUENAS_PATH}"

# Set ownership so user can write to it
ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "sudo chown -R ${TRUENAS_USER}:${TRUENAS_USER} ${TRUENAS_PATH}"
echo "✓ Directory created: ${TRUENAS_PATH}"
echo ""

# Check if logindata.json exists and is a directory
echo "Checking for existing logindata.json..."
if ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "[ -e ${TRUENAS_PATH}/logindata.json ]"; then
    if ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "[ -d ${TRUENAS_PATH}/logindata.json ]"; then
        echo "⚠️  Found logindata.json as a directory (Docker created it)"
        echo "   Removing it..."
        ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "rm -rf ${TRUENAS_PATH}/logindata.json" 2>/dev/null || \
            ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "sudo rm -rf ${TRUENAS_PATH}/logindata.json"
        echo "✓ Removed directory"
    else
        echo "⚠️  Found existing logindata.json file"
        read -p "   Overwrite it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Deployment cancelled"
            exit 0
        fi
    fi
fi
echo ""

# Copy logindata.json
echo "Copying logindata.json to TrueNAS..."
scp logindata.json "${TRUENAS_USER}@${TRUENAS_HOST}:${TRUENAS_PATH}/"
echo "✓ File copied"
echo ""

# Verify it's a file
echo "Verifying file..."
FILE_TYPE=$(ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "ls -ld ${TRUENAS_PATH}/logindata.json | cut -c1")
if [ "$FILE_TYPE" = "-" ]; then
    echo "✓ logindata.json is a file (correct)"
else
    echo "❌ Error: logindata.json is not a file (type: $FILE_TYPE)"
    exit 1
fi
echo ""

# Copy docker-compose.yml if it doesn't exist
echo "Checking for docker-compose.yml..."
if ! ssh "${TRUENAS_USER}@${TRUENAS_HOST}" "[ -f ${TRUENAS_PATH}/docker-compose.yml ]"; then
    echo "   Copying docker-compose.truenas.yml..."
    scp docker-compose.truenas.yml "${TRUENAS_USER}@${TRUENAS_HOST}:${TRUENAS_PATH}/docker-compose.yml"
    echo "✓ docker-compose.yml copied"
    echo ""
    echo "⚠️  IMPORTANT: Edit docker-compose.yml on TrueNAS to set your credentials:"
    echo "   ssh ${TRUENAS_USER}@${TRUENAS_HOST}"
    echo "   cd ${TRUENAS_PATH}"
    echo "   nano docker-compose.yml"
    echo ""
    echo "   Update these values:"
    echo "   - CARELINK_USERNAME"
    echo "   - CARELINK_PASSWORD"
    echo "   - API_SECRET"
    echo "   - NS (Nightscout URL)"
    echo ""
else
    echo "✓ docker-compose.yml already exists"
    echo ""
fi

echo "=== Deployment Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit docker-compose.yml if you haven't already (see above)"
echo "2. Start the container:"
echo "   ssh ${TRUENAS_USER}@${TRUENAS_HOST}"
echo "   cd ${TRUENAS_PATH}"
echo "   docker-compose up -d"
echo "3. Check logs:"
echo "   docker-compose logs -f"

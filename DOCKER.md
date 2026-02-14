# Docker Deployment Guide

This guide explains how to run carelink-bridge in a Docker container on TrueNAS or any other Docker host.

## The Challenge: CAPTCHA Login

CareLink's login process may require solving a CAPTCHA, which needs a browser. However, once you've logged in successfully, the application stores **refresh tokens** in `logindata.json` that can be reused indefinitely without browser access.

## Solution: Two-Step Deployment

### Step 1: Initial Login on Your Mac (One-Time Setup)

1. **Run the login process locally** (where you have browser access):
   ```bash
   npm run login
   ```

2. **This creates `logindata.json`** containing your refresh tokens. The file looks like this:
   ```json
   {
     "access_token": "...",
     "refresh_token": "...",
     "scope": "openid profile offline_access",
     "client_id": "...",
     "token_url": "...",
     "audience": "..."
   }
   ```

3. **Keep this file safe** - you'll copy it to your container.

### Step 2: Deploy to TrueNAS/Docker

#### Option A: Using Docker Compose (Recommended)

1. **Copy your files to TrueNAS**:
   ```bash
   # On your Mac:
   rsync -av --progress \
     --exclude 'node_modules' \
     --exclude 'dist' \
     --exclude '.git' \
     --exclude 'test' \
     /Users/nraverdy/git/Perso/LeFrenchGuy/carelink-bridge/ \
     user@truenas-ip:/mnt/your-pool/apps/carelink-bridge/
   ```

2. **Build and run on TrueNAS**:
   ```bash
   cd /mnt/your-pool/apps/carelink-bridge
   docker-compose up -d
   ```

3. **Check logs**:
   ```bash
   docker-compose logs -f
   ```

#### Option B: Using Docker CLI

1. **Build the image**:
   ```bash
   docker build -t carelink-bridge .
   ```

2. **Run the container**:
   ```bash
   docker run -d \
     --name carelink-bridge \
     --restart unless-stopped \
     -v $(pwd)/logindata.json:/app/logindata.json \
     -v $(pwd)/.env:/app/.env:ro \
     carelink-bridge
   ```

3. **Check logs**:
   ```bash
   docker logs -f carelink-bridge
   ```

## How Token Refresh Works

The application automatically refreshes tokens using the `refresh_token` from `logindata.json`:

- The `logindata.json` file contains persistent refresh tokens
- The main application uses these tokens and refreshes them as needed
- **No browser required** after initial login

## Maintenance

### If Tokens Expire

If you see authentication errors in the logs:

1. **Delete `logindata.json`** on your Mac
2. **Run `npm run login`** again locally
3. **Copy the new `logindata.json`** to your TrueNAS container:
   ```bash
   scp logindata.json user@truenas-ip:/mnt/your-pool/apps/carelink-bridge/
   ```
4. **Restart the container**:
   ```bash
   docker-compose restart
   # or
   docker restart carelink-bridge
   ```

### Updating the Application

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build
```

## TrueNAS-Specific Notes

### Using TrueNAS Shell

TrueNAS SCALE includes Docker and Docker Compose by default:

1. Open **System → Shell** in TrueNAS web GUI
2. Navigate to your app directory
3. Run docker-compose commands as shown above

### File Permissions

Ensure the container can read/write `logindata.json`:
```bash
chmod 644 logindata.json
```

### Storage Location

Recommended path on TrueNAS:
```
/mnt/your-pool/apps/carelink-bridge/
```

Replace `your-pool` with your actual pool name.

## Security Considerations

- **`.env` contains sensitive credentials** - protect it appropriately
- **`logindata.json` contains auth tokens** - treat it like a password
- Consider using Docker secrets or TrueNAS encrypted datasets for sensitive files
- The container runs as the node user (non-root) for security

## Troubleshooting

### Container exits immediately
Check logs: `docker-compose logs` or `docker logs carelink-bridge`

### "No logindata.json found"
Ensure the volume mount is correct and the file exists:
```bash
ls -la /mnt/your-pool/apps/carelink-bridge/logindata.json
```

### Authentication errors
Tokens may have expired - re-run login on your Mac and copy the new `logindata.json`

### Network issues
Ensure the container has internet access to reach CareLink and Nightscout servers

### Permission denied errors
Fix file ownership:
```bash
chown -R 1000:1000 /mnt/your-pool/apps/carelink-bridge/
```

## Quick Start Summary

```bash
# On Mac: Initial login (one-time)
npm run login

# Transfer to TrueNAS
rsync -av --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  /Users/nraverdy/git/Perso/LeFrenchGuy/carelink-bridge/ \
  user@truenas-ip:/mnt/your-pool/apps/carelink-bridge/

# On TrueNAS: Deploy
cd /mnt/your-pool/apps/carelink-bridge
docker-compose up -d

# Check it's running
docker-compose logs -f
```

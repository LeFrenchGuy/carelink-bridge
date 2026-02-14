# TrueNAS Custom App Deployment Guide

This guide shows how to deploy carelink-bridge on TrueNAS SCALE using a private Docker image.

## Prerequisites

- TrueNAS SCALE installed
- Docker Hub account (for private image hosting)
- `logindata.json` file (generated from `npm run login` on a machine with browser access)

## Step 1: Build and Push Private Docker Image

On your Mac/PC:

```bash
cd /Users/nraverdy/git/Perso/LeFrenchGuy/carelink-bridge

# Login to Docker Hub
docker login

# Build the image (replace 'your-dockerhub-username' with your actual username)
docker build -t your-dockerhub-username/carelink-bridge:latest .

# Push to Docker Hub
docker push your-dockerhub-username/carelink-bridge:latest
```

### Make Repository Private

1. Go to https://hub.docker.com
2. Navigate to your repository: `your-dockerhub-username/carelink-bridge`
3. Go to **Settings** → **Make Private**

## Step 2: Prepare TrueNAS

### Create Directory Structure

SSH into TrueNAS and create the necessary directories:

```bash
ssh root@your-truenas-ip

# Create config directory
mkdir -p /mnt/apps-pool/app_configs/carelink-bridge

# Set permissions
chmod 755 /mnt/apps-pool/app_configs/carelink-bridge
```

### Transfer logindata.json

From your Mac:

```bash
# Copy logindata.json to TrueNAS
scp logindata.json root@your-truenas-ip:/mnt/apps-pool/app_configs/carelink-bridge/

# Verify it was copied
ssh root@your-truenas-ip "ls -la /mnt/apps-pool/app_configs/carelink-bridge/"
```

## Step 3: Deploy Using TrueNAS Custom App

### Option A: Using TrueNAS GUI (Recommended)

1. **Open TrueNAS Web Interface**
   - Navigate to **Apps** → **Discover Apps** → **Custom App**

2. **Configure Pull Image** (see screenshot)
   - **Image Name**: `your-dockerhub-username/carelink-bridge`
   - **Image Tag**: `latest`
   - **Username**: Your Docker Hub username
   - **Password**: Your Docker Hub password (or access token)
   - Click **Save**

3. **Configure Application**
   - **Application Name**: `carelink-bridge`
   - **Version**: `1.0.0`

4. **Container Configuration**
   - **Image Repository**: `your-dockerhub-username/carelink-bridge`
   - **Image Tag**: `latest`
   - **Restart Policy**: `unless-stopped`

5. **Environment Variables**
   Add these variables:
   ```
   NODE_ENV=production
   TZ=America/Toronto
   CARELINK_USERNAME=your-carelink-username
   CARELINK_PASSWORD=your-carelink-password
   API_SECRET=SuperSecret123
   NS=http://nightscout:1337
   ```
   
   Optional (uncomment if needed):
   ```
   MMCONNECT_SERVER=US
   CARELINK_INTERVAL=300
   ```

6. **Storage - Host Path Volumes**
   
   **Volume 1 (logindata.json):**
   - **Host Path**: `/mnt/apps-pool/app_configs/carelink-bridge/logindata.json`
   - **Mount Path**: `/app/logindata.json`
   - **Type**: File
   
   **Volume 2 (timezone - optional):**
   - **Host Path**: `/usr/share/zoneinfo`
   - **Mount Path**: `/usr/share/zoneinfo`
   - **Read Only**: ✓

7. **Networking**
   - **Network Mode**: Bridge (default)
   - No port mapping needed (communicates with Nightscout internally)

8. **Save and Deploy**

### Option B: Using docker-compose.yml in TrueNAS Shell

1. **Transfer the docker-compose file**:
   ```bash
   scp docker-compose.truenas.yml root@your-truenas-ip:/mnt/apps-pool/app_configs/carelink-bridge/docker-compose.yml
   ```

2. **Edit with your credentials**:
   ```bash
   ssh root@your-truenas-ip
   cd /mnt/apps-pool/app_configs/carelink-bridge
   nano docker-compose.yml
   ```
   
   Update:
   - `your-dockerhub-username/carelink-bridge:latest`
   - `CARELINK_USERNAME`
   - `CARELINK_PASSWORD`
   - `API_SECRET` (match your Nightscout secret)
   - `NS` URL

3. **Deploy**:
   ```bash
   docker-compose up -d
   ```

## Step 4: Integrate with Existing Nightscout

If you want to add carelink-bridge to your existing Nightscout docker-compose:

```yaml
version: '3'

services:
  mongo:
    container_name: mongo
    environment:
      MONGO_INITDB_DATABASE: nightscout
      MONGO_INITDB_ROOT_PASSWORD: myStrongPassword
      MONGO_INITDB_ROOT_USERNAME: admin
      TZ: America/Toronto
    image: mongo:6.0
    ports:
      - '27017:27017'
    restart: unless-stopped
    volumes:
      - /mnt/apps-pool/app_configs/mongo:/data/db
      - /usr/share/zoneinfo:/usr/share/zoneinfo:ro
      - /etc/timezone:/etc/timezone:ro
  
  nightscout:
    container_name: nightscout
    depends_on:
      - mongo
    environment:
      API_SECRET: SuperSecret123
      ENABLE: careportal basal iob cob pump sage
      INSECURE_USE_HTTP: 'true'
      MONGO_CONNECTION: mongodb://admin:myStrongPassword@mongo:27017/test?authSource=admin
      TZ: America/Toronto
    image: nightscout/cgm-remote-monitor:latest
    ports:
      - '1337:1337'
    restart: always
    volumes:
      - /usr/share/zoneinfo:/usr/share/zoneinfo:ro
      - /etc/timezone:/etc/timezone:ro
      - /mnt/apps-pool/app_configs/nightscout/uploads:/app/uploads
      - /mnt/apps-pool/app_configs/nightscout/logs:/app/logs
      - /mnt/apps-pool/app_configs/nightscout/custom:/app/custom
  
  carelink-bridge:
    container_name: carelink-bridge
    image: your-dockerhub-username/carelink-bridge:latest
    restart: unless-stopped
    depends_on:
      - nightscout
    environment:
      NODE_ENV: production
      TZ: America/Toronto
      CARELINK_USERNAME: your-carelink-username
      CARELINK_PASSWORD: your-carelink-password
      API_SECRET: SuperSecret123
      NS: http://nightscout:1337
      # MMCONNECT_SERVER: US  # Uncomment if in US
    volumes:
      - /mnt/apps-pool/app_configs/carelink-bridge/logindata.json:/app/logindata.json
      - /usr/share/zoneinfo:/usr/share/zoneinfo:ro
      - /etc/timezone:/etc/timezone:ro
```

## Step 5: Verify Deployment

### Check Container Status

```bash
# Via docker-compose
docker-compose ps

# Or via docker
docker ps | grep carelink-bridge
```

### View Logs

```bash
# Via docker-compose
docker-compose logs -f carelink-bridge

# Or via docker
docker logs -f carelink-bridge
```

### Expected Log Output

```
[Bridge] Starting — interval set to 300s
[Bridge] Fetching data now...
[Token] Refreshing access token...
[Token] Token refreshed successfully
```

## Troubleshooting

### Container Won't Start

**Check logs:**
```bash
docker logs carelink-bridge
```

**Common issues:**
- Missing `logindata.json` - Verify file exists at `/mnt/apps-pool/app_configs/carelink-bridge/logindata.json`
- Wrong permissions - Run `chmod 644 /mnt/apps-pool/app_configs/carelink-bridge/logindata.json`
- Invalid credentials - Check environment variables

### Authentication Errors

If you see "401 Unauthorized" or token errors:

1. **Regenerate logindata.json** on your Mac:
   ```bash
   rm logindata.json
   npm run login
   ```

2. **Copy new file to TrueNAS**:
   ```bash
   scp logindata.json root@your-truenas-ip:/mnt/apps-pool/app_configs/carelink-bridge/
   ```

3. **Restart container**:
   ```bash
   docker restart carelink-bridge
   ```

### Can't Pull Private Image

If TrueNAS can't pull your private image:

1. **Verify Docker Hub credentials** in the Custom App settings
2. **Use access token instead of password**:
   - Go to Docker Hub → Account Settings → Security → New Access Token
   - Use the token as the password in TrueNAS

### Data Not Appearing in Nightscout

1. **Check API_SECRET matches** between Nightscout and carelink-bridge
2. **Verify NS URL** - Use `http://nightscout:1337` (container name, not IP)
3. **Check Nightscout logs**:
   ```bash
   docker logs nightscout
   ```

## Maintenance

### Update the Image

```bash
# On your Mac: rebuild and push
docker build -t your-dockerhub-username/carelink-bridge:latest .
docker push your-dockerhub-username/carelink-bridge:latest

# On TrueNAS: pull and restart
docker pull your-dockerhub-username/carelink-bridge:latest
docker restart carelink-bridge
```

### Backup logindata.json

```bash
# From TrueNAS to your Mac
scp root@your-truenas-ip:/mnt/apps-pool/app_configs/carelink-bridge/logindata.json ./logindata.json.backup
```

## Security Notes

- ✅ **Private Docker image** - Your code is not publicly accessible
- ✅ **Credentials in environment** - Not hardcoded in the image
- ✅ **logindata.json** - Contains refresh tokens, treat like a password
- ⚠️ **Use Docker Hub access tokens** - More secure than using your password
- ⚠️ **Restrict TrueNAS access** - Ensure only authorized users can access the server

## Network Architecture

```
Internet
   ↓
CareLink API
   ↓
[carelink-bridge container]
   ↓
http://nightscout:1337 (internal Docker network)
   ↓
[nightscout container]
   ↓
[mongo container]
```

The containers communicate via Docker's internal network, so no external ports are needed for carelink-bridge.

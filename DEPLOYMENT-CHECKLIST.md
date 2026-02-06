# Bridge API Deployment Checklist

## ✅ Step-by-Step Deployment Guide

### 🔧 Step 1: Fix apt Lock & Install Docker

**Run these commands on your Debian VM:**

```bash
# Wait for automatic updates to finish OR kill the process
sudo killall apt apt-get
sudo rm /var/lib/dpkg/lock-frontend
sudo rm /var/lib/dpkg/lock
sudo dpkg --configure -a

# Install Docker (quick method)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker compose version
```

**Expected output:**
- Docker version 24.x or higher
- Docker Compose version v2.x or higher

---

### 📦 Step 2: Clone Repository

```bash
# Install git if needed
sudo apt install -y git

# Clone your repository
cd ~
git clone https://github.com/edgarallanglez/comerplasin-api.git bridge-api
cd bridge-api

# Verify files
ls -la
```

**Expected files:**
- `docker-compose.yml`
- `api/` directory
- `zerotier/` directory

---

### ⚙️ Step 3: Create Environment File

```bash
# Create .env file
nano .env
```

**Copy and paste this (update with your values):**

```env
# ZeroTier Configuration
ZT_NETWORK_ID=YOUR_ZEROTIER_NETWORK_ID_HERE

# API Configuration
API_PORT=3001
API_KEY=c0m3rpl4s1n

# Database Configuration
DB_SERVER=YOUR_SQL_SERVER_ZEROTIER_IP
DB_PORT=1433
DB_USER=YOUR_DB_USERNAME
DB_PASSWORD=YOUR_DB_PASSWORD
DB_NAME=YOUR_DATABASE_NAME
DB_ENCRYPT=false
```

**Save:** Press `Ctrl+X`, then `Y`, then `Enter`

**Verify:**
```bash
cat .env
```

---

### 🚀 Step 4: Build and Deploy

```bash
# Build Docker images
docker compose build

# Start services in background
docker compose up -d

# Check if containers are running
docker compose ps
```

**Expected output:**
```
NAME          IMAGE              STATUS
zt            bridge-api-zerotier   Up
bridge_api    bridge-api-api        Up
```

**View logs:**
```bash
# Watch all logs
docker compose logs -f

# Or specific service
docker compose logs -f api
```

---

### 🌐 Step 5: Configure ZeroTier

```bash
# Check ZeroTier status
docker exec zt zerotier-cli status

# List networks
docker exec zt zerotier-cli listnetworks
```

**Expected output:**
- Status: ONLINE
- Your network should be listed

**Authorize in ZeroTier Central:**
1. Go to https://my.zerotier.com
2. Click on your network
3. Scroll to "Members" section
4. Find the new device (container ID)
5. ✅ Check the "Auth" checkbox
6. Note the assigned IP address

**Test connectivity:**
```bash
# Replace with your SQL Server's ZeroTier IP
docker exec zt ping -c 4 YOUR_SQL_SERVER_IP
```

---

### 🧪 Step 6: Test API Endpoints

```bash
# Test ventas endpoint
curl -H "x-api-key: c0m3rpl4s1n" http://localhost:3001/ventas?year=2025

# Test cobranza endpoint
curl -H "x-api-key: c0m3rpl4s1n" http://localhost:3001/cobranza?year=2025
```

**Expected output:**
- JSON array with data from your database
- If you see `[]`, that's okay - it means no data for that filter

**If you get errors:**
```bash
# Check API logs
docker compose logs api

# Check database connection
docker exec bridge_api env | grep DB_
```

---

### 🔥 Step 7: Configure Firewall (Optional)

```bash
# Install UFW if not installed
sudo apt install -y ufw

# Allow SSH (IMPORTANT - do this first!)
sudo ufw allow 22/tcp

# Allow API port
sudo ufw allow 3001/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## 🛠️ Troubleshooting Commands

### View Logs
```bash
docker compose logs -f api
docker compose logs -f zerotier
```

### Restart Services
```bash
docker compose restart
```

### Stop Services
```bash
docker compose down
```

### Rebuild After Code Changes
```bash
git pull origin main
docker compose down
docker compose build
docker compose up -d
```

### Check Container Status
```bash
docker compose ps
docker stats
```

### Test Database Connection
```bash
# From inside the API container
docker exec -it bridge_api sh
# Then try to connect or check env vars
env | grep DB_
exit
```

---

## 📊 Verification Checklist

- [ ] Docker installed and running
- [ ] Repository cloned successfully
- [ ] .env file created with correct values
- [ ] Containers built without errors
- [ ] Both containers (zt and bridge_api) are running
- [ ] ZeroTier shows ONLINE status
- [ ] ZeroTier network authorized in Central
- [ ] Can ping SQL Server from container
- [ ] API responds to /ventas endpoint
- [ ] API responds to /cobranza endpoint
- [ ] Firewall configured (if needed)

---

## 🎯 Quick Reference

### Your API URLs (from VM)
```
http://localhost:3001/ventas?year=2025
http://localhost:3001/cobranza?year=2025
```

### Your API URLs (from external - if firewall open)
```
http://YOUR_VM_IP:3001/ventas?year=2025
http://YOUR_VM_IP:3001/cobranza?year=2025
```

### Required Header
```
x-api-key: c0m3rpl4s1n
```

---

## 🔄 Update Workflow

When you push changes to GitHub:

```bash
# On your VM
cd ~/bridge-api
git pull origin main
docker compose build
docker compose up -d
```

---

## 📞 Need Help?

If something doesn't work:

1. **Check logs:** `docker compose logs -f`
2. **Verify .env:** `cat .env`
3. **Check ZeroTier:** `docker exec zt zerotier-cli listnetworks`
4. **Test connectivity:** `docker exec zt ping YOUR_SQL_SERVER_IP`
5. **Restart:** `docker compose restart`

Share the error messages and I'll help troubleshoot!

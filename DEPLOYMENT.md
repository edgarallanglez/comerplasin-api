# Bridge API Deployment Guide - Debian 12

## Prerequisites
- Debian 12 VM instance with SSH access
- Root or sudo privileges
- ZeroTier Network ID
- SQL Server accessible via ZeroTier network

## Step 1: Initial Server Setup

### Connect to your VM
```bash
ssh user@your-vm-ip
```

### Update system packages
```bash
sudo apt update && sudo apt upgrade -y
```

### Install required dependencies
```bash
# Install Docker
sudo apt install -y apt-transport-https ca-certificates curl gnupg lsb-release

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify Docker installation
sudo docker --version
sudo docker compose version
```

### Add your user to docker group (optional, to run docker without sudo)
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Install Git
```bash
sudo apt install -y git
```

## Step 2: Clone Your Repository

```bash
cd ~
git clone https://github.com/edgarallanglez/comerplasin-api.git bridge-api
cd bridge-api
```

## Step 3: Configure Environment Variables

Create a `.env` file with your configuration:

```bash
nano .env
```

Add the following content (replace with your actual values):

```env
# ZeroTier Configuration
ZT_NETWORK_ID=your_zerotier_network_id

# API Configuration
API_PORT=3001
API_KEY=c0m3rpl4s1n

# Database Configuration
DB_SERVER=your_sql_server_ip_in_zerotier
DB_PORT=1433
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_database_name
DB_ENCRYPT=false
```

Save and exit (Ctrl+X, then Y, then Enter)

## Step 4: Build and Start Services

### Build the Docker images
```bash
docker compose build
```

### Start the services
```bash
docker compose up -d
```

### Check if containers are running
```bash
docker compose ps
```

You should see both `zt` and `bridge_api` containers running.

## Step 5: Verify ZeroTier Connection

### Check ZeroTier status
```bash
docker exec zt zerotier-cli status
```

### List joined networks
```bash
docker exec zt zerotier-cli listnetworks
```

### Authorize the node in ZeroTier Central
1. Go to https://my.zerotier.com
2. Navigate to your network
3. Find the new node (it will show the container's ID)
4. Check the "Auth" checkbox to authorize it

### Verify network connectivity
```bash
# Check if you can reach your SQL Server
docker exec zt ping -c 4 your_sql_server_ip
```

## Step 6: Test the API

### Test from within the VM
```bash
curl -H "x-api-key: c0m3rpl4s1n" http://localhost:3001/ventas?year=2025
```

### Test cobranza endpoint
```bash
curl -H "x-api-key: c0m3rpl4s1n" http://localhost:3001/cobranza?year=2025
```

## Step 7: Configure Firewall (if needed)

### Allow API port through firewall
```bash
sudo ufw allow 3001/tcp
sudo ufw status
```

## Step 8: Set Up Systemd Service (Optional - for auto-start)

If you want the services to start automatically on boot:

```bash
sudo nano /etc/systemd/system/bridge-api.service
```

Add this content:

```ini
[Unit]
Description=Bridge API Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/your_user/bridge-api
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable bridge-api.service
sudo systemctl start bridge-api.service
```

## Useful Commands

### View logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f zerotier
```

### Restart services
```bash
docker compose restart
```

### Stop services
```bash
docker compose down
```

### Update code and restart
```bash
git pull origin main
docker compose build
docker compose up -d
```

### Check container resource usage
```bash
docker stats
```

## Troubleshooting

### API not responding
```bash
# Check if containers are running
docker compose ps

# Check API logs
docker compose logs api

# Check if port is listening
sudo netstat -tlnp | grep 3001
```

### Database connection issues
```bash
# Check ZeroTier connection
docker exec zt zerotier-cli listnetworks

# Test SQL Server connectivity
docker exec zt ping your_sql_server_ip

# Check API environment variables
docker exec bridge_api env | grep DB_
```

### ZeroTier not connecting
```bash
# Restart ZeroTier container
docker compose restart zerotier

# Check ZeroTier logs
docker compose logs zerotier

# Verify network ID
docker exec zt zerotier-cli listnetworks
```

## Security Recommendations

1. **Change the default API key** in your `.env` file
2. **Use a firewall** to restrict access to port 3001
3. **Keep Docker updated**: `sudo apt update && sudo apt upgrade docker-ce`
4. **Monitor logs regularly**: `docker compose logs -f`
5. **Use HTTPS** with a reverse proxy (Nginx/Caddy) for production
6. **Backup your .env file** securely

## Optional: Set Up Nginx Reverse Proxy with SSL

If you want to expose the API via HTTPS:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Configure Nginx
sudo nano /etc/nginx/sites-available/bridge-api
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable the site and get SSL certificate:

```bash
sudo ln -s /etc/nginx/sites-available/bridge-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d your-domain.com
```

## Monitoring Setup (Optional)

Install monitoring tools:

```bash
# Install htop for system monitoring
sudo apt install -y htop

# Install docker-compose-monitor
docker run -d --name dockprom \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 9090:9090 \
  stefanprodan/dockprom
```

## API Endpoints

- `GET /ventas?year=YYYY&month=MM` - Get sales data
- `GET /cobranza?year=YYYY&month=MM` - Get collections data

All endpoints require the `x-api-key` header.

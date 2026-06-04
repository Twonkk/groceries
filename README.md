# Grocery Helper

A small shared grocery and household list for your home network.

## Unraid / Docker

The app is ready to run on an Unraid server. The important settings are:

- Repository: `ghcr.io/twonkk/groceries:latest`
- Container port: `4827`
- Host port: `4827`
- Persistent data path: `/mnt/user/appdata/grocery-helper:/app/data`
- Public URL: `http://10.31.10.10:4827`

The QR code will use:

```text
http://10.31.10.10:4827
```

That `PUBLIC_URL` value is what the QR code will use.

## GHCR Publishing

This repo includes a GitHub Actions workflow at:

```text
.github/workflows/docker-publish.yml
```

When changes are pushed to `main` or `master`, GitHub Actions builds and publishes:

```text
ghcr.io/twonkk/groceries:latest
```

It also publishes branch, tag, and SHA tags.

### What GitHub Needs

Create or grant access to:

```text
twonkk/groceries
```

Then push the contents of this `grocery-helper` folder as the repo root, so `Dockerfile` and `.github/workflows/docker-publish.yml` are at the top level.

In the repo settings, make sure Actions can write packages:

```text
Settings -> Actions -> General -> Workflow permissions -> Read and write permissions
```

For easiest Unraid pulls, make the GHCR package public after the first successful publish. If you keep it private, Unraid will need a Docker login/token for `ghcr.io`.

### Docker Compose

The included `docker-compose.yml` uses:

```yaml
image: ghcr.io/twonkk/groceries:latest
```

It also already sets:

```yaml
PUBLIC_URL: "http://10.31.10.10:4827"
```

Then run:

```bash
docker compose up -d
```

### Unraid Add Container

In Unraid, add a container with:

```text
Repository: ghcr.io/twonkk/groceries:latest
Network Type: Bridge
WebUI: http://[IP]:[PORT:4827]/
Port: 4827 TCP -> 4827
Path: /app/data -> /mnt/user/appdata/grocery-helper
Variable: PUBLIC_URL -> http://10.31.10.10:4827
Variable: DATA_DIR -> /app/data
```

An `unraid-template.xml` file is also included if you want to adapt it as a custom template.

## Start It

Open PowerShell in this folder and run:

```powershell
.\start-grocery-helper.ps1
```

Then open the URL shown in the window. The app usually runs at:

```text
http://localhost:4827/
```

## QR Setup

Open the app, press `QR`, and use the URL shown there. Phones need to be on the same Wi-Fi as the server running the app.

## Data

The list is saved in:

```text
data\items.json
```

In Docker, the list is saved through the mounted volume:

```text
/mnt/user/appdata/grocery-helper/items.json
```

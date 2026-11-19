# Docker

Run 3D Maker Suite in a container. Use this on a home server or NAS that is always on. You need Docker with Compose. You don't need Node, pnpm or Git.

## Who can use it

Anyone with Docker on a 64-bit Intel or AMD (x64) machine. The published image does not run on ARM processors yet, see [Which processors work](#which-processors-work).

## Before you start

- Docker with Compose installed (`docker compose version` prints a version).
- The address of the machine that runs Docker, for example `192.168.1.20` or `nas.local`.
- The folders with your 3D files, if you want projects. You mount them into the container below.

## The compose file

Save this as `docker-compose.yml` on the server:

```yaml
services:
  app:
    image: ghcr.io/emanuelmoniz/3d-maker-suite:latest
    restart: unless-stopped
    ports:
      - "4300:4300"
    environment:
      HOST: 0.0.0.0
    volumes:
      - app-data:/data
      # - /path/to/your/3d-files:/projects/files
volumes:
  app-data:
```

| Line | What it does |
|---|---|
| `image` | The image to run. See [Image tags](#image-tags). To build the image yourself, copy the repository and replace this line with `build: .` |
| `restart: unless-stopped` | Starts the app again after a crash or a server reboot. **Restart server** in the app relies on it |
| `ports: "4300:4300"` | The left number is the port on your server, the right one is inside the container. Change only the left one |
| `HOST: 0.0.0.0` | Makes the app answer on the container's network. The image already sets it |
| `app-data:/data` | A Docker volume that keeps your data. See [Where your data is](#where-your-data-is) |

## Start it

1. Open a terminal next to the file and run:

```bash
docker compose up -d
```

2. Wait about half a minute. The first start applies the database migrations. Check that it is healthy:

```bash
docker compose ps
```

3. Show the log. Until the first account exists, it prints a **setup token**:

```bash
docker compose logs app
```

4. Create the first admin. Open <http://localhost:4300> **on the server itself**. The setup page opens directly, with no token.

To open the app from another device, tell it that address first. Add it under `environment:`, with the address you type in the browser, and run `docker compose up -d` again:

```yaml
    environment:
      HOST: 0.0.0.0
      APP_ALLOWED_HOSTS: 192.168.1.20
```

Then open `http://192.168.1.20:4300` from the other device and enter the setup token from the log. Use a bare name or IP only: no `http://`, no port, no path. Separate several with commas.

Without this, other devices get `403 forbidden_host` until the first admin exists. Once an account exists, any address works.

## Image tags

Images are published at `ghcr.io/emanuelmoniz/3d-maker-suite`.

| Tag | Gets you |
|---|---|
| `latest` | The newest stable release |
| `X.Y.Z`, for example `6.1.0` | That exact release. Use it to stay on a version |
| `dev` | The newest pre-release, for testers |
| `X.Y.Z-alpha.N` | One exact pre-release |
| `latest-slicer`, `X.Y.Z-slicer`, `dev-slicer` | The same app with the libraries a server slicer needs. See [Slicing in Docker](#slicing-in-docker) |

## Where your data is

Everything the app saves is in the `/data` folder of the container, which is the `app-data` volume:

| What | File or folder |
|---|---|
| Database | `app.sqlite` |
| Key that protects saved logins | `secret.key` |
| Backups | `backups/` |
| Slicers you install from the app | `slicers/` |

Back up this volume. Anyone who holds `secret.key` and the database can read your saved logins, so keep copies private.

To keep the data in a normal folder of the server instead, replace the volume line with a path, for example `- /volume1/docker/3d-maker-suite:/data`. The container runs as `root`, so it can write to a folder you create yourself.

## Project folders

The container only sees what you mount. Mount each folder of 3D files, then add the path **inside the container** in **Settings → Projects**:

```yaml
    volumes:
      - app-data:/data
      - /volume1/3d-files:/projects/files
```

In the app, add `/projects/files` as a project folder. The path on your server (`/volume1/3d-files`) means nothing to the app.

- A plain mount lets the app browse, upload, delete, move and create folders.
- Add `:ro` (`/volume1/3d-downloads:/projects/downloads:ro`) to make a folder read only. The app can show its projects, but uploading, deleting, moving and creating folders fails.
- The app scans folders when it starts, and watches them while it runs. Network shares (SMB, NFS) often send no change events. After changing files there, use **Scan folders** on the Projects page.
- A folder that is missing, such as an unmounted share, is reported and skipped. Its projects stay in the app.

## Updating

1. Make a backup. Updates apply database migrations, and a migration only goes forward.
2. In the folder with your compose file, run:

```bash
docker compose pull
docker compose up -d
```

**Settings → About & updates** shows the same two commands when a new version is out. It has no **Update** button in Docker, because the container can't replace its own image.

To go back, set the image to the older tag (for example `:6.1.0`), run `docker compose up -d`, and restore the backup you made before updating. The database has moved forward, so an older version may not open it as it is. A backup made by a newer version can't be restored into an older one.

## Slicing in Docker

The default image has no slicer libraries, so it stays small. To slice projects on the server:

1. Change the image to the slicer image, about 800 MB larger:

```yaml
    image: ghcr.io/emanuelmoniz/3d-maker-suite:latest-slicer
```

2. Run `docker compose up -d`.
3. In **Settings → Integrations**, add **Bambu Studio** or **OrcaSlicer** with **This server** under **Where**, then press **Install slicer** on its row.

The slicer is downloaded into the `app-data` volume once, so it survives image updates. No display is needed. Only x64 is supported, because Bambu Lab has no Linux ARM build.

Your own slicer presets live on your PC, not in the container. Upload them as a zip instead, or mount the slicer's config folder into the container.

## What doesn't work in Docker

| Feature | Why | What to do |
|---|---|---|
| Slicing | The default image has no slicer | Use the `-slicer` image, or slice on your PC |
| Live folder watching on network shares | Change events don't arrive over SMB or NFS | Use **Scan folders** |
| **Start at login** | The container starts with Docker | Use `restart: unless-stopped` |
| The app's own **Update** button | The container can't replace its image | Pull the new image |
| Network addresses in **This server** | The container sees its own addresses, not the server's | Use the address of the server |
| Changing the port in **Settings → Network** | Docker decides the port that is reachable | Change the left number of `ports:` |

## Which processors work

The published image is built for x64 only. A Raspberry Pi, an ARM NAS and other ARM machines can't pull it. Apple silicon runs it through emulation.

Building the image on an ARM machine with `build: .` is not tested. To run on ARM, use the [source install](Install-from-Source.md) with Node 22.

## Reset a password

If the only admin forgot their password, run this in the folder with your compose file. It prints a new password once:

```bash
docker compose exec app pnpm user:reset-password you@example.com
```

## Problems and fixes

- **`403 forbidden_host` from another device.** The app only answers to addresses it knows until the first admin exists. Add the address with `APP_ALLOWED_HOSTS`, as shown in [Start it](#start-it).
- **The port is already in use.** Change the left number in `ports:`, for example `"4400:4300"`, and run `docker compose up -d`.
- **The container keeps restarting.** Run `docker compose logs app` and read the last lines.
- **The slicer says it can't start.** Check that the image is a `-slicer` one.
- **A project folder looks empty.** Add the path inside the container, such as `/projects/files`, not the path on the server.
- **A restored backup shows missing project files.** Backups don't hold your project files. Mount the folders again and use **Change project folder…**.

## Related pages

- [Choose how to run](Choose-How-to-Run.md)
- [NAS](NAS.md)
- [Server and remote access](Server-and-Remote-Access.md)

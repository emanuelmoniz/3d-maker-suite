# Docker

Run 3D Maker Suite in a container. Use this on a home server or NAS that is always on. You need Docker with Compose. You don't need Node, pnpm or Git.

## Who can use it

Anyone with Docker on a 64-bit machine: Intel or AMD (x64), or ARM64 such as a Raspberry Pi 4 or 5 or an ARM NAS. An ARM server can't slice, see [Which processors work](#which-processors-work).

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
      # PUID: 1000
      # PGID: 1000
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
| `PUID`, `PGID` | Optional. The user and group the app runs as, so the files it makes belong to you and not to `root`. See [Folder permissions](#folder-permissions) |
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

4. Create the first admin, see [First run](First-Run.md). Open <http://localhost:4300> **on the server itself**. The setup page opens directly, with no token.

To open the app from another device, tell it that address first. Add it under `environment:`, with the address you type in the browser, and run `docker compose up -d` again:

```yaml
    environment:
      HOST: 0.0.0.0
      APP_ALLOWED_HOSTS: 192.168.1.20
```

Then open `http://192.168.1.20:4300` from the other device and enter the setup token from the log. Use a bare name or IP only: no `http://`, no port, no path. Separate several with commas.

Without this, other devices get `403 forbidden_host` until the first admin exists. Once an account exists, any address works.

## Image tags

Images are published at `ghcr.io/emanuelmoniz/3d-maker-suite`, for x64 and ARM64 under the same tag: `docker pull` picks the one for your machine. The connector has its own image, see [the connector in Docker](Connector-Setup.md#docker-a-nas-or-a-server).

| Tag | Gets you |
|---|---|
| `latest` | The newest stable release |
| `X.Y.Z`, for example `6.1.0` | That exact release. Use it to stay on a version |
| `dev` | The newest pre-release, for testers |
| `X.Y.Z-alpha.N` | One exact pre-release |
| `latest-slicer`, `X.Y.Z-slicer`, `dev-slicer` | The same app with the libraries a server slicer needs, for x64 only. See [Slicing in Docker](#slicing-in-docker) |

## Where your data is

Everything the app saves is in the `/data` folder of the container, which is the `app-data` volume:

| What | File or folder |
|---|---|
| Database | `app.sqlite` |
| Key that protects saved logins | `secret.key` |
| Backups | `backups/` |
| Slicers you install from the app | `slicers/` |

Back up this volume. Anyone who holds `secret.key` and the database can read your saved logins, so keep copies private.

To keep the data in a normal folder of the server instead, replace the volume line with a path, for example `- /volume1/docker/3d-maker-suite:/data`. The container runs as `root` unless you set `PUID` and `PGID`, see [Folder permissions](#folder-permissions). Either way it can write to a folder you create yourself, as long as that user may.

## Project folders

The container only sees what you mount. Mount each folder of 3D files, then add the path **inside the container** in **Projects settings** (the gear on **Projects**):

```yaml
    volumes:
      - app-data:/data
      - /volume1/3d-files:/projects/files
```

In the app, add `/projects/files` as a project folder. The path on your server (`/volume1/3d-files`) means nothing to the app.

- A plain mount lets the app browse, upload, delete, move and create folders.
- Add `:ro` (`/volume1/3d-downloads:/projects/downloads:ro`) to make a folder read only. The app can show its projects, but uploading, deleting, moving and creating folders fails.
- The app scans folders when it starts, and watches them while it runs. A share that the server itself mounts from somewhere else (SMB, NFS) sends no change events, see [Network shares and live updates](Project-Folders.md#network-shares-and-live-updates).
- A folder that is missing, such as an unmounted share, is reported and skipped. Its projects stay in the app.

### Folder permissions

By default the image runs the app as `root`. It can read every folder you mount, and write to it unless you add `:ro`. The files and folders it creates in a mounted folder then belong to `root` on the server. This happens when you upload a file, create a project folder or move a project.

To have them belong to you, tell the app which user to run as:

1. Find your numbers. Over SSH, run `id`: `uid` is your `PUID` and `gid` is your `PGID`. On a NAS the user's page often shows them too.
2. Add them under `environment:` and run `docker compose up -d` again:

```yaml
    environment:
      HOST: 0.0.0.0
      PUID: 1000
      PGID: 1000
```

3. Make sure that user may write to each folder you mount. The app can't write where that user can't.

What happens at the start:

- The app's own `/data` folder is given to that user, once. The next starts change nothing, so they stay fast.
- Your mounted project folders are never changed, only what the app creates in them from then on.
- Without `PUID` and `PGID` nothing changes: the app runs as `root`, as in earlier versions. An existing install keeps working.
- Set only one of the two and the other takes the same number.
- A slicer you installed from the app keeps working: it lives in `/data/slicers`.
- To run the app as a user in a data folder you made yourself, you can instead use `user: "1000:1000"` in the compose file. Then you give that user the folder yourself.

## On a NAS

A NAS is on all day, so the app is always there for your phone and other computers. If your NAS has Docker, this page is all you need, with an Intel or AMD (x64) processor or an ARM one. With no Docker, see [Install from source](Install-from-Source.md#on-a-nas-or-a-machine-with-no-desktop).

1. Open your NAS's Docker app. Synology Container Manager and QNAP Container Station can both run a Compose file as a project. Or use SSH and the command line.
2. Create a folder for the app on a normal NAS volume, for example `/volume1/docker/3d-maker-suite`.
3. Save the [compose file](#the-compose-file) there.
4. Use a normal NAS folder for the app's data instead of a Docker volume. Replace `app-data:/data` with `/volume1/docker/3d-maker-suite/data:/data`, and delete the `volumes:` block at the bottom of the file. A normal folder is easy to include in the NAS's own backups and snapshots. See [Where your data is](#where-your-data-is).
5. Mount your 3D files folder, for example `/volume1/3d-files:/projects/files`, see [Project folders](#project-folders).
6. Start it as shown in [Start it](#start-it), create the first admin and add `/projects/files` in **Projects settings** (the gear on **Projects**).

Keep the data folder on the NAS's own disk, never on a share the NAS mounts from somewhere else. A NAS firewall must allow port 4300 for your home network only, see [Use from another device](Use-From-Another-Device.md#allow-the-port-in-the-firewall). A NAS can also join a hub that runs elsewhere, to keep project files for it and reach the printers on its network. It runs the connector's image for that, see [the connector in Docker](Connector-Setup.md#docker-a-nas-or-a-server). A hub that runs on the NAS itself reads the NAS folders you mount into it as above, and needs no connector.

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

The slicer is downloaded into the `app-data` volume once, so it survives image updates. No display is needed. Only x64 is supported, because Bambu Lab has no Linux ARM build, so there is no `-slicer` image for ARM.

Your own slicer presets live on your PC, not in the container. Upload them as a zip instead, or mount the slicer's config folder into the container.

## What doesn't work in Docker

| Feature | Why | What to do |
|---|---|---|
| Slicing | The default image has no slicer | Use the `-slicer` image, or slice on your PC |
| Slicing on an ARM server | The slicers have no Linux ARM build | Slice on an x64 computer or a Mac that is a slice worker, see [Hub setup](Hub-Setup.md) |
| Live folder watching on network shares | Change events don't arrive over SMB or NFS | Use **Scan folders**, see [Network shares and live updates](Project-Folders.md#network-shares-and-live-updates) |
| **Start at login** | The container starts with Docker | Use `restart: unless-stopped` |
| The app's own **Update** button | The container can't replace its image | Pull the new image |
| Network addresses in **This server** | The container sees its own addresses, not the server's | Use the address of the server |
| Changing the port in **Settings → Network** | Docker decides the port that is reachable | Change the left number of `ports:` |

## Which processors work

The app image is published for x64 (Intel and AMD) and for ARM64 (a Raspberry Pi 4 or 5, an ARM NAS, Apple silicon). `docker pull` takes the right one by itself. If you don't know your NAS's processor, look in its system information or look up its model.

Slicing needs x64, because Bambu Lab has no Linux ARM slicer. On an ARM server, **This server** under **Where** is greyed out for Bambu Studio and OrcaSlicer, with the reason, and the app refuses to install one there. Another computer does the slicing, an x64 one or a Mac, through a hub, see [Hub setup](Hub-Setup.md). The `-slicer` image is for x64 only.

## Reset a password

If the only admin forgot their password, run this in the folder with your compose file. It prints a new password once:

```bash
docker compose exec app pnpm user:reset-password you@example.com
```

## Problems and fixes

- **`403 forbidden_host` from another device.** The app only answers to addresses it knows until the first admin exists. Add the address with `APP_ALLOWED_HOSTS`, as shown in [Start it](#start-it).
- **The image says `no matching manifest`.** You asked for a `-slicer` tag on an ARM machine. Those are x64 only: use the tag without `-slicer`.
- **The app can't write to a mounted folder, or `/data` is refused.** The user from `PUID` and `PGID` may not write there. Give that user the folder, or leave the two out to run as `root`, see [Folder permissions](#folder-permissions).
- **The port is already in use.** Change the left number in `ports:`, for example `"4400:4300"`, and run `docker compose up -d`.
- **The container keeps restarting.** Run `docker compose logs app` and read the last lines.
- **The slicer says it can't start.** Check that the image is a `-slicer` one.
- **A project folder looks empty.** Add the path inside the container, such as `/projects/files`, not the path on the server.
- **A restored backup shows missing project files.** Backups don't hold your project files. Mount the folders again and use **Change project folder…**.

## Related pages

- [Choose how to run](Choose-How-to-Run.md)
- [First run](First-Run.md)
- [Install from source](Install-from-Source.md)
- [Project folders](Project-Folders.md)
- [Public access](Public-Access.md)

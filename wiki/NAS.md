# NAS

A NAS is on all day, so the app is always there for your phone and other computers. This page covers running 3D Maker Suite on a NAS with Docker, and without it.

## Who can use it

Anyone with a NAS that has either of these:

- Docker with Compose, on an Intel or AMD (x64) processor. This is the easy way.
- Node 22, on any processor Node runs on. This is the way for ARM NAS devices.

## Before you start

Find out which processor your NAS has. It decides what works. Look in the NAS's system information, or look up its model.

| Processor | Docker image | Without Docker | Slicing on the NAS |
|---|---|---|---|
| Intel or AMD (x64) | Works | Works | Works, with the `-slicer` image |
| ARM (Raspberry Pi, many low-cost NAS models) | Not published yet | Needs Node 22. Not tested by us | Not available |

Slicing needs an x64 machine, because Bambu Lab has no Linux ARM slicer. On an ARM NAS the slicing is done by another computer through a hub, see [Choose how to run](Choose-How-to-Run.md).

## Run it with Docker

1. Open your NAS's Docker app. Synology Container Manager and QNAP Container Station can both run a Compose file as a project. Or use SSH and the command line.
2. Create a folder for the app on a normal NAS volume, for example `/volume1/docker/3d-maker-suite`.
3. Save the compose file from the [Docker](Docker.md) page there, and start it.
4. Use a normal NAS folder for the app's data instead of a Docker volume. Replace `app-data:/data` with `/volume1/docker/3d-maker-suite/data:/data`, and delete the `volumes:` block at the bottom of the file. A normal folder is easy to include in the NAS's own backups and snapshots.
5. Mount your 3D files folder, for example `/volume1/3d-files:/projects/files`.
6. Start it, create the first admin and add `/projects/files` in **Settings → Projects**. The [Docker](Docker.md) page shows every step.

## Run it without Docker

Use this when the NAS has Node 22 but no Docker, or has an ARM processor.

1. Install Node 22 on the NAS, with the NAS's own package tool or from <https://nodejs.org>. `node -v` must print `v22.x`.
2. Follow [Install from source](Install-from-Source.md) on the NAS. That page needs Git and a terminal over SSH.
3. Start the app so other devices can reach it:

```bash
HOST=0.0.0.0 APP_ALLOWED_HOSTS=192.168.1.20 pnpm start
```

Use your NAS's own address in `APP_ALLOWED_HOSTS`. It is needed until the first admin exists, and takes a bare name or IP only.

4. Make the app start by itself when the NAS boots. The NAS's task scheduler can run `pnpm start` in the app's folder at boot.

`pnpm start` restarts itself after an update, so **Update** in **Settings → About & updates** works. It only works for a copy with no local changes.

## Folder permissions

- The Docker image runs the app as `root`. It can read every folder you mount, and write to it unless you add `:ro`.
- Files and folders that the app creates in a mounted folder belong to `root` on the NAS. This happens when you upload a file, create a project folder or move a project.
- Without Docker, the app runs as the user who starts it and has that user's access.
- Add `:ro` to a folder you want the app to read only. Uploading, deleting, moving and creating folders then fails.

## Network shares and live updates

- The app watches mounted folders for changes. That works on the NAS's own disks.
- It doesn't work on a share the NAS itself mounts from somewhere else (SMB, NFS). Use **Scan folders** on the Projects page after changing files there.
- Keep the app's own data folder (`/data`) on the NAS's own disk, never on a mounted network share. The database does not work reliably over a network file system.

## Connectors and a NAS

A connector is the small program a computer runs to join a hub. It is built for desktop computers: Windows, macOS, and Linux x64 with an application menu. Its pairing page opens in a browser on the same computer.

That means a connector can't be set up on a NAS today. Run the hub on the NAS in Docker and mount the NAS folders into it as hub folders instead. The hub then reads those folders directly.

## Limits and tips

- Docker's `restart: unless-stopped` starts the app after a NAS reboot.
- Back up before you update. A migration only goes forward.
- Other devices reach the app at `http://<nas-address>:4300`. If your NAS has a firewall, allow port 4300 for your home network only.
- Do not forward port 4300 on your router. See [Server and remote access](Server-and-Remote-Access.md) for reaching the app from outside your home.
- The **This server** page in **Settings** shows the NAS's CPU use, memory and disks. In Docker it doesn't show network addresses, because it sees the container's addresses, not the NAS's.

## Problems and fixes

- **`403 forbidden_host` from a phone.** Add the NAS's address with `APP_ALLOWED_HOSTS` until the first admin exists. See [Docker](Docker.md#start-it).
- **The image can't be pulled, or says `no matching manifest`.** Your NAS has an ARM processor. Use [Run it without Docker](#run-it-without-docker).
- **A project folder looks empty.** Add the path inside the container (`/projects/files`), not the NAS path.
- **Changes in a folder aren't noticed.** Use **Scan folders**.

## Related pages

- [Docker](Docker.md)
- [Server and remote access](Server-and-Remote-Access.md)
- [Choose how to run](Choose-How-to-Run.md)
- [Install from source](Install-from-Source.md)

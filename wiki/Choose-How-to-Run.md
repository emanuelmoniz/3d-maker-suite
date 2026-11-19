# Choose how to run

3D Maker Suite can run on your own computer, in Docker, on a NAS, on a server, or as a hub that other computers join. This page helps you pick one.

## Who can use it

Anyone who installs the app. You don't need an account to start. Accounts are only needed when other people or other devices use the app.

## The options at a glance

| Option | Best for | Always on? | Needs |
|---|---|---|---|
| **PC** | One person, one computer | No. It runs while your PC is on | Nothing else. The installer brings what it needs |
| **Docker** | A home server or NAS you already run | Yes | Docker with Compose |
| **NAS** | A NAS that is on all day | Yes | Docker, or Node 22 |
| **Server** | A small group, or access from outside your home | Yes | A Linux machine, and HTTPS if it is on the internet |
| **Hub** | Several computers that each hold project files | The hub is always on | A server, user accounts, and a connector on each computer |

## Which one should I choose?

- **I print at home and use one computer.** Use the PC install: [Windows](Install-on-Windows.md), [macOS](Install-on-macOS.md) or [Linux](Install-on-Linux.md).
- **I want the app to be reachable all day from my phone or other computers.** Use Docker on a NAS or home server.
- **I know Git and Node and want to change the code.** [Install from source](Install-from-Source.md).
- **My project files are spread over several computers.** Run a hub, and put a connector on each computer.

## What stays the same

All options run the same app and keep your data on your own machine. Bambu Cloud, the printer connections and the pages work the same way. A few things differ in Docker or on a NAS, such as slicing and watching folders on network shares.

## Limits and tips

- You can start on a PC and move to Docker later. Your data is one folder, so it can be copied over.
- The app listens only on its own computer by default. To reach it from another device, create user accounts first.
- A PC install needs no account. The first account is created when you open the app.

## Related pages

- [Install on Windows](Install-on-Windows.md)
- [Install on macOS](Install-on-macOS.md)
- [Install on Linux](Install-on-Linux.md)
- [Install from source](Install-from-Source.md)

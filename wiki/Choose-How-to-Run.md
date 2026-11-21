# Choose how to run

3D Maker Suite installs in five ways: on Windows, on macOS, on Linux, in Docker, or from source. This page helps you pick one. Whether the machine is your PC, a NAS or a server doesn't change that: you follow the page for its system.

## Who can use it

Anyone who installs the app. You don't need an account to start. Accounts are only needed when other people or other devices use the app.

## The five installs

| Install | Best for | Always on? | Needs |
|---|---|---|---|
| [**Windows**](Install-on-Windows.md) | One person on a Windows PC | No. It runs while your PC is on | Nothing else. The installer brings what it needs |
| [**macOS**](Install-on-macOS.md) | One person on a Mac | No. It runs while your Mac is on | Nothing else. The installer brings what it needs |
| [**Linux**](Install-on-Linux.md) | A Linux computer with a desktop | No, unless the computer stays on | A 64-bit computer, x64 or ARM64 (a Raspberry Pi). The archive brings what it needs |
| [**Docker**](Docker.md) | A home server or NAS you already run | Yes | Docker with Compose, on an Intel or AMD (x64) processor |
| [**From source**](Install-from-Source.md) | Changing the code, or a machine the other installs don't fit | As long as you keep it running | Node 22, Git and a terminal |

## Which one should I choose?

- **I print at home and use one computer.** Use the install for your system: [Windows](Install-on-Windows.md), [macOS](Install-on-macOS.md) or [Linux](Install-on-Linux.md).
- **I want the app to be reachable all day from my phone or other computers.** Use [Docker](Docker.md) on a home server or NAS.
- **I know Git and Node and want to change the code.** [Install from source](Install-from-Source.md).

### On a NAS or home server

A NAS is a machine, not a way to install. Follow the page for what it runs:

- **It has Docker and an Intel or AMD processor:** [Docker](Docker.md#on-a-nas). This is the easy way.
- **It runs Windows:** [Install on Windows](Install-on-Windows.md).
- **It has a Linux desktop, on an ARM processor too:** [Install on Linux](Install-on-Linux.md).
- **It has no Docker and no desktop:** [Install from source](Install-from-Source.md#on-a-nas-or-a-machine-with-no-desktop).

## After you install

These add to any install:

- **Reach it from your phone or another computer.** [Use from another device](Use-From-Another-Device.md).
- **Reach it from outside my home.** Put it behind HTTPS: [Public access](Public-Access.md).
- **My project files are spread over several computers.** Run a hub, and put a connector on each computer: [Hub setup](Hub-Setup.md) and [Connector setup](Connector-Setup.md). A Raspberry Pi, a Linux server or a Windows Server with nobody signed in runs it too: [Linux with no desktop](Connector-Setup.md#linux-with-no-desktop) and [Windows Server](Connector-Setup.md#windows-server).

## What stays the same

All installs run the same app and keep your data on your own machine. Bambu Cloud, the printer connections and the pages work the same way. A few things differ in Docker, such as slicing and watching folders on network shares.

## Limits and tips

- You can start on a PC and move to Docker later. Your data is one folder, so it can be copied over.
- The app listens only on its own computer by default. To reach it from another device, create user accounts first.
- A PC install needs no account. The first account is created when you open the app.

## Related pages

- [Install on Windows](Install-on-Windows.md)
- [Install on macOS](Install-on-macOS.md)
- [Install on Linux](Install-on-Linux.md)
- [Install from source](Install-from-Source.md)
- [Docker](Docker.md)
- [Use from another device](Use-From-Another-Device.md)
- [Public access](Public-Access.md)

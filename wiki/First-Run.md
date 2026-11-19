# First run

What to do the first time you open 3D Maker Suite: create the admin account, then set up the basics.

## Who can use it

Whoever starts the app first. Until the first account exists, anyone who can open the page can create it. Do this right after the first start, before the app is reachable from other devices.

## Before you start

- The app is running. See [Choose how to run](Choose-How-to-Run.md) if you haven't picked how yet.
- Know where you are: on the PC or server that runs the app, or on another device. This decides if you need the setup token.

## Create the admin account

1. Open the app. On the computer that runs it, go to <http://localhost:4300>. In Docker, open the same address on the server itself.
2. The **Create the admin account** page opens. On the server itself it asks for no token.
3. From another device, it also asks for the **Setup token**. Find the token in the app's console, see [Find the setup token](#find-the-setup-token).
4. Fill in the fields below and click **Create account**.
5. You are signed in as an admin. Further accounts are added later in **Settings**.

| Field | Required | What it means | Example |
|---|---|---|---|
| **Email** | Yes | What you sign in with | `you@example.com` |
| **Name** | Yes | How your name shows in the app and the logs | `Sam` |
| **Password** | Yes | At least 8 characters | a long phrase |
| **Repeat the password** | Yes | Must match | |
| **Setup token** | Only from another device | Proves you control the server | `Zk3p...` |

## Find the setup token

The app prints the token in its console each time it starts, until the first account exists. It prints a new token at each start.

| How you run it | Where to look |
|---|---|
| `pnpm start` or the installed app on a console | The window or terminal that started it |
| Docker | `docker compose logs app` |
| NAS | The container's **Log** tab in the NAS's Docker app |

The line reads `No users yet. To create the first admin from another device, use this setup token: ...`.

A request addressed to `localhost` from the server itself never needs the token. A request through a public name behind a reverse proxy always does, see [Server and remote access](Server-and-Remote-Access.md#first-admin-through-the-public-name).

## The first things to set up

A short order that works for most people:

1. **Settings.** In **Network**, check the host and port. In **General**, turn on **Start at login** if the app should be there after a restart. To reach the app from other devices, see [Use from another device](Use-From-Another-Device.md).
2. **Printers.** Add your printers, by hand or through an integration.
3. **Projects settings.** Open **Projects**, then the gear. Add the folders that hold your 3D files. In Docker, use the path inside the container, for example `/projects/files`.
4. **Filament.** Add your spools.
5. **Quotes settings.** Open **Quotes**, then the gear. Set your currency, electricity price and labour rate, so costs and quotes are right from the start.
6. **Settings → Users.** Add the people who need an account and choose their roles.

## Limits and tips

- The first account is always an admin. The Admin role can't be changed, disabled or deleted.
- Another admin can reset a password with **Reset password** in **Settings → Users**. Keep a second admin account in case you forget yours.
- With **User accounts** turned off, nobody signs in. Keep it on for any app that other devices can reach.

## Problems and fixes

- **The page asks for a setup token on the server itself.** You opened it with the machine's network address or a name. Use <http://localhost:4300>, or enter the token.
- **`403 forbidden_host` from another device.** Add the address you type in the browser to `APP_ALLOWED_HOSTS`, see [Use from another device](Use-From-Another-Device.md#problems-and-fixes).
- **I can't find the token.** It only prints while no account exists. Restart the app and read the console again.
- **An admin account already exists.** Someone created it before you. Go to the sign-in page.

## Related pages

- [Use from another device](Use-From-Another-Device.md)
- [Configuration](Configuration.md)
- [Docker](Docker.md)
- [Server and remote access](Server-and-Remote-Access.md)

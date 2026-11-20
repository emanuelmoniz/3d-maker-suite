# Use from another device

Open 3D Maker Suite on your phone, tablet or another computer, on the same network as the machine that runs it.

## Who can use it

Anyone who can change the app's host setting and the firewall of the machine that runs it. For access from outside your home, see [Public access](Public-Access.md).

## Before you start

- The machine that runs the app is on and connected to the same network (Wi-Fi or cable) as your device.
- You know the machine's address, for example `192.168.1.20`. The **This server** card in **Settings** shows the machine's network addresses. In Docker, use the address of the server or NAS instead.
- You have an admin account, or you can set `APP_PASSWORD`. See [First run](First-Run.md).

## Let the app listen on the network

By default the app answers only on the machine itself (`127.0.0.1`). Change that:

1. Open **Settings → Network**.
2. Set **Host** to `0.0.0.0`. Leave **Port** at `4300`, or pick another.
3. Click outside the box to save it, then click **Restart server** at the top right of the page. If the app doesn't restart by itself, stop it and start it again.

You can also set `HOST=0.0.0.0` as an environment variable, see [Configuration](Configuration.md). Docker already does this.

## Protect it first

Anyone on your network can open the app once it listens. Do one of these before you do:

1. Create the first admin on the machine itself, see [First run](First-Run.md). From then on everybody signs in.
2. Or, before any account exists, set `APP_PASSWORD`. It is one shared password for HTTP Basic sign-in, with any user name. The app ignores it once the first account exists.

Without a password or an account, the app refuses requests that aren't addressed to `localhost` or its own host.

## Open it

1. On the other device, open a browser.
2. Type `http://<machine-address>:4300`, for example `http://192.168.1.20:4300`.
3. Sign in. For the first admin from another device, enter the setup token too, see [First run](First-Run.md#find-the-setup-token).

On a phone or tablet, use the browser's **Add to Home screen** to keep a shortcut. The app is built for small screens.

## Allow the port in the firewall

If the page doesn't open, the machine's firewall may block port 4300.

| System | What to do |
|---|---|
| Windows | When Windows asks, allow access on **Private networks**. Or open **Windows Defender Firewall → Advanced settings → Inbound Rules** and add a rule for TCP port 4300 |
| macOS | **System Settings → Network → Firewall**. Allow incoming connections for the app |
| Linux | Allow TCP 4300, for example `sudo ufw allow from 192.168.1.0/24 to any port 4300` |
| Docker host, such as a NAS | Allow port 4300 for your home network only. Use the host's own firewall or its NAS settings |

Never open the port to the internet. See [Public access](Public-Access.md#what-not-to-expose).

## Use a name instead of an address

An address like `192.168.1.20` can change. Give the machine a fixed address in your router, then use it. If you use a name such as `nas.local` or `3d.example.com`, add it to `APP_ALLOWED_HOSTS`. The name must be a bare host name or IP: no `http://`, no port, no path.

## Limits and tips

- The address must be the one you type in the browser. A different name for the same machine gets `403 forbidden_host`, until the first admin exists and accounts are on.
- Changes to host and port apply after a restart. **Settings → Network** shows when a command-line flag or an environment variable is overriding the saved value.
- Links in alert emails and ntfy messages follow **Public address** in **Settings → Network**. See [Public access](Public-Access.md).
- In Docker, change the port in the `ports:` line of the compose file, not in the app. See [Docker](Docker.md).

## Problems and fixes

- **The page doesn't open.** Check that both devices are on the same network, that the host is `0.0.0.0` and the app was restarted, and that the firewall allows port 4300.
- **`403 forbidden_host`.** The app doesn't know that address. Add it to `APP_ALLOWED_HOSTS` and restart, or set `APP_PASSWORD`.
- **A password prompt from the browser.** `APP_PASSWORD` is set and no account exists yet. Type any user name and the password.
- **It worked yesterday and not today.** The machine's address changed. Check the **This server** card in **Settings**, and give the machine a fixed address.

## Related pages

- [First run](First-Run.md)
- [Configuration](Configuration.md)
- [Docker](Docker.md)
- [Public access](Public-Access.md)

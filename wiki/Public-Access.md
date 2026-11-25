# Public access

Reach 3D Maker Suite from the internet over HTTPS. This page is for any install that must be reachable from outside your home, on any machine. It covers the reverse proxy, HTTPS, the public name, what must never be exposed, and a VPN as the safer choice.

## Who can use it

Anyone who has already installed the app on a machine that is always on, and who controls a domain name. You need to be able to change the machine's firewall and install a reverse proxy.

## Before you start

- **A machine that is always on.** A small Linux server, a VPS, a home server or a NAS.
- **A [Docker](Docker.md) or a [source](Install-from-Source.md) install** that already works on the machine. The published Docker image needs an Intel or AMD (x64) processor; an ARM machine needs the source install.
- **A domain name** that points at the machine, such as `3d.example.com`.
- **A reverse proxy** that serves HTTPS: Caddy, nginx or Traefik. The app doesn't do HTTPS by itself.
- **User accounts.** Anyone who reaches the app needs to sign in. Create them before you open the app to the internet.

## How the pieces fit

```text
Your browser --HTTPS--> reverse proxy --HTTP--> 3D Maker Suite (port 4300)
```

The reverse proxy owns the public address and the certificate. The app listens only where the proxy can reach it, and is never published to the internet directly.

## Set it up

1. **Run the app** as shown on the [Docker](Docker.md) page, or from source. Create the first admin before anything else. Do it on the server itself at `http://localhost:4300`, so no token is needed.
2. **Keep the app private.**
   - Docker, proxy on the same machine: publish the port to the machine only, `"127.0.0.1:4300:4300"` in `ports:`.
   - Docker, proxy in the same Compose project: remove `ports:`, and send the proxy to `app:4300`.
   - Source install: leave `HOST` at its default, `127.0.0.1`.
3. **Tell the app its public name.** Set these environment variables (in Docker, under `environment:`):

| Variable | What to put | Why |
|---|---|---|
| `APP_ALLOWED_HOSTS` | `3d.example.com` | The app answers `403 forbidden_host` to any name it doesn't know |
| `APP_TRUST_PROXY` | The proxy's address, for example `127.0.0.1` | Without it every visitor looks like the proxy |
| `APP_PUBLIC_URL` | `https://3d.example.com` | The links in alert emails and ntfy messages. Optional: **Settings → Network → Public address** sets the same |

   - `APP_ALLOWED_HOSTS` takes bare names or IPs, separated by commas. No `https://`, no port, no path and no wildcard.
   - `APP_TRUST_PROXY` takes addresses or ranges, such as `127.0.0.1` or `172.16.0.0/12`. It does not take `true` or a number. In Docker, the proxy reaches the container from the Docker network, so list that network's range. If your Docker network uses another range, list that one.

4. **Set up the proxy,** below.
5. **Open the port 443** on the machine's firewall and on your router. Keep port 4300 closed.
6. **Restart the app** so it reads the new variables.
7. **Check it.** Open `https://3d.example.com` and sign in. In **Settings → Network**, set **Public address** to **Domain or external IP**, type `https://3d.example.com` and press **Test**.

## Reverse proxy settings

The proxy must do three things:

- Pass the original `Host` (the public name) on to the app.
- Send `X-Forwarded-Proto` so the sign-in cookie is marked `Secure`.
- Send `X-Forwarded-For` so the lockout after wrong passwords hits only that visitor.

### Caddy

Caddy gets the certificate for you and sends all three by default:

```text
3d.example.com {
    reverse_proxy 127.0.0.1:4300
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name 3d.example.com;
    # ssl_certificate and ssl_certificate_key: your certificate

    client_max_body_size 2g;

    location / {
        proxy_pass http://127.0.0.1:4300;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

`client_max_body_size` matters. nginx refuses requests over 1 MB by default, so uploads of project files and backups (up to 2 GB) fail with `413`. The app marks its live streams as unbuffered, so no extra setting is needed for them.

### Traefik

Traefik sends `X-Forwarded-For` and `X-Forwarded-Proto` by default. Point its service at port 4300 and route your name to it.

The app's live streams work behind Caddy, nginx and Traefik with their default settings.

## First admin through the public name

Creating the first admin from the public name still needs the setup token. Only a request addressed to `localhost` from the server skips it. The token is in the app's log (`docker compose logs app` in Docker). Create the admin on the server first and the token never comes into it.

## Hubs and connectors

A [hub](Hub-Setup.md) on a server is reached by the connectors on your computers ([Connector setup](Connector-Setup.md)). A connector only connects out, to the hub's public address, so the computers need no open ports and no VPN. The proxy settings above are all it needs. A connector paired at a LAN address moves to the **Public address** once you set one and it answers there, see [When the address changes](Hub-Setup.md#when-the-address-changes).

A server outside your home can't reach a printer on your home network. Bambu Cloud printers work from anywhere. For the others, a connector on a computer at home talks to them for the hub.

## What not to expose

- **Port 4300 itself.** It speaks plain HTTP, so passwords and cookies would cross the internet in the open. Only the proxy faces the internet.
- **The app without accounts.** With no accounts, whoever reaches the app has full access. Do not turn **User accounts** off on a server that the internet can reach.
- **`APP_PASSWORD` as the only protection.** It is one shared password, and it is only used until the first admin exists, or while accounts are off. Use accounts.
- **The data folder or volume.** It holds the database and `secret.key`, which protects saved logins. Never share it, mount it elsewhere or put it in a public backup.
- **Your printers.** Never forward a printer's port to the internet. The app connects out to Bambu Cloud, or a connector reaches the printer on your network.
- **The Docker socket.** The app doesn't need it.

To reach the app from outside without a public address at all, put the server on a VPN you control and open it by its private address.

## Limits and tips

- After five wrong passwords or pairing codes, the account, or pairing, is locked for 15 minutes. Behind a proxy without `APP_TRUST_PROXY`, that lock hits everybody.
- Behind a proxy, alert emails and ntfy messages carry no link until you set `APP_PUBLIC_URL`, or **Public address** in **Settings → Network**.
- Back up before updating. Updating is described on the [Docker](Docker.md) page.

## Problems and fixes

- **`403 forbidden_host`.** The name isn't in `APP_ALLOWED_HOSTS`, or the proxy doesn't pass the original `Host`. nginx needs `proxy_set_header Host $host;`.
- **Everybody is locked out after a few wrong passwords.** `APP_TRUST_PROXY` is missing or doesn't match the proxy's address, so every visitor looks the same.
- **Uploads fail with `413`.** Raise `client_max_body_size` in nginx.
- **The Public address test says the name wasn't found, or no answer.** Check your DNS and firewall. A home router often can't reach its own external address from inside, so the test can give a false alarm. Use **Open address** from another network.
- **The Public address test says `Add it to APP_ALLOWED_HOSTS`.** Do as it says, and restart the app.
- **The certificate isn't valid.** Fix it on the proxy.

## Related pages

- [Docker](Docker.md)
- [Docker](Docker.md)
- [Choose how to run](Choose-How-to-Run.md)
- [Install from source](Install-from-Source.md)

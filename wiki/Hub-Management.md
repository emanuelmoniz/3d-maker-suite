# Hub management

Hub management lists the computers paired with your hub, pairs new ones, and opens each computer's page. Its settings cover syncing and file versions. The hub's slicer preset library has its own tab in [Catalog settings](Catalog-Settings.md#preset-library).

![Hub management, with one paired computer](../docs/images/hub.png)

## Who can use it

- The tab shows in **Settings** only while the [hub is on](Hub-Setup.md#turn-the-hub-on). With it off, there is no tab.
- **Manage the hub** is needed to pair, rename, update, revoke and change every setting of every computer. Admin has it. See [Roles](Roles.md#hub-server-and-users).
- A person whose computer is paired to them can open that computer's page without it. They see its values, and can change a section only with the matching right of **Their own machines**: **Connection**, **Catalog** or **Projects**. The last two also need **Write** on that module. See [Roles](Roles.md#their-own-machines).

## Before you start

Turn the hub on and install a connector, see [Hub setup](Hub-Setup.md) and [Connector setup](Connector-Setup.md).

## Devices

The table lists every paired computer. Search, sort and filter work as on other lists.

| Column | What it shows |
|---|---|
| **Name** | The computer's name. It opens its page |
| **Status** | **Online** or **Offline**. An offline computer says when it was **Last seen**, or **Not seen yet**. **Outdated** means its connector isn't on the hub's version and it updates itself when it connects. **Update failed** means the last update didn't work |
| **User** | The user the computer acts as, with their rights |
| **Base OS** | **Windows**, **Linux** or **macOS**. Hover for the full system name |
| **Connector version** | The version of the connector on it |

With no computers, the page says **No devices yet**.

### Tick several computers

Tick rows to get a bar with two buttons:

- **Restart** restarts the connectors. An offline one can't be restarted.
- **Revoke** asks first. See [Revoke a computer](#revoke-a-computer).

Computers that couldn't do it stay ticked, and the list names them.

## Pairing

Press **Pair a device**, then choose **Where does the connector run?**:

- **This computer, with a screen.** Pick the **User** the computer will act as, then press **Create code**. The code works once, for 10 minutes, only for that user, and is shown only once. Press **Copy code**, then **Done**. Then enter the code on the connector's own page. The steps are in [Connector setup](Connector-Setup.md#pair-the-computer).
- **A NAS, server or container.** The code works once, for 24 hours, because setting up a machine with no screen takes longer. The dialog **Pair a NAS or server** shows the code and the exact lines to paste, with the hub's address filled in. Pick how the connector is installed:
  - **Docker:** a compose file with host networking, the `PUID` and `PGID` lines, and a bind mount with `rslave` for a shared folder, and the command that starts it.
  - **Linux service:** the `install.sh --headless` command, for a Raspberry Pi or a Linux server without Docker.
  - **Windows Server:** the silent setup line with `/ALLUSERS /HEADLESS`, and the two switches `/ACCOUNT` and `/PASSWORDFILE` for a named account that reaches network shares.

  ![The dialog for pairing a NAS or server, with the compose file](../docs/images/wiki-hub-pair-nas.png)

  **Hub address** starts as the address you opened this page at. Change it to the address the NAS or server reaches the hub at, because `localhost` means something else on another machine. Each block has a **Copy** button. The only secret in them is the one-time code. It isn't shown again after you close the dialog, so copy what you need first. The steps behind each block are in [Connector setup](Connector-Setup.md).

Only users who aren't disabled are listed.

### Unused pairing codes

A code for a NAS or server outlives your visit, so unused codes are listed under the table as **Unused pairing codes**: who it is for, the kind, and **until** when. The code itself is never shown again. **Withdraw** a code you don't need: it pairs nothing after that. A code leaves the list when a connector pairs with it or it expires.

## Machine page

Open a computer from the table. The title is its name, with an **Online** or **Offline** pill. Top right are **Restart connector**, **Stop connector** and **Revoke**, for those allowed to use each. **Stop connector** asks **Stop the connector on {name}?**: it goes offline and starts again only when someone logs in on that computer or starts it by hand. While the computer is offline, a note says changes apply when it reconnects. If your browser runs on that computer, a link opens its local page.

![A machine page](../docs/images/wiki-hub-machine.png)

A section you can't edit shows its values as text, for example **Get projects from server: on**.

### Identity

The **Name** field, saved with **Save**, and the **User** it acts as. **Change user** opens **Change this connector's user**:

- **A computer with a screen:** pick another user, and the next dialog, **Code for {name}**, shows a one-time code. Enter it on that connector's local page. Nothing changes until you do. The computer then acts with the new user's role.
- **A connector with no screen** (a Docker container or a headless service): nobody is there to type a code, so the change applies at once. Pick the user, then choose what happens to **Its projects**: **Move them to the new user** or **Leave them with their owners**. The card then says **Now acting as {name}**, with how many projects moved.

### Software

Its system, the connector version, **Installed as** (**Desktop installer**, **Service with no screen** or **Docker container**) and its **Architecture**, such as x64 or arm64. When it is outdated, the card says why: older than the hub, **Could not download version…** or **Version… did not start on the device, so it went back**. **Update now** tells an online connector to update. An offline one gets it when it connects.

A connector in a Docker container doesn't update itself. When it is outdated, the card shows the command to run in the folder with its compose file, with a **Copy command** button, instead of **Update now**.

### System

The CPU load, memory, disks and network addresses, as the connector last reported them. The report comes every 30 seconds while the computer is online. It also says the address the hub sees the computer from. Offline, only **Last seen** is shown, never old numbers.

### Connection

- **Local page port:** the port of the connector's own page. A new port applies after a restart, and the page says **Saved. Restart the connector…**.
- **Start with the computer:** starts the connector when you log in.

These need the connector online. Offline, the card says so. A connector too old for this says **Update or restart it on its computer**.

### Slicers

Lists the slicers found on the computer, each with its version and **installed**. The one the hub uses carries **Server's slicer**.

- **Use slicer as server worker:** lets the hub send slicing to this computer. Turning it off asks **Stop using {name} as a server worker?**, then removes its slicer installs in **Integrations** and uninstalls a slicer the hub installed there. What they imported stays. On a Linux computer with an ARM processor, such as a Raspberry Pi, the switch is greyed out and the card says why: Bambu Studio and OrcaSlicer have no build for it. Slicing goes to a worker on x64, or a Mac.
- With **Set up integrations**, links open **Set up** a slicer on this machine, or the slicer's card in **Integrations**. See [Slicers](Slicers.md).

### Slicers catalog

Shows only when the computer has a slicer.

- **Get catalog from server:** the hub writes the catalog into its slicer. Its **Catalog consumers** link opens that tab of [Catalog settings](Catalog-Settings.md#consumers).
- **Send catalog to server:** its user presets join the hub's [preset library](Catalog-Settings.md#preset-library). Its **Catalog sources** link opens that tab.

### Projects

- **Get projects from server:** its folders get copies of the hub's projects. It shows how many **picks** it has, and a line of its sync state, such as **Up to date · 12 files**, **Syncing…**, or **Sync paused: 25 files deleted in … at once**. For each folder whose deletes were held, for example because its folder went missing, the card says how many files, with two buttons that work for every connector, also one with no screen:
  - **Delete on the hub too** asks first. The files move to the hub's trash, and every machine that receives that folder loses them.
  - **Restore them** downloads the files to the computer again.

  Both need the connector online. The connector's own local page offers the same two choices. Turning it off asks first: **Stop receiving projects on…?** removes its copies from the computer and deletes nothing on the hub.
- **Send projects to server:** the folders it shares with the hub, shown as a count with **Up to date** once reported.

The links **Projects consumers** and **Projects sources** open the same tabs in [Projects settings](Projects-Settings.md).

### Printers and Spool libraries

Two cards, **Reach printers** and **Reach spool libraries**, for devices on that computer's network that the hub can't reach itself. Its connector reads them for the hub. It never controls a printer, and it writes to a spool library only the filament your prints used and the spools they used that the library doesn't have yet.

Each card lists what goes through the computer, or says **No printer goes through this machine.** Turning a switch off asks **Stop reaching printers through {name}?** (or spool libraries). **Pause and turn off** pauses them and keeps them on this computer until you turn it on and enable them in **Integrations** again. **Set up in Integrations** or **Open in Integrations** goes to [Integrations](Integrations.md).

## Hub settings

![Hub management settings](../docs/images/wiki-hub-settings.png)

The gear button at the top right of **Hub management** opens the settings, with **Manage the hub**. The back arrow returns to the table. One card, **Sync**, saves each field as you leave it.

| Setting | What it does | Default |
|---|---|---|
| **Pause after this many deletes at once** | A computer that deletes more files than this from one hub folder at once pauses its sync and asks on its local page before anything moves to the hub's trash. 1 to 10,000 | 20 |
| **New machines receive** | What a newly paired computer gets: **Every project folder** or **Nothing until picked**. Each computer's picks are changed in [Projects settings](Projects-Settings.md) | **Nothing until picked** |
| **Keep earlier versions of files** | A save or upload that replaces a hub file keeps the old content. Changes made straight on a disk are not kept. Backups include these versions, so they grow | Off |
| **Versions to keep per file** | Shown when versions are on. 1 to 100. Lowering it deletes the older versions on the hub now, and on a computer at the file's next upload | 5 |

While versions are kept, a line says how much space they use, for example **Using 12 MB for 30 kept versions.**

## Preset library

The hub's one library of slicer presets is a tab of Catalog settings, not of Hub management. The list, versions, delete and restore, held deletes and conflict copies are explained in [Catalog settings](Catalog-Settings.md#preset-library). The old address `/hub/presets` redirects there.

## Common tasks

### Pair a computer

1. Open **Settings → Hub management** and press **Pair a device**.
2. Choose **This computer, with a screen**, pick the user and press **Create code**, then **Copy code**.
3. Enter the code on the connector's page, see [Connector setup](Connector-Setup.md#pair-the-computer).
4. The computer shows **Online** in the table.

### Pair a NAS, server or container

1. Open **Settings → Hub management** and press **Pair a device**.
2. Choose **A NAS, server or container**, pick the user and press **Create code**.
3. Check **Hub address**, pick **Docker**, **Linux service** or **Windows Server**, and press the **Copy** button of the block you need.
4. Run it on the NAS or server, see [Connector setup](Connector-Setup.md). The code works once, for 24 hours. **Withdraw** it under **Unused pairing codes** if you don't use it.
5. The machine shows **Online** in the table.

### Rename a computer

1. Open the computer.
2. Change **Name** in **Identity** and press **Save**.

### Update an outdated connector

1. Open the computer while it is online.
2. In **Software**, press **Update now**.

### Share a computer's printers with the hub

1. Set up the printer or spool library in **Integrations**, choosing this computer under **Reached from**.
2. Open the computer and switch on **Reach printers** or **Reach spool libraries**.

### Revoke a computer

1. Open the computer and press **Revoke**, or tick it in the table.
2. Confirm **Revoke**. The computer loses access at once. Its local files stay on its disk.
3. To use it again, pair it with a new code.

## Related settings

- **Settings → General** has the **Hub** switch, see [Settings](Settings-General.md).
- [Catalog settings](Catalog-Settings.md) and [Projects settings](Projects-Settings.md) pick what each computer receives and shares.
- **Manage the hub** is set in [Roles](Roles.md).

## Limits and tips

- A computer acts as one user. To move it to another user, use **Change user**: with a code on a computer with a screen, at once on a machine with none.
- A revoked computer can't be brought back. Pair it again.
- Most controls need the connector online. Offline ones apply when it reconnects, or say they can't be changed.
- The hub never runs a command on a computer, and never sends one to a printer.

## Problems and fixes

| What you see | What to do |
|---|---|
| No **Hub management** tab | The hub is off, or you lack **Manage the hub**. See [Hub setup](Hub-Setup.md) |
| **Outdated** stays | Press **Update now**, or restart the connector on the computer |
| **Update failed** | Read the reason in **Software**. Check the computer can reach GitHub releases |
| **The connector didn't answer. Try again.** | The connector is busy or just restarted. Wait a few seconds |
| **Sync paused…** | Press **Delete on the hub too** or **Restore them** on the machine's page, or on the connector's local page |
| **Outdated** on a Docker connector | Run the command on its card in the folder with its compose file. It doesn't update itself |
| The **Use slicer as server worker** switch is greyed out | The machine is Linux on ARM, which can't slice. Use a worker on x64, or a Mac |
| **This is the hub's slicer…** | Pick another slicer in **Integrations** first |
| **Turn the hub on to reach printers…** | Switch the hub on in **Settings → General** |

## Related pages

- [Hub setup](Hub-Setup.md)
- [Connector setup](Connector-Setup.md)
- [Catalog settings](Catalog-Settings.md)
- [Projects settings](Projects-Settings.md)
- [Integrations](Integrations.md)
- [Roles](Roles.md)

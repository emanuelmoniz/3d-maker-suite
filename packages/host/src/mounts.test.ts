import { describe, expect, it } from "vitest";
import { isShareType, mountOf, parseMountInfo } from "./mounts.ts";

const INFO = [
  "22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw",
  "30 22 0:27 / /data rw,relatime - ext4 /dev/sdb1 rw",
  "31 22 0:40 / /mnt/nas rw,relatime - cifs //nas/share rw,vers=3.1.1",
  "32 22 0:41 / /mnt/nfs rw,relatime - nfs4 nas:/export rw",
  "33 22 0:42 / /mnt/a\\040b rw,relatime - fuse.sshfs me@host:/ rw",
  "34 22 0:43 / /mnt/ro ro,relatime - ext4 /dev/sdc1 rw",
  "35 22 0:44 / /mnt/ro2 rw,relatime - ext4 /dev/sdd1 ro",
  "36 31 0:45 / /mnt/nas/local rw,relatime - ext4 /dev/sde1 rw",
].join("\n");

describe("mounts", () => {
  it("parses mountinfo, spaces in a mount point included", () => {
    expect(parseMountInfo(INFO).map((e) => e.point)).toContain("/mnt/a b");
  });

  it("names the file system of the longest mount point that holds a path", async () => {
    expect(await mountOf("/data/Models", INFO)).toEqual({
      type: "ext4",
      share: false,
      readOnly: false,
    });
    expect(await mountOf("/home/me", INFO)).toMatchObject({ type: "ext4", share: false });
    expect(await mountOf("/mnt/nas/Projects", INFO)).toMatchObject({ type: "cifs", share: true });
    // A disk mounted inside a share is the disk's.
    expect(await mountOf("/mnt/nas/local/x", INFO)).toMatchObject({ type: "ext4", share: false });
    expect(await mountOf("/mnt/nfs", INFO)).toMatchObject({ type: "nfs4", share: true });
    expect(await mountOf("/mnt/a b/x", INFO)).toMatchObject({ type: "fuse.sshfs", share: true });
    // A name that only starts like a mount point isn't inside it.
    expect(await mountOf("/mnt/nas2", INFO)).toMatchObject({ type: "ext4", share: false });
  });

  it("reads read-only from the mount or the file system's own options", async () => {
    expect((await mountOf("/mnt/ro/x", INFO)).readOnly).toBe(true);
    expect((await mountOf("/mnt/ro2/x", INFO)).readOnly).toBe(true);
    expect((await mountOf("/data", INFO)).readOnly).toBe(false);
  });

  it("calls a UNC path a share, and knows nothing where there is no mountinfo", async () => {
    expect(await mountOf("\\\\nas\\share\\Models")).toEqual({
      type: "smb",
      share: true,
      readOnly: false,
    });
    expect(await mountOf("C:\\Models", "")).toEqual({ type: null, share: false, readOnly: false });
  });

  it("lists the share types", () => {
    for (const t of ["cifs", "smb3", "nfs", "nfs4", "fuse", "fuse.rclone"])
      expect(isShareType(t)).toBe(true);
    for (const t of ["ext4", "btrfs", "overlay", "xfs", "tmpfs", "zfs"])
      expect(isShareType(t)).toBe(false);
  });
});

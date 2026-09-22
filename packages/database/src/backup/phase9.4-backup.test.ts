/**
 * Phase 9.4 — Backup / recovery unit tests (no production DB mutation).
 * Real pg_dump/pg_restore runtime is optional; injectable runners cover acceptance.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertArtifactNonEmpty,
  assertPgCustomFormatMagic,
  assertSafeRestoreTarget,
  buildBackupId,
  cleanupRetention,
  createBackup,
  CORE_TABLES,
  PG_CUSTOM_MAGIC,
  pathsForBackupId,
  readMetadata,
  restoreVerify,
  sha256File,
  verifyBackup,
  verifyChecksum,
  writeChecksumFile,
  writeLatestPointer,
  type BackupMetadata,
  type CreateBackupOptions,
} from "./index.js";

function tempDir(): string {
  return join(tmpdir(), `adlinklab-backup-${randomUUID()}`);
}

function writeFakePgDump(path: string, payload = "fake-pg-archive-body"): void {
  writeFileSync(
    path,
    Buffer.concat([Buffer.from(PG_CUSTOM_MAGIC), Buffer.from(payload)])
  );
}

describe("Phase 9.4 backup / recovery", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const tools = { pgDump: "pg_dump", pgRestore: "pg_restore" };
  const fakeList = () => ({ status: 0 as number | null, stderr: "" });

  function baseCreate(
    overrides: Partial<CreateBackupOptions> = {}
  ): CreateBackupOptions {
    return {
      cwd: dir,
      env: {
        ADLINKLAB_BACKUP_DIR: dir,
        DATABASE_URL: "postgresql://u:p@localhost:5432/src",
      },
      tools,
      runPgRestoreList: fakeList,
      runPgDump: (_b, _u, out) => {
        writeFakePgDump(out);
        return { status: 0, stderr: "" };
      },
      ...overrides,
    };
  }

  it("1-2. backup creates non-empty artifact", async () => {
    const result = await createBackup(baseCreate());
    expect(result.metadata.status).toBe("VERIFIED");
    const paths = pathsForBackupId(dir, result.metadata.backupId);
    expect(existsSync(paths.artifactPath)).toBe(true);
    expect(assertArtifactNonEmpty(paths.artifactPath)).toBeGreaterThan(0);
  });

  it("strips Prisma schema query param before pg_dump", async () => {
    let seenUrl = "";
    await createBackup(
      baseCreate({
        env: {
          ADLINKLAB_BACKUP_DIR: dir,
          DATABASE_URL:
            "postgresql://u:p@localhost:5432/src?schema=public",
        },
        runPgDump: (_b, url, out) => {
          seenUrl = url;
          writeFakePgDump(out);
          return { status: 0, stderr: "" };
        },
      })
    );
    expect(seenUrl).not.toMatch(/schema=/);
    expect(seenUrl).toContain("localhost:5432/src");
  });

  it("3. zero-byte artifact => FAIL", async () => {
    await expect(
      createBackup(
        baseCreate({
          runPgDump: (_b, _u, out) => {
            writeFileSync(out, Buffer.alloc(0));
            return { status: 0, stderr: "" };
          },
        })
      )
    ).rejects.toMatchObject({ code: "ARTIFACT_ZERO_BYTE" });

    const files = readdirSync(dir);
    const metaFile = files.find(
      (f) => f.endsWith(".json") && f !== "latest-verified.json"
    );
    expect(metaFile).toBeTruthy();
    const meta = JSON.parse(
      readFileSync(join(dir, metaFile!), "utf8")
    ) as BackupMetadata;
    expect(meta.status).toBe("FAILED");
  });

  it("4. missing artifact => FAIL", () => {
    expect(() => assertArtifactNonEmpty(join(dir, "nope.dump"))).toThrow(
      /does not exist/
    );
  });

  it("5-7. SHA-256 generate / verify / mismatch", async () => {
    const artifact = join(dir, "t.dump");
    writeFakePgDump(artifact, "body-a");
    const hash = await sha256File(artifact);
    const checksum = join(dir, "t.dump.sha256");
    await writeChecksumFile(checksum, hash, "t.dump");
    const ok = await verifyChecksum(artifact, checksum);
    expect(ok.ok).toBe(true);

    writeFakePgDump(artifact, "body-b-modified");
    const bad = await verifyChecksum(artifact, checksum);
    expect(bad.ok).toBe(false);
  });

  it("8. valid PostgreSQL magic => PASS", async () => {
    const artifact = join(dir, "ok.dump");
    writeFakePgDump(artifact);
    await expect(assertPgCustomFormatMagic(artifact)).resolves.toBeUndefined();
  });

  it("9. corrupt archive => FAIL", async () => {
    const artifact = join(dir, "bad.dump");
    writeFileSync(artifact, "NOTPG");
    await expect(assertPgCustomFormatMagic(artifact)).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_FORMAT",
    });
  });

  it("10. restore into isolated target (injected) => PASS", async () => {
    const created = await createBackup(baseCreate());

    const result = await restoreVerify({
      backupId: created.metadata.backupId,
      cwd: dir,
      env: {
        ADLINKLAB_BACKUP_DIR: dir,
        DATABASE_URL: "postgresql://u:p@localhost:5432/src",
        ADLINKLAB_BACKUP_RESTORE_DATABASE_URL:
          "postgresql://u:p@localhost:5432/restore_iso",
        ADLINKLAB_BACKUP_ALLOW_RESTORE: "1",
      },
      tools,
      runPgRestoreList: fakeList,
      recreateTargetDatabase: false,
      runPgRestore: () => ({ status: 0, stderr: "" }),
      queryFn: async (sql) => {
        if (sql.includes("information_schema.tables")) {
          return [{ ok: 1 }];
        }
        if (sql.includes("FROM tenants")) {
          return [
            { id: "00000000-0000-4000-8000-000000000001" },
            { id: "00000000-0000-4000-8000-000000000002" },
          ];
        }
        return [];
      },
    });

    expect(result.schemaOk).toBe(true);
    expect(result.missingTables).toEqual([]);
    expect(result.dataVerification).toBe("passed");
    expect(result.tenantCount).toBe(2);
    expect(result.migrationMetadataPresent).toBe(true);
    expect(result.metadata.status).toBe("VERIFIED");
    expect(result.metadata.restoreVerifiedAt).toBeTruthy();
  });

  it("11. restore target equals production => FAIL CLOSED", () => {
    expect(() =>
      assertSafeRestoreTarget(
        "postgresql://u:p@localhost:5432/prod",
        "postgresql://u:p@localhost:5432/prod",
        { ADLINKLAB_BACKUP_ALLOW_RESTORE: "1" }
      )
    ).toThrow(/matches source/);
  });

  it("11b. restore without allow flag => FAIL", () => {
    expect(() =>
      assertSafeRestoreTarget(
        "postgresql://u:p@localhost:5432/prod",
        "postgresql://u:p@localhost:5432/other",
        {}
      )
    ).toThrow(/ADLINKLAB_BACKUP_ALLOW_RESTORE/);
  });

  it("12-15. core tables list matches Prisma map names", () => {
    expect(CORE_TABLES).toContain("tenants");
    expect(CORE_TABLES).toContain("url_versions");
    expect(CORE_TABLES).toContain("script_sync_logs");
    expect(CORE_TABLES).toContain("google_ads_script_integrations");
  });

  it("16. restore failure => overall FAIL", async () => {
    const created = await createBackup(baseCreate());

    await expect(
      restoreVerify({
        backupId: created.metadata.backupId,
        cwd: dir,
        env: {
          ADLINKLAB_BACKUP_DIR: dir,
          DATABASE_URL: "postgresql://u:p@localhost:5432/src",
          ADLINKLAB_BACKUP_RESTORE_DATABASE_URL:
            "postgresql://u:p@localhost:5432/restore_iso",
          ADLINKLAB_BACKUP_ALLOW_RESTORE: "1",
        },
        tools,
        runPgRestoreList: fakeList,
        recreateTargetDatabase: false,
        runPgRestore: () => ({ status: 1, stderr: "boom" }),
      })
    ).rejects.toMatchObject({ code: "PG_RESTORE_FAILED" });

    const meta = await readMetadata(
      pathsForBackupId(dir, created.metadata.backupId).metadataPath
    );
    expect(meta.status).toBe("FAILED");
  });

  it("17. FAILED backup never becomes VERIFIED via latest pointer", async () => {
    const failed: BackupMetadata = {
      backupId: "x",
      createdAt: new Date().toISOString(),
      format: "custom",
      sizeBytes: 0,
      sha256: "",
      status: "FAILED",
      artifactFile: "x.dump",
      checksumFile: "x.dump.sha256",
      error: "nope",
    };
    await expect(
      writeLatestPointer(join(dir, "latest-verified.json"), failed)
    ).rejects.toMatchObject({ code: "LATEST_REQUIRES_VERIFIED" });
  });

  it("18. only VERIFIED can become latest", async () => {
    const created = await createBackup(baseCreate());
    expect(existsSync(join(dir, "latest-verified.json"))).toBe(true);
    const latest = JSON.parse(
      readFileSync(join(dir, "latest-verified.json"), "utf8")
    ) as BackupMetadata;
    expect(latest.status).toBe("VERIFIED");
    expect(latest.backupId).toBe(created.metadata.backupId);
  });

  it("19. retention does not delete all valid backups", async () => {
    for (let i = 0; i < 3; i++) {
      await createBackup(
        baseCreate({
          updateLatest: false,
          runPgDump: (_b, _u, out) => {
            writeFakePgDump(out, `body-${i}-${Date.now()}`);
            return { status: 0, stderr: "" };
          },
        })
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    const result = await cleanupRetention({
      cwd: dir,
      env: { ADLINKLAB_BACKUP_DIR: dir, ADLINKLAB_BACKUP_KEEP: "1" },
      keep: 1,
    });
    expect(result.kept.length).toBe(1);
    expect(result.deleted.length).toBe(2);

    const again = await cleanupRetention({
      cwd: dir,
      env: { ADLINKLAB_BACKUP_DIR: dir },
      keep: 1,
    });
    expect(again.kept.length).toBe(1);
    expect(again.deleted.length).toBe(0);
  });

  it("20-21. secrets never in metadata / logs helpers", async () => {
    const created = await createBackup(
      baseCreate({
        env: {
          ADLINKLAB_BACKUP_DIR: dir,
          DATABASE_URL:
            "postgresql://secretuser:secretpass@localhost:5432/src",
        },
      })
    );
    const raw = readFileSync(
      pathsForBackupId(dir, created.metadata.backupId).metadataPath,
      "utf8"
    );
    expect(raw).not.toMatch(/secretpass/);
    expect(raw).not.toMatch(/secretuser/);
    expect(raw).not.toMatch(/postgresql:\/\//i);
    expect(raw).not.toMatch(/DATABASE_URL/);
    expect(createHash("sha256").update("x").digest("hex")).toHaveLength(64);
  });

  it("verifyBackup checksum mismatch marks FAILED", async () => {
    const created = await createBackup(
      baseCreate({
        runPgDump: (_b, _u, out) => {
          writeFakePgDump(out, "orig");
          return { status: 0, stderr: "" };
        },
      })
    );
    const paths = pathsForBackupId(dir, created.metadata.backupId);
    writeFakePgDump(paths.artifactPath, "tampered");
    await expect(
      verifyBackup({
        backupId: created.metadata.backupId,
        cwd: dir,
        env: { ADLINKLAB_BACKUP_DIR: dir },
        tools: null,
      })
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });

  it("buildBackupId is unique-ish", () => {
    const a = buildBackupId();
    const b = buildBackupId();
    expect(a).not.toBe(b);
  });

  it("empty dataset reports limited_empty", async () => {
    const created = await createBackup(baseCreate());
    const result = await restoreVerify({
      backupId: created.metadata.backupId,
      cwd: dir,
      env: {
        ADLINKLAB_BACKUP_DIR: dir,
        DATABASE_URL: "postgresql://u:p@localhost:5432/src",
        ADLINKLAB_BACKUP_RESTORE_DATABASE_URL:
          "postgresql://u:p@localhost:5432/restore_iso",
        ADLINKLAB_BACKUP_ALLOW_RESTORE: "1",
      },
      tools,
      runPgRestoreList: fakeList,
      recreateTargetDatabase: false,
      runPgRestore: () => ({ status: 0, stderr: "" }),
      queryFn: async (sql) => {
        if (sql.includes("information_schema")) {
          return [{ ok: 1 }];
        }
        if (sql.includes("FROM tenants")) return [];
        return [];
      },
    });
    expect(result.dataVerification).toBe("limited_empty");
  });
});

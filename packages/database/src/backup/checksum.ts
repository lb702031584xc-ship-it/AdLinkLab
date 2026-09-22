/**
 * Phase 9.4 — SHA-256 helpers (never log secrets).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function writeChecksumFile(
  checksumPath: string,
  sha256: string,
  artifactFileName: string
): Promise<void> {
  // GNU coreutils style: "<hash>  <filename>"
  await writeFile(checksumPath, `${sha256}  ${artifactFileName}\n`, "utf8");
}

export async function readChecksumFile(checksumPath: string): Promise<string> {
  const raw = await readFile(checksumPath, "utf8");
  const first = raw.trim().split(/\s+/)[0];
  if (!first || !/^[a-f0-9]{64}$/i.test(first)) {
    throw new Error("Invalid checksum file format");
  }
  return first.toLowerCase();
}

export async function verifyChecksum(
  artifactPath: string,
  checksumPath: string
): Promise<{ ok: true; sha256: string } | { ok: false; expected: string; actual: string }> {
  const expected = await readChecksumFile(checksumPath);
  const actual = await sha256File(artifactPath);
  if (expected !== actual) {
    return { ok: false, expected, actual };
  }
  return { ok: true, sha256: actual };
}

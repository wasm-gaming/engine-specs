/**
 * OPFS Asset Storage Helper for Engine Demo
 * Persists ROM and BIOS files in the Origin Private File System (OPFS) across page reloads.
 */

const DIR_NAME = "wasm-gaming-demo";

async function getStorageDir() {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR_NAME, { create: true });
  } catch (err) {
    console.warn("OPFS storage not accessible:", err);
    return null;
  }
}

/**
 * Save an asset File into OPFS.
 */
export async function saveStoredAsset(key, file) {
  const dir = await getStorageDir();
  if (!dir || !file) return;
  try {
    const fileHandle = await dir.getFileHandle(`${key}.bin`, { create: true });
    const writable = await fileHandle.createWritable();
    const bytes = await file.arrayBuffer();
    await writable.write(bytes);
    await writable.close();

    // Store file metadata
    const metaHandle = await dir.getFileHandle(`${key}.json`, { create: true });
    const metaWritable = await metaHandle.createWritable();
    await metaWritable.write(
      JSON.stringify({
        name: file.name,
        size: file.size || bytes.byteLength,
        type: file.type || "application/octet-stream",
        lastModified: file.lastModified || Date.now(),
      })
    );
    await metaWritable.close();
  } catch (err) {
    console.warn(`Failed to save ${key} in OPFS:`, err);
  }
}

/**
 * Retrieve a stored asset File from OPFS.
 */
export async function loadStoredAsset(key) {
  const dir = await getStorageDir();
  if (!dir) return null;
  try {
    const fileHandle = await dir.getFileHandle(`${key}.bin`);
    const metaHandle = await dir.getFileHandle(`${key}.json`);

    const fileObj = await fileHandle.getFile();
    const metaText = await (await metaHandle.getFile()).text();
    const meta = JSON.parse(metaText);

    const bytes = await fileObj.arrayBuffer();
    return new File([bytes], meta.name, {
      type: meta.type,
      lastModified: meta.lastModified,
    });
  } catch {
    // File or meta doesn't exist yet
    return null;
  }
}

/**
 * Clear a stored asset from OPFS.
 */
export async function clearStoredAsset(key) {
  const dir = await getStorageDir();
  if (!dir) return;
  try {
    await dir.removeEntry(`${key}.bin`);
  } catch {}
  try {
    await dir.removeEntry(`${key}.json`);
  } catch {}
}

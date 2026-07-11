const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
};

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

// RFC 1321. Hand-rolled because crypto.subtle does not offer MD5.
const MD5_K = Uint32Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const md5 = (bytes) => {
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bytes.length / 0x20000000), true);

  let [h0, h1, h2, h3] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const words = new Uint32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let j = 0; j < 16; j += 1) {
      words[j] = view.getUint32(offset + j * 4, true);
    }
    let [a, b, c, d] = [h0, h1, h2, h3];
    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + MD5_K[i] + words[g]) >>> 0;
      const rotated = (sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i]));
      [a, b, c, d] = [d, (b + rotated) >>> 0, b, c];
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
  }

  const digest = new DataView(new ArrayBuffer(16));
  digest.setUint32(0, h0, true);
  digest.setUint32(4, h1, true);
  digest.setUint32(8, h2, true);
  digest.setUint32(12, h3, true);
  return toHex(digest.buffer);
};

const sha = async (algorithm, buffer) => {
  // crypto.subtle only exists in secure contexts (https or localhost).
  if (!globalThis.crypto?.subtle) {
    return "unavailable (requires a secure context)";
  }
  return toHex(await crypto.subtle.digest(algorithm, buffer));
};

export const checksumAlgorithms = ["CRC32", "MD5", "SHA-1", "SHA-256"];

export async function computeChecksums(buffer) {
  const bytes = new Uint8Array(buffer);
  const [sha1, sha256] = await Promise.all([sha("SHA-1", buffer), sha("SHA-256", buffer)]);
  return [
    { label: "CRC32", value: crc32(bytes) },
    { label: "MD5", value: md5(bytes) },
    { label: "SHA-1", value: sha1 },
    { label: "SHA-256", value: sha256 },
  ];
}

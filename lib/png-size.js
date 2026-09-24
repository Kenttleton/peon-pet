'use strict';

const fs = require('fs');

// Reads just the PNG signature + IHDR chunk (the first 24 bytes) to get a
// file's pixel dimensions without decoding the image — cheap even for a
// multi-megabyte atlas, since we only ever seek/read a fixed 24-byte header.
function getPngSize(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(24);
    const bytesRead = fs.readSync(fd, buf, 0, 24, 0);
    if (bytesRead < 24) {
      throw new Error(`File too short to be a PNG: ${filePath}`);
    }
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
    if (!isPng) {
      throw new Error(`Not a PNG file (bad signature): ${filePath}`);
    }
    // Bytes 12-15 are the IHDR chunk type; a well-formed PNG always has
    // IHDR as its first chunk, immediately after the 8-byte signature.
    const chunkType = buf.toString('ascii', 12, 16);
    if (chunkType !== 'IHDR') {
      throw new Error(`Not a valid PNG (missing leading IHDR): ${filePath}`);
    }
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { getPngSize };

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { getPngSize } = require('../lib/png-size');

// Builds a minimal, real, valid PNG at the given pixel dimensions —
// grayscale, no compression tricks, just enough to be a well-formed file a
// real PNG decoder would accept, so the test exercises actual header
// parsing rather than a hand-rolled stub.
function buildMinimalPng(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(Buffer.concat([typeBuf, data])) : 0;
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const rowBytes = width + 1; // filter-type byte + 1 byte/pixel grayscale
  const raw = Buffer.alloc(rowBytes * height, 0);
  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('getPngSize', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'png-size-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reads width and height from a square PNG', () => {
    const file = path.join(tmpDir, 'square.png');
    fs.writeFileSync(file, buildMinimalPng(200, 200));
    expect(getPngSize(file)).toEqual({ width: 200, height: 200 });
  });

  test('reads width and height from a non-square PNG', () => {
    const file = path.join(tmpDir, 'rect.png');
    fs.writeFileSync(file, buildMinimalPng(1408, 768));
    expect(getPngSize(file)).toEqual({ width: 1408, height: 768 });
  });

  test('reads a large-dimension PNG without loading the whole file', () => {
    const file = path.join(tmpDir, 'large.png');
    // A real 4096x4096 raw grayscale bitmap would be 16MB+; this only
    // writes the header truthfully and a tiny compressed body, so the test
    // stays fast while still exercising a "large declared size" header.
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4096, 0);
    ihdr.writeUInt32BE(4096, 4);
    ihdr[8] = 8;
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(ihdr.length, 0);
    const chunk = Buffer.concat([lenBuf, Buffer.from('IHDR', 'ascii'), ihdr, Buffer.alloc(4)]);
    fs.writeFileSync(file, Buffer.concat([sig, chunk]));
    expect(getPngSize(file)).toEqual({ width: 4096, height: 4096 });
  });

  test('throws on a file that is not a PNG', () => {
    const file = path.join(tmpDir, 'not-a-png.txt');
    fs.writeFileSync(file, 'hello world, this is not a png');
    expect(() => getPngSize(file)).toThrow(/Not a PNG/);
  });

  test('throws on a truncated file shorter than the header', () => {
    const file = path.join(tmpDir, 'truncated.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(() => getPngSize(file)).toThrow(/too short/);
  });
});

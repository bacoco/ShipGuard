// Bounded source access shared by repository reads and citation validation.
import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
const BYTE_LIMIT = 1024 * 1024;
export function sourceLines(file, end) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Source must be a regular file');
    const chunks = []; let used = 0, lines = 0;
    while (used <= BYTE_LIMIT) {
      const buffer = Buffer.alloc(Math.min(65536, BYTE_LIMIT + 1 - used));
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      let take = count;
      for (let i = 0; i < count; i++) if (buffer[i] === 10 && ++lines === end) { take = i + 1; break; }
      used += take;
      if (used > BYTE_LIMIT) throw new Error('Source read exceeds 1 MiB byte limit');
      chunks.push(buffer.subarray(0, take));
      if (lines === end) break;
    }
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/).slice(0, end);
  } finally { closeSync(fd); }
}

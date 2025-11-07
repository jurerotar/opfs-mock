import { beforeEach, describe, expect, test } from 'vitest';
import { resetMockOPFS, storageFactory } from './index';

describe('OPFS', () => {
  beforeEach(() => {
    resetMockOPFS();
  });

  test('should have getDirectory function available', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    expect(rootDirectory).toBeDefined();
  });

  test('should append data to an existing file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    const fileHandle = await rootDirectory.getFileHandle('appendFile.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write(new TextEncoder().encode('Hello'));
    await writeHandle.write(new TextEncoder().encode(' World!'));
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Hello World!');
  });

  test('should create a directory and add a file to it', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    const dirHandle = await rootDirectory.getDirectoryHandle('subDir', { create: true });
    const fileHandle = await dirHandle.getFileHandle('fileInDir.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write(new TextEncoder().encode('Test content'));
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Test content');
  });

  test('should remove a file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    const fileHandle = await rootDirectory.getFileHandle('testFileToRemove.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();
    await writeHandle.write(new TextEncoder().encode('This will be removed'));

    await rootDirectory.removeEntry('testFileToRemove.txt');

    await expect(rootDirectory.getFileHandle('testFileToRemove.txt')).rejects.toThrow('File not found: testFileToRemove.txt');
  });

  test('should remove a directory', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    const dirHandle = await rootDirectory.getDirectoryHandle('dirToRemove', { create: true });
    await dirHandle.getFileHandle('fileInDir.txt', { create: true });

    await rootDirectory.removeEntry('dirToRemove', { recursive: true });

    await expect(rootDirectory.getDirectoryHandle('dirToRemove')).rejects.toThrowError(
      new DOMException('Directory not found: dirToRemove', 'NotFoundError'),
    );
  });

  test('should list all files and directories', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    await rootDirectory.getDirectoryHandle('dir1', { create: true });
    await rootDirectory.getFileHandle('file1.txt', { create: true });

    const keysIterator = rootDirectory.keys();

    const keys = [];
    for await (const key of keysIterator) {
      keys.push(key);
    }

    expect(keys).toEqual(['file1.txt', 'dir1']);
  });

  test('should throw an error when trying to get a non-existing file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    await expect(rootDirectory.getFileHandle('nonExistingFile.txt')).rejects.toThrowError(
      new DOMException('File not found: nonExistingFile.txt', 'NotFoundError'),
    );
  });

  // https://github.com/jurerotar/opfs-mock/issues/1
  test('should overwrite an existing file when creating a new writable stream', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('testFile.txt', { create: true });

    const writable1 = await fileHandle.createWritable();
    await writable1.write('content 1');
    await writable1.close();

    const writable2 = await fileHandle.createWritable();
    await writable2.write(new TextEncoder().encode('content 2'));
    await writable2.close();

    const file = await fileHandle.getFile();

    expect(await file.text()).toBe('content 2');
  });

  test('should seek to the correct position and write from there', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('seekTest.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Hello, ');
    await writeHandle.seek(7);
    await writeHandle.write('World!');
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Hello, World!');
  });

  test('should not change file if truncated to the same size', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('truncateSameSize.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Unchanged content');
    await writeHandle.truncate(17);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Unchanged content');
  });

  test('should extend file size when truncating to a larger size', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('truncateExtend.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Short text');
    await writeHandle.truncate(20);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe(`Short text${'\0'.repeat(10)}`);
  });

  test('should abort a writable stream successfully', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('abortTest.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Initial content');
    await writeHandle.abort('Reason');

    await expect(writeHandle.write('More content')).rejects.toThrow('Reason');
  });

  test('should throw error when writing to a closed writable stream', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('closedTest.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Some content');
    await writeHandle.close();

    await expect(writeHandle.write('New content')).rejects.toThrowError('Cannot write to a CLOSED writable stream');
  });

  test('should write a string to the file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeString.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Hello, World!');
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Hello, World!');
  });

  test('should write a Blob to the file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeBlob.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    const blob = new Blob(['Blob content'], { type: 'text/plain' });
    await writeHandle.write(blob);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Blob content');
  });

  test('should write an ArrayBuffer to the file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeBuffer.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    const buffer = new TextEncoder().encode('Buffer content');
    await writeHandle.write(buffer);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Buffer content');
  });

  test('should write using WriteParams with position', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeParams.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Start');
    await writeHandle.write({ data: ' Inserted ', position: 5, type: 'write' });
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Start Inserted ');
  });

  test('should throw error on undefined write data', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeError.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    // @ts-expect-error: We're testing undefined behavior specifically
    await expect(writeHandle.write(undefined)).rejects.toThrow('Cannot write undefined data to the stream');
  });

  test('should throw error on invalid position in WriteParams', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeInvalidPosition.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await expect(writeHandle.write({ data: 'Data', position: -1, type: 'write' })).rejects.toThrow(
      'Invalid position value in write parameters',
    );
  });

  test('should throw error on invalid size in WriteParams', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeInvalidSize.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await expect(writeHandle.write({ data: 'Data', size: -5, type: 'write' })).rejects.toThrow('Invalid size value in write parameters');
  });

  test('should overwrite content when writing at a specific position', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('overwriteTest.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Hello, World!');
    await writeHandle.seek(7);
    await writeHandle.write('Universe!');
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Hello, Universe!');
  });

  test('should handle large file writes', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('largeFile.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    const largeData = 'A'.repeat(1024 * 1024); // 1MB of 'A's
    await writeHandle.write(largeData);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect((await file.text()).length).toBe(1024 * 1024);
  });

  test('should handle writing an empty file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('emptyFile.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('');
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('');
  });

  test('should truncate file to zero size', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('truncateZero.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('This content will be removed.');
    await writeHandle.truncate(0);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('');
  });

  test('should truncate file in the middle of the content', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('truncateMiddle.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Keep this part. Remove this part.');
    await writeHandle.truncate(15);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Keep this part.');
  });

  test('should not commit data if the stream is aborted before closing', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('abortMidWrite.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Partial content');
    await writeHandle.abort();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe(''); // No content should be written
  });

  test('should handle multiple concurrent writes correctly', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('concurrentWrites.txt', { create: true });

    const writer1 = await fileHandle.createWritable();
    await writer1.write('First write');
    await writer1.close();

    const writer2 = await fileHandle.createWritable();
    await writer2.write('Second write');
    await writer2.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Second write'); // Last writer
  });

  test('should not allow writing after aborting a stream', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('writeAfterAbort.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Initial content');
    await writeHandle.abort();

    await expect(writeHandle.write('More content')).rejects.toThrow();
  });

  test('should clear file when truncating to zero after writing', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('truncateZeroAfterWrite.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Will be removed');
    await writeHandle.truncate(0);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('');
  });

  test('should report correct file size after writing', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('sizeCheck.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('12345');
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(file.size).toBe(5);
  });

  test('should preserve file name after creation', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('nameTest.txt', { create: true });

    expect(fileHandle.name).toBe('nameTest.txt');
  });

  test('should not return old content after truncation', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('truncateRead.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Old content here');
    await writeHandle.truncate(4);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Old ');
  });

  test('should handle writing different data types sequentially', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('multiData.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write('Text-');
    await writeHandle.write(new Blob(['BlobData'], { type: 'text/plain' }));
    await writeHandle.write(new Uint8Array([65, 66, 67])); // ABC
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Text-BlobDataABC');
  });

  test('should write a large blob to the file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('largeBlob.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    const largeBlob = new Blob(['A'.repeat(2 * 1024 * 1024)], { type: 'text/plain' }); // 2MB Blob
    await writeHandle.write(largeBlob);
    await writeHandle.close();

    const file = await fileHandle.getFile();
    expect(file.size).toBe(2 * 1024 * 1024);
  });

  test('should iterate over directory entries using async iterator', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    await rootDirectory.getFileHandle('file1.txt', { create: true });
    await rootDirectory.getFileHandle('file2.txt', { create: true });
    await rootDirectory.getDirectoryHandle('subDir', { create: true });

    const entries = [];
    for await (const [name, handle] of rootDirectory) {
      entries.push({ name, kind: handle.kind });
    }

    expect(entries).toContainEqual({ name: 'file1.txt', kind: 'file' });
    expect(entries).toContainEqual({ name: 'file2.txt', kind: 'file' });
    expect(entries).toContainEqual({ name: 'subDir', kind: 'directory' });
  });

  test('should iterate over directory keys', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    await rootDirectory.getFileHandle('file1.txt', { create: true });
    await rootDirectory.getDirectoryHandle('subDir', { create: true });

    const keys = [];
    for await (const key of rootDirectory.keys()) {
      keys.push(key);
    }

    expect(keys).toContain('file1.txt');
    expect(keys).toContain('subDir');
  });

  test('should iterate over directory values', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    await rootDirectory.getFileHandle('file1.txt', { create: true });
    await rootDirectory.getDirectoryHandle('subDir', { create: true });

    const values = [];
    for await (const value of rootDirectory.values()) {
      values.push(value.kind);
    }

    expect(values).toContain('file');
    expect(values).toContain('directory');
  });

  test('should iterate over directory entries using entries()', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    await rootDirectory.getFileHandle('file1.txt', { create: true });
    await rootDirectory.getDirectoryHandle('subDir', { create: true });

    const entries = [];
    for await (const [name, handle] of rootDirectory.entries()) {
      entries.push({ name, kind: handle.kind });
    }

    expect(entries).toContainEqual({ name: 'file1.txt', kind: 'file' });
    expect(entries).toContainEqual({ name: 'subDir', kind: 'directory' });
  });

  test('should resolve correct paths', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const subDir = await rootDirectory.getDirectoryHandle('subDir', { create: true });
    const fileHandle = await subDir.getFileHandle('fileInSubDir.txt', { create: true });

    const resolvedPath = await rootDirectory.resolve(fileHandle);
    expect(resolvedPath).toEqual(['subDir', 'fileInSubDir.txt']);
  });

  test('should overwrite file content when keepExistingData is false (default)', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('testFile.txt', { create: true });

    // First write
    let writer = await fileHandle.createWritable({ keepExistingData: false });
    await writer.write('Initial Content');
    await writer.close();

    // Second write (should overwrite previous content)
    writer = await fileHandle.createWritable({ keepExistingData: false });
    await writer.write('New Content');
    await writer.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('New Content');
  });

  test('should preserve file content when keepExistingData is true', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('testFilePreserve.txt', { create: true });

    // First write
    let writer = await fileHandle.createWritable({ keepExistingData: true });
    await writer.write('Initial Content');
    await writer.close();

    // Second write (should append to previous content)
    writer = await fileHandle.createWritable({ keepExistingData: true });
    await writer.write(' - Appended Content');
    await writer.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Initial Content - Appended Content');
  });

  test('should allow modifying existing content when keepExistingData is true', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('testFileModify.txt', { create: true });

    // Initial write
    let writer = await fileHandle.createWritable({ keepExistingData: true });
    await writer.write('Hello World');
    await writer.close();

    // Modify part of the content
    writer = await fileHandle.createWritable({ keepExistingData: true });
    await writer.seek(6);
    await writer.write('Universe');
    await writer.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Hello Universe');
  });

  test('should return default quota and usage', async () => {
    const storage = storageFactory();
    const estimate = await storage.estimate();
    expect(estimate.quota).toBe(1024 * 1024 * 1024); // 1GB
    expect(estimate.usage).toBe(0);
  });

  test('should include predefined usage', async () => {
    const storage = storageFactory({ usage: 5000 });
    const estimate = await storage.estimate();
    expect(estimate.usage).toBeGreaterThanOrEqual(5000);
  });

  test('should reflect directory size in usage estimate', async () => {
    const storage = storageFactory();
    const rootDir = await storage.getDirectory();
    const fileHandle = await rootDir.getFileHandle('testFile.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('Some content');
    await writer.close();

    const estimate = await storage.estimate();

    expect(estimate.usage).toBeGreaterThan(0);
  });

  test('should allow writing after an aborted stream is closed and reopened', async () => {
    const storage = storageFactory();
    const rootDir = await storage.getDirectory();
    const fileHandle = await rootDir.getFileHandle('reopenTest.txt', { create: true });
    let writer = await fileHandle.createWritable();

    await writer.write('Initial content');
    await writer.abort();

    writer = await fileHandle.createWritable();
    await writer.write('New content');
    await writer.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('New content');
  });

  test('should verify that abort does not affect existing file content', async () => {
    const storage = storageFactory();
    const rootDir = await storage.getDirectory();
    const fileHandle = await rootDir.getFileHandle('persistedContent.txt', { create: true });
    let writer = await fileHandle.createWritable();
    await writer.write('Persistent content');
    await writer.close();

    writer = await fileHandle.createWritable();
    await writer.write('Temporary data');
    await writer.abort();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Persistent content');
  });

  test('should not allow closing an already closed writable stream', async () => {
    const storage = storageFactory();
    const rootDir = await storage.getDirectory();
    const fileHandle = await rootDir.getFileHandle('doubleCloseTest.txt', { create: true });
    const writer = await fileHandle.createWritable();

    await writer.write('Some content');
    await writer.close();
    await expect(writer.close()).rejects.toThrow('Cannot close a CLOSED writable stream');
  });

  test('should allow closing an unwritten writable stream', async () => {
    const storage = storageFactory();
    const rootDir = await storage.getDirectory();
    const fileHandle = await rootDir.getFileHandle('emptyClose.txt', { create: true });
    const writer = await fileHandle.createWritable();

    await writer.close(); // Should succeed without error

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe(''); // File should remain empty
  });

  test('should read file contents into a Uint8Array buffer', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('readUint8.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('hello world');
    await writer.close();

    const accessHandle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array(11); // same length as written string

    const bytesRead = accessHandle.read(buffer);

    expect(bytesRead).toBe(11);
    expect(new TextDecoder().decode(buffer)).toBe('hello world');

    accessHandle.close();
  });

  test('should read from a specific offset into a Uint8Array', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('readOffset.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('abcdefghij');
    await writer.close();

    const accessHandle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array(5);

    const bytesRead = accessHandle.read(buffer, { at: 3 });

    expect(bytesRead).toBe(5);
    expect(new TextDecoder().decode(buffer)).toBe('defgh');

    accessHandle.close();
  });

  test('should read file contents into a DataView buffer', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('readDataView.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('1234567890');
    await writer.close();

    const accessHandle = await fileHandle.createSyncAccessHandle();
    const arrayBuffer = new ArrayBuffer(10);
    const dataView = new DataView(arrayBuffer);

    const bytesRead = accessHandle.read(dataView);

    expect(bytesRead).toBe(10);

    const resultString = new TextDecoder().decode(new Uint8Array(arrayBuffer));
    expect(resultString).toBe('1234567890');

    accessHandle.close();
  });

  test('should return 0 if reading past the end of the file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    const fileHandle = await rootDirectory.getFileHandle('readPastEOF.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('short');
    await writer.close();

    const accessHandle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array(10);

    const bytesRead = accessHandle.read(buffer, { at: 100 });

    expect(bytesRead).toBe(0);
    expect(new TextDecoder().decode(buffer)).toBe('\0'.repeat(10)); // still empty buffer

    accessHandle.close();
  });

  test('should return 0 when reading from the end of the file', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('readEnd.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('abcde');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array(10);

    const bytesRead = handle.read(buffer, { at: 5 }); // file length
    expect(bytesRead).toBe(0);

    handle.close();
  });

  test('should return partial bytes when reading near end of file', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('readPartial.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('abcdef');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array(4);

    const bytesRead = handle.read(buffer, { at: 4 });
    expect(bytesRead).toBe(2);
    expect(new TextDecoder().decode(buffer.subarray(0, 2))).toBe('ef');

    handle.close();
  });

  test('should return 0 when buffer is empty', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('readEmptyBuffer.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('some content');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array(0);

    const bytesRead = handle.read(buffer);
    expect(bytesRead).toBe(0);

    handle.close();
  });

  test('should throw when access handle is closed', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('readAfterClose.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('data');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    handle.close();

    const buffer = new Uint8Array(5);
    // DOMException name is 'InvalidStateError'; message may vary. Assert robustly.
    expect(() => handle.read(buffer)).toThrowError(DOMException);
    try {
      handle.read(buffer);
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe('InvalidStateError');
      expect((e as DOMException).message).toBe('The access handle is closed');
    }
  });

  test('should overwrite buffer contents', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('overwriteBuffer.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('hello');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array([1, 1, 1, 1, 1]);

    const bytesRead = handle.read(buffer);
    expect(bytesRead).toBe(5);
    expect(Array.from(buffer)).toEqual(Array.from(new TextEncoder().encode('hello')));

    handle.close();
  });

  test('should support multiple sequential reads', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('sequentialReads.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('abcdef');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();

    const part1 = new Uint8Array(3);
    const part2 = new Uint8Array(3);

    const bytesRead1 = handle.read(part1, { at: 0 });
    const bytesRead2 = handle.read(part2, { at: 3 });

    expect(bytesRead1).toBe(3);
    expect(bytesRead2).toBe(3);
    expect(new TextDecoder().decode(part1)).toBe('abc');
    expect(new TextDecoder().decode(part2)).toBe('def');

    handle.close();
  });

  test('should correctly read non-ASCII characters', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('unicodeRead.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('💖✨'); // 7 bytes UTF-8
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array(7);

    const bytesRead = handle.read(buffer);
    expect(bytesRead).toBe(7);

    const result = new TextDecoder().decode(buffer);
    expect(result).toBe('💖✨');

    handle.close();
  });

  test('should correctly read into DataView with offset', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('dataViewOffset.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('xyzabc');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    const buffer = new ArrayBuffer(10);
    const dataView = new DataView(buffer, 2, 6); // Write starting at offset 2

    const bytesRead = handle.read(dataView);
    expect(bytesRead).toBe(6);

    const decoded = new TextDecoder().decode(new Uint8Array(buffer));
    expect(decoded.slice(2, 8)).toBe('xyzabc');

    handle.close();
  });

  test('should write and read UTF-8 string via sync handle', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('utf8.txt', { create: true });
    const sync = await handle.createSyncAccessHandle();

    const encoded = new TextEncoder().encode('💖✨');
    sync.write(encoded);
    const buffer = new Uint8Array(encoded.length);
    sync.read(buffer);

    expect(new TextDecoder().decode(buffer)).toBe('💖✨');
    sync.close();
  });

  test('should write and read raw binary data', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('binary.dat', { create: true });
    const sync = await handle.createSyncAccessHandle();

    const data = new Uint8Array([0, 255, 1, 128]);
    sync.write(data);
    const buffer = new Uint8Array(4);
    sync.read(buffer);

    expect(Array.from(buffer)).toEqual([0, 255, 1, 128]);
    sync.close();
  });

  test('should pad file with 0s when writing beyond current end', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('pad.txt', { create: true });
    const sync = await handle.createSyncAccessHandle();

    sync.write(new Uint8Array([42]), { at: 5 });
    const buffer = new Uint8Array(6);
    sync.read(buffer);

    expect(Array.from(buffer)).toEqual([0, 0, 0, 0, 0, 42]);
    sync.close();
  });

  test('should truncate file to smaller size', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('truncate-small.txt', { create: true });
    const sync = await handle.createSyncAccessHandle();

    sync.write(new TextEncoder().encode('hello world'));
    sync.truncate(5);
    const buffer = new Uint8Array(5);
    sync.read(buffer);

    expect(new TextDecoder().decode(buffer)).toBe('hello');
    sync.close();
  });

  test('should truncate file to larger size and pad with 0s', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('truncate-large.txt', { create: true });
    const sync = await handle.createSyncAccessHandle();

    sync.write(new TextEncoder().encode('abc'));
    sync.truncate(6);
    const buffer = new Uint8Array(6);
    sync.read(buffer);

    expect(Array.from(buffer)).toEqual([97, 98, 99, 0, 0, 0]); // 'a','b','c',0,0,0
    sync.close();
  });

  test('should support seek and write with writable stream', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('seek.txt', { create: true });
    const stream = await handle.createWritable();

    await stream.write('abc');
    await stream.seek(1);
    await stream.write('Z');
    await stream.close();

    const file = await handle.getFile();
    expect(await file.text()).toBe('aZc');
  });

  test('should truncate file inside writable stream', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('stream-truncate.txt', { create: true });
    const stream = await handle.createWritable();

    await stream.write('abcdef');
    await stream.truncate(3);
    await stream.close();

    const file = await handle.getFile();
    expect(await file.text()).toBe('abc');
  });

  test('should write string, ArrayBuffer, Blob, and DataView', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('mixed.txt', { create: true });
    const stream = await handle.createWritable();

    await stream.write('X');
    await stream.write(new Uint8Array([89])); // Y
    await stream.write(new Blob(['Z']));
    const buf = new ArrayBuffer(1);
    new DataView(buf).setUint8(0, 87); // W
    await stream.write(buf);

    await stream.close();

    const file = await handle.getFile();
    expect(await file.text()).toBe('XYZW');
  });

  test('should abort writable stream and prevent further writes', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('abort.txt', { create: true });
    const stream = await handle.createWritable();

    await stream.write('start');
    await stream.abort('oops');

    await expect(stream.write('fail')).rejects.toThrow();
    await expect(stream.close()).rejects.toThrow();
  });

  test('should throw on writing to closed stream', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('closed.txt', { create: true });
    const stream = await handle.createWritable();

    await stream.write('abc');
    await stream.close();

    await expect(stream.write('x')).rejects.toThrow();
    await expect(stream.close()).rejects.toThrow();
  });

  test('should write using a DataView with byte offset and length', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('dataview-partial.txt', { create: true });
    const stream = await handle.createWritable();

    const buf = new ArrayBuffer(6);
    const view = new Uint8Array(buf);
    view.set([65, 66, 67, 68, 69, 70]); // ABCDEF

    const partial = new DataView(buf, 2, 3); // CDE
    await stream.write(partial);
    await stream.close();

    const file = await handle.getFile();
    expect(await file.text()).toBe('CDE');
  });

  test('should seek beyond file length and write with padding', async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('seek-beyond.txt', { create: true });
    const stream = await handle.createWritable();

    await stream.seek(5);
    await stream.write('X');
    await stream.close();

    const file = await handle.getFile();
    expect(await file.text()).toBe('\0\0\0\0\0X'); // padded with 5 nulls
  });

  test('should resolve nested directory path with resolve()', async () => {
    const root = await navigator.storage.getDirectory();
    const dir1 = await root.getDirectoryHandle('dir1', { create: true });
    const dir2 = await dir1.getDirectoryHandle('dir2', { create: true });
    const file = await dir2.getFileHandle('nested.txt', { create: true });

    const resolvedPath = await root.resolve(file);
    expect(resolvedPath).toEqual(['dir1', 'dir2', 'nested.txt']);
  });

  test('should read into buffer at non-zero offset', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('nonzero-read.txt', { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write('abcde');
    await writer.close();

    const handle = await fileHandle.createSyncAccessHandle();
    const buffer = new Uint8Array([0, 0, 0, 0, 0, 0, 0]);

    // Create DataView into buffer at offset 2, length 3
    const view = new DataView(buffer.buffer, 2, 3);
    const bytesRead = handle.read(view);

    expect(bytesRead).toBe(3);
    expect(Array.from(buffer)).toEqual([0, 0, 'a'.charCodeAt(0), 'b'.charCodeAt(0), 'c'.charCodeAt(0), 0, 0]);

    handle.close();
  });

  test('should accept WriteParams with .size field (even if unused)', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('write-with-size.txt', { create: true });
    const writer = await fileHandle.createWritable();

    await writer.write({ data: 'test', size: 4, type: 'write' });
    await writer.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('test');
  });

  test('should write from Uint8Array with byteOffset and byteLength', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('u8-slice.txt', { create: true });
    const stream = await fileHandle.createWritable();

    const buffer = new Uint8Array([88, 89, 90, 91, 92]); // XYZ[...]
    const slice = new Uint8Array(buffer.buffer, 1, 3); // 89, 90, 91 = YZ[

    await stream.write(slice);
    await stream.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('YZ[');
  });

  test('should write from Int16Array with correct offset', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('int16-slice.txt', { create: true });
    const stream = await fileHandle.createWritable();

    const int16 = new Int16Array([65, 66, 67, 68]); // ABCD in UTF-16
    const slice = new Uint8Array(int16.buffer, 2, 4); // slice from byte offset 2 (partial code unit)

    await stream.write(slice); // technically may decode oddly
    await stream.close();

    const file = await fileHandle.getFile();
    // We're not asserting decoded string here — just checking no error and correct length
    expect(file.size).toBe(4);
  });

  test('should write WriteParams with Uint8Array respecting position', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('writeparams-u8.txt', { create: true });
    const stream = await fileHandle.createWritable();

    await stream.write('12345');
    await stream.write({ type: 'write', data: new Uint8Array([65, 66]), position: 2 }); // overwrite at pos 2 with AB
    await stream.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('12AB5');
  });

  test('should write WriteParams with ArrayBuffer slice', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('writeparams-buf.txt', { create: true });
    const stream = await fileHandle.createWritable();

    const fullBuf = new TextEncoder().encode('HELLO_WORLD').buffer;
    const slice = fullBuf.slice(6, 11) as ArrayBuffer;

    await stream.write({ type: 'write', data: slice, position: 0 });
    await stream.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('WORLD');
  });

  test('should write WriteParams with sliced Blob', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('writeparams-blob.txt', { create: true });
    const stream = await fileHandle.createWritable();

    const blob = new Blob(['ABCDEFG']);
    const sliced = blob.slice(2, 5); // 'CDE'

    await stream.write({ type: 'write', data: sliced });
    await stream.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('CDE');
  });

  test('should write WriteParams with sliced DataView', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('writeparams-dataview.txt', { create: true });
    const stream = await fileHandle.createWritable();

    const base = new TextEncoder().encode('ABCDEFGHIJ').buffer;
    const dv = new DataView(base, 3, 4); // 'DEFG'

    await stream.write({ type: 'write', data: dv, position: 0 });
    await stream.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('DEFG');
  });

  test('should truncate file using WriteParams with type "truncate"', async () => {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('truncate-via-write.txt', { create: true });
    const stream = await fileHandle.createWritable();

    await stream.write('This will be truncated');
    await stream.write({ type: 'truncate', size: 4 });
    await stream.close();

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('This');
  });

  test('getFileHandle rejects with NotFoundError when file is missing', async () => {
    const storage = storageFactory();
    const rootDir = await storage.getDirectory();

    // call once and assert the rejection details
    const p = rootDir.getFileHandle('missing-file.txt'); // this promise should reject

    // Basic: assert rejected promise is a DOMException
    await expect(p).rejects.toBeInstanceOf(DOMException);

    // Inspect the rejection object properties
    await expect(p).rejects.toHaveProperty('name', 'NotFoundError');
    await expect(p).rejects.toHaveProperty('message');
    // Optionally assert the filename appears in the message
    await expect(p).rejects.toHaveProperty('message', expect.stringContaining('missing-file.txt'));
  });

  test('TypeMismatchError when name clashes between file and directory', async () => {
    const root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle('clash', { create: true });
    await expect(root.getFileHandle('clash', { create: true })).rejects.toThrowError(
      new DOMException('A directory with the same name exists: clash', 'TypeMismatchError'),
    );

    const root2 = await navigator.storage.getDirectory();
    await root2.getFileHandle('clash2', { create: true });
    await expect(root2.getDirectoryHandle('clash2', { create: true })).rejects.toThrowError(
      new DOMException('A file with the same name exists: clash2', 'TypeMismatchError'),
    );
  });

  test('WritableStream getWriter().write() writes to file', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('writer-path.txt', { create: true });
    const stream = await fh.createWritable();
    const writer = stream.getWriter();
    await writer.write('hello');
    writer.releaseLock();
    await stream.close();

    const file = await fh.getFile();
    expect(await file.text()).toBe('hello');
  });

  test('Blob binary data is preserved (no text coercion)', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('binary.bin', { create: true });
    const stream = await fh.createWritable();
    const bytes = new Uint8Array([0, 255, 1, 128]);
    const blob = new Blob([bytes]);
    await stream.write(blob);
    await stream.close();
    const file = await fh.getFile();
    const ab = await file.arrayBuffer();
    expect(Array.from(new Uint8Array(ab))).toEqual([0, 255, 1, 128]);
  });

  test('write() param variants: seek, write, truncate', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('params.txt', { create: true });
    const stream = await fh.createWritable();

    await stream.write('abc');
    await stream.write({ type: 'seek', position: 1 });
    await stream.write({ type: 'write', data: 'Z' });
    await stream.write({ type: 'truncate', size: 2 });
    await stream.close();

    const file = await fh.getFile();
    expect(await file.text()).toBe('aZ');
  });

  test('createSyncAccessHandle enforces exclusive lock', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('lock.txt', { create: true });
    const h1 = await fh.createSyncAccessHandle();
    await expect(fh.createSyncAccessHandle()).rejects.toThrowError(
      new DOMException('A sync access handle is already open for this file', 'InvalidStateError'),
    );
    h1.close();
    // Can open again after close
    const h2 = await fh.createSyncAccessHandle();
    h2.close();
  });

  test('isSameEntry uses identity, not name', async () => {
    const root = await navigator.storage.getDirectory();
    const a = await root.getDirectoryHandle('a', { create: true });
    const b = await root.getDirectoryHandle('b', { create: true });
    const fxA = await a.getFileHandle('x', { create: true });
    const fxB = await b.getFileHandle('x', { create: true });

    // Same handle retrieved twice should be same entry
    const fxA2 = await a.getFileHandle('x');
    expect(await fxA.isSameEntry(fxA2)).toBe(true);

    // Different parents, same name -> not same entry
    expect(await fxA.isSameEntry(fxB)).toBe(false);
  });

  test('removeEntry: empty directory can be removed; non-empty needs recursive', async () => {
    const root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle('empty', { create: true });
    await root.removeEntry('empty');
    await expect(root.getDirectoryHandle('empty')).rejects.toThrowError(new DOMException('Directory not found: empty', 'NotFoundError'));

    const nonempty = await root.getDirectoryHandle('nonempty', { create: true });
    await nonempty.getFileHandle('f', { create: true });
    await expect(root.removeEntry('nonempty')).rejects.toThrowError(
      new DOMException('The directory is not empty', 'InvalidModificationError'),
    );

    await root.removeEntry('nonempty', { recursive: true });
    await expect(root.getDirectoryHandle('nonempty')).rejects.toThrowError(
      new DOMException('Directory not found: nonempty', 'NotFoundError'),
    );
  });

  test('queryPermission/requestPermission are granted', async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('perm', { create: true });
    const file = await dir.getFileHandle('f.txt', { create: true });

    expect(await dir.queryPermission({ mode: 'read' })).toBe('granted');
    expect(await dir.requestPermission({ mode: 'readwrite' })).toBe('granted');
    expect(await file.queryPermission({ mode: 'read' })).toBe('granted');
    expect(await file.requestPermission({ mode: 'readwrite' })).toBe('granted');
  });

  test('stream.seek(-1) rejects with IndexSizeError', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('neg-seek.txt', { create: true });
    const stream = await fh.createWritable();
    await expect(stream.seek(-1)).rejects.toBeInstanceOf(DOMException);
    await expect(stream.seek(-1)).rejects.toHaveProperty('name', 'IndexSizeError');
  });

  test("write({ type: 'seek', position: -1 }) rejects with TypeError", async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('neg-seek-write.txt', { create: true });
    const stream = await fh.createWritable();
    // cast to any to pass non-spec object
    await expect(stream.write({ type: 'seek', position: -1 })).rejects.toThrow(/Invalid position value/);
  });

  test("write({ type: 'truncate', size: -1 }) rejects", async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('neg-trunc-write.txt', { create: true });
    const stream = await fh.createWritable();
    await expect(stream.write({ type: 'truncate', size: -1 })).rejects.toThrow(/Invalid size value in truncate parameters/);
  });

  test('stream.truncate(-1) rejects with IndexSizeError', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('neg-trunc.txt', { create: true });
    const stream = await fh.createWritable();
    await expect(stream.truncate(-1)).rejects.toBeInstanceOf(DOMException);
    await expect(stream.truncate(-1)).rejects.toHaveProperty('name', 'IndexSizeError');
  });

  test('lastModified updates on write/close', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('mtime.txt', { create: true });
    const file1 = await fh.getFile();
    const lm1 = file1.lastModified;

    const stream = await fh.createWritable();
    await stream.write('a');
    await stream.close();

    const file2 = await fh.getFile();
    const lm2 = file2.lastModified;

    expect(lm2).toBeGreaterThanOrEqual(lm1);
    expect(await file2.text()).toBe('a');
  });

  test('File snapshot immutability across writes', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('snapshot.txt', { create: true });
    let stream = await fh.createWritable();
    await stream.write('one');
    await stream.close();

    const snap = await fh.getFile();

    stream = await fh.createWritable();
    await stream.write('two');
    await stream.close();

    // Old snapshot should still read old content
    expect(await snap.text()).toBe('one');
    const latest = await fh.getFile();
    expect(await latest.text()).toBe('two');
  });

  test('async iterator yields same set as entries()', async () => {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle('a.txt', { create: true });
    await root.getDirectoryHandle('b', { create: true });

    const fromEntries: [string, FileSystemHandle][] = [];
    for await (const e of root.entries()) {
      fromEntries.push(e);
    }

    const fromIter: [string, FileSystemHandle][] = [];
    for await (const e of root) {
      fromIter.push(e as [string, FileSystemHandle]);
    }

    const setA = new Set(fromEntries.map(([n]) => n));
    const setB = new Set(fromIter.map(([n]) => n));
    expect(setA).toEqual(setB);
  });

  test('removeEntry on file succeeds even with recursive: true', async () => {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle('remove-me.txt', { create: true });
    await root.removeEntry('remove-me.txt', { recursive: true });
    await expect(root.getFileHandle('remove-me.txt')).rejects.toBeInstanceOf(DOMException);
    await expect(root.getFileHandle('remove-me.txt')).rejects.toHaveProperty('name', 'NotFoundError');
  });

  test('getDirectory identity stable in session and changes after reset', async () => {
    const a1 = await navigator.storage.getDirectory();
    const a2 = await navigator.storage.getDirectory();
    // Since isSameEntry compares handle identity (===), use it where available
    expect(await a1.isSameEntry(a2)).toBe(true);

    resetMockOPFS();
    const b = await navigator.storage.getDirectory();
    expect(await a1.isSameEntry(b)).toBe(false);
  });

  test('resolve returns null for unrelated handle', async () => {
    const root = await navigator.storage.getDirectory();
    const dirA = await root.getDirectoryHandle('A', { create: true });
    const dirB = await root.getDirectoryHandle('B', { create: true });
    const fileInA = await dirA.getFileHandle('x.txt', { create: true });

    const pathFromB = await dirB.resolve(fileInA);
    expect(pathFromB).toBeNull();
  });

  test('permissions granted when mode omitted', async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('p', { create: true });
    const file = await dir.getFileHandle('f.txt', { create: true });

    expect(await dir.queryPermission()).toBe('granted');
    expect(await file.requestPermission()).toBe('granted');
  });

  test('sync access handle flush() rejects when closed', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('closed-flush.txt', { create: true });
    const h = await fh.createSyncAccessHandle();
    h.close();
    await expect(h.flush()).rejects.toBeInstanceOf(DOMException);
    await expect(h.flush()).rejects.toHaveProperty('name', 'InvalidStateError');
  });

  test('createWritable with keepExistingData: true appends and preserves data', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('keep-existing.txt', { create: true });

    let ws = await fh.createWritable();
    await ws.write('hello');
    await ws.close();

    ws = await fh.createWritable({ keepExistingData: true });
    await ws.write(' world');
    await ws.close();

    const file = await fh.getFile();
    expect(await file.text()).toBe('hello world');
  });

  test('WritableStream getWriter().close() closes and persists', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('writer-close.txt', { create: true });
    const stream = await fh.createWritable();
    const writer = stream.getWriter();
    await writer.write('abc');
    await writer.close();

    const file = await fh.getFile();
    expect(await file.text()).toBe('abc');
  });

  test('abort(reason) propagates rejection reason to subsequent operations', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('abort-reason.txt', { create: true });
    const stream = await fh.createWritable();

    await stream.write('start');
    await stream.abort('oops');

    await expect(stream.write('more')).rejects.toThrow('oops');
    await expect(stream.close()).rejects.toThrow('Cannot close a ERRORED writable stream');
  });

  test('stream.write(undefined) rejects with TypeError', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('undefined-write.txt', { create: true });
    const stream = await fh.createWritable();
    // @ts-expect-error invalid on purpose
    await expect(stream.write(undefined)).rejects.toBeInstanceOf(TypeError);
  });

  test("write({ type: 'write', data: null }) is a no-op", async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('noop-write.txt', { create: true });
    const stream = await fh.createWritable();
    await stream.write('abc');
    await stream.write({ type: 'write', data: null });
    await stream.close();
    const file = await fh.getFile();
    expect(await file.text()).toBe('abc');
  });

  test('legacy { data: number } rejects', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('legacy-invalid.txt', { create: true });
    const stream = await fh.createWritable();
    // @ts-expect-error invalid on purpose
    await expect(stream.write({ data: 123 })).rejects.toBeInstanceOf(TypeError);
  });

  test('sync access handle flush() resolves when open', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('open-flush.txt', { create: true });
    const h = await fh.createSyncAccessHandle();
    await h.flush();
    await h.close();
  });

  test('sync read at or beyond EOF returns 0', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('eof-read.txt', { create: true });
    const h = await fh.createSyncAccessHandle();
    h.write(new TextEncoder().encode('abc'));
    const buf = new Uint8Array(2);
    const n = h.read(buf, { at: 3 });
    expect(n).toBe(0);
    h.close();
  });

  test('sync write with DataView offset/length writes correct bytes', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('dataview-write.txt', { create: true });
    const h = await fh.createSyncAccessHandle();
    const ab = new ArrayBuffer(4);
    const view = new Uint8Array(ab);
    view.set([65, 66, 67, 68]); // A B C D
    const dv = new DataView(ab, 1, 2); // B C
    h.write(dv, { at: 0 });
    const out = new Uint8Array(2);
    h.read(out, { at: 0 });
    expect(Array.from(out)).toEqual([66, 67]); // B C
    h.close();
  });

  test('getDirectoryHandle without create rejects NotFoundError', async () => {
    const root = await navigator.storage.getDirectory();
    await expect(root.getDirectoryHandle('missing-dir')).rejects.toBeInstanceOf(DOMException);
    await expect(root.getDirectoryHandle('missing-dir')).rejects.toHaveProperty('name', 'NotFoundError');
  });

  test('removeEntry on missing name rejects NotFoundError', async () => {
    const root = await navigator.storage.getDirectory();
    await expect(root.removeEntry('missing')).rejects.toBeInstanceOf(DOMException);
    await expect(root.removeEntry('missing')).rejects.toHaveProperty('name', 'NotFoundError');
  });

  test('resolve positive cases for file and directory', async () => {
    const root = await navigator.storage.getDirectory();
    const a = await root.getDirectoryHandle('a', { create: true });
    const b = await a.getDirectoryHandle('b', { create: true });
    const fx = await b.getFileHandle('x.txt', { create: true });

    const pathToFile = await root.resolve(fx);
    expect(pathToFile).toEqual(['a', 'b', 'x.txt']);

    const pathToDir = await root.resolve(b);
    expect(pathToDir).toEqual(['a', 'b']);
  });

  test('empty directory iteration yields no entries', async () => {
    const root = await navigator.storage.getDirectory();
    const empty = await root.getDirectoryHandle('empty-iter', { create: true });

    const entries: [string, FileSystemHandle][] = [];
    for await (const e of empty.entries()) entries.push(e);
    expect(entries.length).toBe(0);

    const keys: string[] = [];
    for await (const k of empty.keys()) keys.push(k);
    expect(keys.length).toBe(0);

    const values: FileSystemHandle[] = [];
    for await (const v of empty.values()) values.push(v);
    expect(values.length).toBe(0);
  });

  test('StorageManager.estimate aggregates usage and respects base usage/quota', async () => {
    const storage = storageFactory({ usage: 100, quota: 12345 });
    const root = await storage.getDirectory();
    const fh = await root.getFileHandle('u.txt', { create: true });
    const ws = await fh.createWritable();
    await ws.write(new Uint8Array([1, 2, 3, 4]));
    await ws.close();

    const est = await storage.estimate();
    expect(est.quota).toBe(12345);
    expect(est.usage).toBeGreaterThanOrEqual(104); // base 100 + at least 4 bytes
  });

  test('writer.closed resolves after close', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('writer-closed.txt', { create: true });
    const stream = await fh.createWritable();
    const writer = stream.getWriter();
    await writer.write('x');
    const p = writer.closed;
    await writer.close();
    await expect(p).resolves.toBeUndefined();
  });

  test('writer.abort(reason) aborts the stream and prevents further writes', async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('writer-abort.txt', { create: true });
    const stream = await fh.createWritable();
    const writer = stream.getWriter();
    await writer.write('a');
    await writer.abort('boom');
    await expect(stream.write('b')).rejects.toThrow('boom');
  });
});

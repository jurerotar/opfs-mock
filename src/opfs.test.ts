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

    await expect(rootDirectory.getDirectoryHandle('dirToRemove')).rejects.toThrowError(new DOMException('Directory not found: dirToRemove', 'NotFoundError'));
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

    await expect(rootDirectory.getFileHandle('nonExistingFile.txt')).rejects.toThrowError(new DOMException('File not found: nonExistingFile.txt', 'NotFoundError'));
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
});

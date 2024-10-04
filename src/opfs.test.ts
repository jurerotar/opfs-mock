import { beforeEach, describe, expect, test } from 'vitest';
import { resetMockOPFS } from './index';

describe('OPFS', () => {
  beforeEach(() => {
    resetMockOPFS();
  });

  test('should have getDirectory function available', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();
    expect(rootDirectory).toBeDefined();
  });

  test('should create a file and read its content', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    const fileHandle = await rootDirectory.getFileHandle('testFile.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    const dataToWrite = new TextEncoder().encode('Hello, World!');
    await writeHandle.write(dataToWrite);

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Hello, World!');
  });

  test('should append data to an existing file', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    const fileHandle = await rootDirectory.getFileHandle('appendFile.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write(new TextEncoder().encode('Hello'));
    await writeHandle.write(new TextEncoder().encode(' World!'));

    const file = await fileHandle.getFile();
    expect(await file.text()).toBe('Hello World!');
  });

  test('should create a directory and add a file to it', async () => {
    const rootDirectory = await globalThis.navigator.storage.getDirectory();

    const dirHandle = await rootDirectory.getDirectoryHandle('subDir', { create: true });
    const fileHandle = await dirHandle.getFileHandle('fileInDir.txt', { create: true });
    const writeHandle = await fileHandle.createWritable();

    await writeHandle.write(new TextEncoder().encode('Test content'));

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

    await rootDirectory.removeEntry('dirToRemove');

    await expect(rootDirectory.getDirectoryHandle('dirToRemove')).rejects.toThrow('Directory not found: dirToRemove');
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

    await expect(rootDirectory.getFileHandle('nonExistingFile.txt')).rejects.toThrow('File not found: nonExistingFile.txt');
  });
});

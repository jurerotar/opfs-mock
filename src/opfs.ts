import { isDirectoryHandle, isFileHandle } from './utils';
import { notifyFileSystemObservers, setFileSystemHandleMetadata } from './observer';
import type { PermissionHandler } from './types';

// This type isn't exported from lib.dom.d.ts, so we duplicate it here
interface WriteParams {
  data?: BufferSource | Blob | string | null;
  position?: number | null;
  size?: number | null;
  type: WriteCommandType;
}

type SeekParams = { type: 'seek'; position: number };
type LegacyWriteParams = { data?: unknown; position?: number | null | undefined };
type FileLockMode = 'open' | 'taken-exclusive' | 'taken-shared';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isLegacyWriteParams = (v: unknown): v is LegacyWriteParams =>
  isObject(v) && !('type' in (v as Record<string, unknown>)) && 'data' in (v as Record<string, unknown>);
const isArrayBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === '[object ArrayBuffer]';

interface FileData {
  content: Uint8Array;
  lastModified: number;
  lock: FileLockMode;
  sharedLockCount: number;
  id: symbol;
}

const createFileData = (): FileData => ({
  content: new Uint8Array(),
  lastModified: Date.now(),
  lock: 'open',
  sharedLockCount: 0,
  id: Symbol('file'),
});

const assertValidFileName = (name: string): void => {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Invalid file name: ${name}`);
  }
};

const takeFileLock = (fileData: FileData, lockType: 'exclusive' | 'shared'): boolean => {
  if (lockType === 'exclusive') {
    if (fileData.lock !== 'open') {
      return false;
    }
    fileData.lock = 'taken-exclusive';
    return true;
  }
  if (fileData.lock === 'taken-exclusive') {
    return false;
  }
  fileData.lock = 'taken-shared';
  fileData.sharedLockCount += 1;
  return true;
};

const releaseFileLock = (fileData: FileData): void => {
  if (fileData.lock === 'taken-shared') {
    fileData.sharedLockCount -= 1;
    if (fileData.sharedLockCount <= 0) {
      fileData.lock = 'open';
      fileData.sharedLockCount = 0;
    }
  } else {
    fileData.lock = 'open';
  }
};

const fileSystemFileHandleFactory = (
  name: string,
  fileData: FileData,
  path: string[],
  exists: () => boolean,
  onRemove?: () => void,
  permissions?: { queryPermission?: PermissionHandler; requestPermission?: PermissionHandler },
): FileSystemFileHandle => {
  const checkPermission = async (mode: 'read' | 'readwrite' = 'read'): Promise<void> => {
    const perm = await (permissions?.queryPermission?.({ mode }) ?? Promise.resolve('granted' as PermissionState));
    if (perm !== 'granted') {
      throw new DOMException('Permission denied', 'NotAllowedError');
    }
  };

  const handle: FileSystemFileHandle = {
    kind: 'file',
    name,

    queryPermission: permissions?.queryPermission ?? (async (): Promise<PermissionState> => 'granted'),

    requestPermission: permissions?.requestPermission ?? (async (): Promise<PermissionState> => 'granted'),

    remove: async (_options?: FileSystemRemoveOptions) => {
      await checkPermission('readwrite');
      if (!exists()) {
        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
      }
      onRemove?.();
      notifyFileSystemObservers('disappeared', null, path);
    },

    isSameEntry: async function (this: FileSystemFileHandle, other: FileSystemHandle): Promise<boolean> {
      return other === this;
    },

    getFile: async (): Promise<File> => {
      await checkPermission('read');
      if (!exists()) {
        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
      }

      // @ts-expect-error - non-standard property used internally for identity during tests
      const f = new File([fileData.content], name, { lastModified: fileData.lastModified });
      // @ts-expect-error - attach internal id for isSameEntry in mock-only environment
      f._opfsId = fileData.id;
      return f as File;
    },

    createWritable: async (options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream> => {
      await checkPermission('readwrite');
      if (!exists()) {
        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
      }
      if (!takeFileLock(fileData, 'shared')) {
        throw new DOMException('Could not acquire a shared lock for the file.', 'NoModificationAllowedError');
      }
      const keepExistingData = options?.keepExistingData;

      let abortReason = '';
      let lockReleased = false;

      // These 2 states are being updated automatically in WritableStream.state, but it's not accessible, so we have to do it ourselves
      let isAborted = false;
      let isClosed = false;

      let content = keepExistingData ? new Uint8Array(fileData.content) : new Uint8Array();
      let cursorPosition = keepExistingData ? fileData.content.length : 0;

      const releaseWritableLock = (): void => {
        if (!lockReleased) {
          releaseFileLock(fileData);
          lockReleased = true;
        }
      };

      // Shared state and helpers for sink and direct methods
      const writeChunk = async (chunk: FileSystemWriteChunkType): Promise<void> => {
        if (isAborted) {
          throw new Error(abortReason);
        }
        if (isClosed) {
          throw new TypeError('Cannot write to a CLOSED writable stream');
        }
        if (chunk === undefined) {
          throw new TypeError('Cannot write undefined data to the stream');
        }

        // Support {type:'seek'|'truncate'|'write'} forms and plain data
        if (typeof chunk === 'object' && 'type' in chunk) {
          if (chunk.type === 'truncate') {
            if (typeof chunk.size !== 'number' || chunk.size < 0) {
              throw new TypeError('Invalid size value in truncate parameters');
            }
            if (chunk.size < content.length) {
              content = content.slice(0, chunk.size);
            } else {
              const extended = new Uint8Array(chunk.size);
              extended.set(content);
              content = extended;
            }
            cursorPosition = Math.min(cursorPosition, chunk.size);
            return;
          }
          if (chunk.type === 'seek') {
            const pos = (chunk as SeekParams).position;
            if (typeof pos !== 'number' || pos < 0) {
              throw new TypeError('Invalid position value in seek parameters');
            }
            cursorPosition = pos;
            return;
          }
          if (chunk.type === 'write') {
            const wp = chunk as WriteParams;
            if (wp.size !== undefined && wp.size !== null) {
              if (typeof wp.size !== 'number' || wp.size < 0) {
                throw new TypeError('Invalid size value in write parameters');
              }
              // Spec allows size in truncate branch; for write, we ignore after validation.
            }
            if (wp.position !== undefined && wp.position !== null) {
              if (typeof wp.position !== 'number' || wp.position < 0) {
                throw new TypeError('Invalid position value in write parameters');
              }
              cursorPosition = wp.position;
            }
            // Reassign to the underlying data for encoding path without using `any`
            chunk = (wp.data ?? new Uint8Array()) as unknown as FileSystemWriteChunkType;
          }
        }

        let encoded: Uint8Array;

        if (typeof chunk === 'string') {
          encoded = new TextEncoder().encode(chunk);
        } else if (chunk instanceof Blob) {
          const ab = await chunk.arrayBuffer();
          encoded = new Uint8Array(ab);
        } else if (ArrayBuffer.isView(chunk)) {
          encoded = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        } else if (isArrayBuffer(chunk)) {
          encoded = new Uint8Array(chunk);
        } else if (isLegacyWriteParams(chunk)) {
          const wp = chunk as LegacyWriteParams;
          if (wp.position !== undefined && wp.position !== null) {
            if (typeof wp.position !== 'number' || wp.position < 0) {
              throw new TypeError('Invalid position value in write parameters');
            }
            cursorPosition = wp.position;
          }
          const data = wp.data;
          if (data === undefined || data === null) {
            encoded = new Uint8Array();
          } else if (typeof data === 'string') {
            encoded = new TextEncoder().encode(data);
          } else if (data instanceof Blob) {
            const ab = await data.arrayBuffer();
            encoded = new Uint8Array(ab);
          } else if (ArrayBuffer.isView(data)) {
            encoded = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          } else if (isArrayBuffer(data)) {
            encoded = new Uint8Array(data);
          } else {
            throw new TypeError('Invalid data in WriteParams');
          }
        } else {
          throw new TypeError('Invalid data type written to the file. Data must be of type FileSystemWriteChunkType.');
        }

        const requiredSize = cursorPosition + encoded.length;

        if (content.length < requiredSize) {
          const extended = new Uint8Array(requiredSize);
          extended.set(content);
          content = extended;
        }

        content.set(encoded, cursorPosition);
        cursorPosition += encoded.length;
      };

      const doClose = async (): Promise<void> => {
        if (isClosed) {
          throw new TypeError('Cannot close a CLOSED writable stream');
        }
        if (isAborted) {
          throw new TypeError('Cannot close a ERRORED writable stream');
        }
        isClosed = true;
        fileData.content = content;
        fileData.lastModified = Date.now();
        releaseWritableLock();
        notifyFileSystemObservers('modified', handle, path);
      };

      const doAbort = async (reason?: string): Promise<void> => {
        if (isAborted) return;
        if (reason && !abortReason) abortReason = String(reason);
        isAborted = true;
        releaseWritableLock();
      };

      const doTruncate = async (size: number): Promise<void> => {
        if (size < 0) {
          throw new DOMException('Invalid truncate size', 'IndexSizeError');
        }
        if (size < content.length) {
          content = content.slice(0, size);
        } else if (size > content.length) {
          const newBuffer = new Uint8Array(size);
          newBuffer.set(content);
          content = newBuffer;
        }
        cursorPosition = Math.min(cursorPosition, size);
      };

      const doSeek = async (position: number): Promise<void> => {
        if (position < 0) {
          throw new DOMException('Invalid seek position', 'IndexSizeError');
        }
        cursorPosition = position;
      };

      const writableStream = new WritableStream<FileSystemWriteChunkType>({
        write: writeChunk,
        close: doClose,
        abort: doAbort,
      });

      // Preserve the original getWriter so we don't recurse when augmenting the stream
      const originalGetWriter = writableStream.getWriter.bind(writableStream);

      return Object.assign(writableStream, {
        getWriter: (): WritableStreamDefaultWriter<FileSystemWriteChunkType> => originalGetWriter(),
        write: async (_chunk: FileSystemWriteChunkType): Promise<void> => writeChunk(_chunk),
        close: async (): Promise<void> => doClose(),
        abort: async (reason?: string): Promise<void> => doAbort(reason),
        truncate: async (size: number): Promise<void> => doTruncate(size),
        seek: async (position: number): Promise<void> => doSeek(position),
      });
    },

    createSyncAccessHandle: async (): Promise<FileSystemSyncAccessHandle> => {
      await checkPermission('readwrite');
      if (!exists()) {
        throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
      }
      if (!takeFileLock(fileData, 'exclusive')) {
        throw new DOMException('Could not acquire an exclusive lock for the file.', 'NoModificationAllowedError');
      }
      let closed = false;
      let cursorPosition = 0;

      const syncHandle: FileSystemSyncAccessHandle = {
        getSize: (): number => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }
          return fileData.content.byteLength;
        },

        read: (buffer: Uint8Array | DataView, options: FileSystemReadWriteOptions = {}): number => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }

          const content = fileData.content;
          const readStart = options.at ?? cursorPosition;

          if (readStart >= content.length) {
            cursorPosition = content.length;
            return 0;
          }

          const available = content.length - readStart;
          const writable = buffer instanceof DataView ? buffer.byteLength : buffer.length;
          const bytesToRead = Math.min(writable, available);
          const slice = content.subarray(readStart, readStart + bytesToRead);

          if (buffer instanceof DataView) {
            for (let i = 0; i < slice.length; i++) {
              buffer.setUint8(i, slice[i]);
            }
          } else {
            buffer.set(slice, 0);
          }

          cursorPosition = readStart + bytesToRead;
          return bytesToRead;
        },

        write: (data: Uint8Array | DataView, options: FileSystemReadWriteOptions = {}): number => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }

          const writeLength = data instanceof DataView ? data.byteLength : data.length;
          const writePosition = options.at ?? cursorPosition;
          const requiredSize = writePosition + writeLength;

          if (fileData.content.length < requiredSize) {
            const newBuffer = new Uint8Array(requiredSize);
            newBuffer.set(fileData.content);
            fileData.content = newBuffer;
          }

          if (data instanceof DataView) {
            for (let i = 0; i < data.byteLength; i++) {
              fileData.content[writePosition + i] = data.getUint8(i);
            }
          } else {
            fileData.content.set(data, writePosition);
          }

          cursorPosition = writePosition + writeLength;
          fileData.lastModified = Date.now();
          notifyFileSystemObservers('modified', syncHandle, path);
          return writeLength;
        },

        truncate: (size: number): void => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }

          if (size < fileData.content.length) {
            fileData.content = fileData.content.slice(0, size);
          } else if (size > fileData.content.length) {
            const newBuffer = new Uint8Array(size);
            newBuffer.set(fileData.content);
            fileData.content = newBuffer;
          }
          cursorPosition = Math.min(cursorPosition, size);
          fileData.lastModified = Date.now();
          notifyFileSystemObservers('modified', syncHandle, path);
        },

        flush: (): void => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }
        },

        close: (): void => {
          if (closed) {
            return;
          }

          closed = true;
          releaseFileLock(fileData);
        },
      };
      setFileSystemHandleMetadata(syncHandle, path);
      return syncHandle;
    },
  };
  setFileSystemHandleMetadata(handle, path);
  return handle;
};

export const fileSystemDirectoryHandleFactory = (
  name: string,
  permissions?: { queryPermission?: PermissionHandler; requestPermission?: PermissionHandler },
  onRemove?: () => void,
  path: string[] = [],
): FileSystemDirectoryHandle => {
  const files = new Map<string, FileSystemFileHandle>();
  const directories = new Map<string, FileSystemDirectoryHandle>();

  const getJoinedMaps = (): Map<string, FileSystemHandle> => {
    return new Map<string, FileSystemHandle>([...files, ...directories]);
  };

  const checkPermission = async (mode: 'read' | 'readwrite' = 'read'): Promise<void> => {
    const perm = await (permissions?.queryPermission?.({ mode }) ?? Promise.resolve('granted' as PermissionState));
    if (perm !== 'granted') {
      throw new DOMException('Permission denied', 'NotAllowedError');
    }
  };

  const handle: FileSystemDirectoryHandle = {
    kind: 'directory',
    name,

    // Permissions stubs
    queryPermission: permissions?.queryPermission ?? (async (): Promise<PermissionState> => 'granted'),
    requestPermission: permissions?.requestPermission ?? (async (): Promise<PermissionState> => 'granted'),

    remove: async (options?: FileSystemRemoveOptions) => {
      await checkPermission('readwrite');
      if (!onRemove) {
        if (options?.recursive) {
          files.clear();
          directories.clear();
          notifyFileSystemObservers('modified', handle, path);
          return;
        }
        // This is usually the root directory
        throw new DOMException('The root directory cannot be removed.', 'InvalidModificationError');
      }
      // Check emptiness (standard behavior for directory.remove())
      if (!options?.recursive) {
        for await (const _ of handle.values()) {
          throw new DOMException('The directory is not empty', 'InvalidModificationError');
        }
      }
      onRemove();
      notifyFileSystemObservers('disappeared', null, path);
    },

    isSameEntry: async function (this: FileSystemDirectoryHandle, other: FileSystemHandle): Promise<boolean> {
      return other === this;
    },

    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      assertValidFileName(fileName);
      if (directories.has(fileName)) {
        throw new DOMException(`A directory with the same name exists: ${fileName}`, 'TypeMismatchError');
      }
      if (!files.has(fileName) && options?.create) {
        await checkPermission('readwrite');
        files.set(
          fileName,
          fileSystemFileHandleFactory(
            fileName,
            createFileData(),
            [...path, fileName],
            () => files.has(fileName),
            () => files.delete(fileName),
            permissions,
          ),
        );
        notifyFileSystemObservers('appeared', files.get(fileName) ?? null, [...path, fileName]);
      } else {
        await checkPermission('read');
      }
      const fileHandle = files.get(fileName);
      if (!fileHandle) {
        throw new DOMException(`File not found: ${fileName}`, 'NotFoundError');
      }
      return fileHandle;
    },

    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> => {
      assertValidFileName(dirName);
      if (files.has(dirName)) {
        throw new DOMException(`A file with the same name exists: ${dirName}`, 'TypeMismatchError');
      }
      if (!directories.has(dirName) && options?.create) {
        await checkPermission('readwrite');
        const dir = fileSystemDirectoryHandleFactory(dirName, permissions, () => directories.delete(dirName), [...path, dirName]);
        directories.set(dirName, dir);
        notifyFileSystemObservers('appeared', dir, [...path, dirName]);
      } else {
        await checkPermission('read');
      }
      const directoryHandle = directories.get(dirName);
      if (!directoryHandle) {
        throw new DOMException(`Directory not found: ${dirName}`, 'NotFoundError');
      }
      return directoryHandle;
    },

    removeEntry: async (entryName: string, options?: FileSystemRemoveOptions): Promise<void> => {
      assertValidFileName(entryName);
      await checkPermission('readwrite');
      if (files.has(entryName)) {
        files.delete(entryName);
        notifyFileSystemObservers('disappeared', null, [...path, entryName]);
        return;
      }
      const dir = directories.get(entryName);
      if (dir) {
        // Check emptiness if not recursive
        if (!options?.recursive) {
          // Determine emptiness by iterating
          for await (const _ of dir.values()) {
            // Found at least one child
            throw new DOMException('The directory is not empty', 'InvalidModificationError');
          }
        }
        directories.delete(entryName);
        notifyFileSystemObservers('disappeared', null, [...path, entryName]);
        return;
      }
      throw new DOMException(`No such file or directory: ${entryName}`, 'NotFoundError');
    },

    [Symbol.asyncIterator]: async function* (): FileSystemDirectoryHandleAsyncIterator<
      [string, FileSystemDirectoryHandle | FileSystemFileHandle]
    > {
      await checkPermission('read');
      const entries = getJoinedMaps();
      for (const [n, h] of entries) {
        yield [n, h as FileSystemDirectoryHandle | FileSystemFileHandle];
      }
      return undefined;
    },

    entries: async function* (): FileSystemDirectoryHandleAsyncIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
      await checkPermission('read');
      const joinedMaps = getJoinedMaps();
      for (const [n, h] of joinedMaps.entries()) {
        yield [n, h as FileSystemDirectoryHandle | FileSystemFileHandle];
      }
    },

    keys: async function* (): FileSystemDirectoryHandleAsyncIterator<string> {
      await checkPermission('read');
      const joinedMaps = getJoinedMaps();
      yield* joinedMaps.keys();
    },

    values: async function* (): FileSystemDirectoryHandleAsyncIterator<FileSystemDirectoryHandle | FileSystemFileHandle> {
      await checkPermission('read');
      const joinedMaps = getJoinedMaps();
      for (const h of joinedMaps.values()) {
        yield h as FileSystemDirectoryHandle | FileSystemFileHandle;
      }
    },

    resolve: async function (possibleDescendant: FileSystemHandle): Promise<string[] | null> {
      await checkPermission('read');
      const traverseDirectory = async (
        directory: FileSystemDirectoryHandle,
        target: FileSystemHandle,
        path: string[] = [],
      ): Promise<string[] | null> => {
        if (await directory.isSameEntry(target)) {
          return path;
        }

        for await (const [nm, h] of directory.entries()) {
          if (isDirectoryHandle(h)) {
            const result = await traverseDirectory(h, target, [...path, nm]);
            if (result) {
              return result;
            }
          } else if (isFileHandle(h)) {
            if (await h.isSameEntry(target)) {
              return [...path, nm];
            }
          }
        }

        return null;
      };

      return traverseDirectory(this, possibleDescendant);
    },
  } satisfies FileSystemDirectoryHandle;
  setFileSystemHandleMetadata(handle, path);
  return handle;
};

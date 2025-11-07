import { isDirectoryHandle, isFileHandle } from './utils';

// This type isn't exported from lib.dom.d.ts, so we duplicate it here
interface WriteParams {
  data?: BufferSource | Blob | string | null;
  position?: number | null;
  size?: number | null;
  type: WriteCommandType;
}

type SeekParams = { type: 'seek'; position: number };
type LegacyWriteParams = { data?: unknown; position?: number | null | undefined };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isLegacyWriteParams = (v: unknown): v is LegacyWriteParams =>
  isObject(v) && !('type' in (v as Record<string, unknown>)) && 'data' in (v as Record<string, unknown>);

interface FileData {
  content: Uint8Array;
  lastModified: number;
  locked?: boolean;
  id: symbol;
}

const fileSystemFileHandleFactory = (name: string, fileData: FileData, exists: () => boolean): FileSystemFileHandle => {
  return {
    kind: 'file',
    name,

    queryPermission: async (): Promise<PermissionState> => {
      return 'granted';
    },

    requestPermission: async (): Promise<PermissionState> => {
      return 'granted';
    },

    isSameEntry: async function (this: FileSystemFileHandle, other: FileSystemHandle): Promise<boolean> {
      return other === this;
    },

    getFile: async (): Promise<File> => {
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
      const keepExistingData = options?.keepExistingData;

      let abortReason = '';

      // These 2 states are being updated automatically in WritableStream.state, but it's not accessible, so we have to do it ourselves
      let isAborted = false;
      let isClosed = false;

      let content = keepExistingData ? new Uint8Array(fileData.content) : new Uint8Array();
      let cursorPosition = keepExistingData ? fileData.content.length : 0;

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
        } else if (chunk instanceof ArrayBuffer) {
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
          } else if (data instanceof ArrayBuffer) {
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
      };

      const doAbort = async (reason?: string): Promise<void> => {
        if (isAborted) return;
        if (reason && !abortReason) abortReason = String(reason);
        isAborted = true;
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
      if (fileData.locked) {
        throw new DOMException('A sync access handle is already open for this file', 'InvalidStateError');
      }
      fileData.locked = true;
      let closed = false;

      return {
        getSize: (): number => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }
          return fileData.content.byteLength;
        },

        read: (buffer: Uint8Array | DataView, { at = 0 } = {}): number => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }

          const content = fileData.content;
          if (at >= content.length) {
            return 0;
          }

          const available = content.length - at;
          const writable = buffer instanceof DataView ? buffer.byteLength : buffer.length;
          const bytesToRead = Math.min(writable, available);
          const slice = content.subarray(at, at + bytesToRead);

          if (buffer instanceof DataView) {
            for (let i = 0; i < slice.length; i++) {
              buffer.setUint8(i, slice[i]);
            }
          } else {
            buffer.set(slice, 0);
          }

          return bytesToRead;
        },

        write: (data: Uint8Array | DataView, { at = 0 } = {}): number => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }

          const writeLength = data instanceof DataView ? data.byteLength : data.length;
          const requiredSize = at + writeLength;

          if (fileData.content.length < requiredSize) {
            const newBuffer = new Uint8Array(requiredSize);
            newBuffer.set(fileData.content);
            fileData.content = newBuffer;
          }

          if (data instanceof DataView) {
            for (let i = 0; i < data.byteLength; i++) {
              fileData.content[at + i] = data.getUint8(i);
            }
          } else {
            fileData.content.set(data, at);
          }

          fileData.lastModified = Date.now();
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
          fileData.lastModified = Date.now();
        },

        flush: async (): Promise<void> => {
          if (closed) {
            throw new DOMException('The access handle is closed', 'InvalidStateError');
          }
        },

        close: async (): Promise<void> => {
          closed = true;
          fileData.locked = false;
        },
      };
    },
  };
};

export const fileSystemDirectoryHandleFactory = (name: string): FileSystemDirectoryHandle => {
  const files = new Map<string, FileSystemFileHandle>();
  const directories = new Map<string, FileSystemDirectoryHandle>();

  const getJoinedMaps = (): Map<string, FileSystemHandle> => {
    return new Map<string, FileSystemHandle>([...files, ...directories]);
  };

  return {
    kind: 'directory',
    name,

    // Permissions stubs
    queryPermission: async (): Promise<PermissionState> => 'granted',
    requestPermission: async (): Promise<PermissionState> => 'granted',

    isSameEntry: async function (this: FileSystemDirectoryHandle, other: FileSystemHandle): Promise<boolean> {
      return other === this;
    },

    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (directories.has(fileName)) {
        throw new DOMException(`A directory with the same name exists: ${fileName}`, 'TypeMismatchError');
      }
      if (!files.has(fileName) && options?.create) {
        files.set(
          fileName,
          fileSystemFileHandleFactory(fileName, { content: new Uint8Array(), lastModified: Date.now(), id: Symbol('file') }, () =>
            files.has(fileName),
          ),
        );
      }
      const fileHandle = files.get(fileName);
      if (!fileHandle) {
        throw new DOMException(`File not found: ${fileName}`, 'NotFoundError');
      }
      return fileHandle;
    },

    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> => {
      if (files.has(dirName)) {
        throw new DOMException(`A file with the same name exists: ${dirName}`, 'TypeMismatchError');
      }
      if (!directories.has(dirName) && options?.create) {
        const dir = fileSystemDirectoryHandleFactory(dirName);
        directories.set(dirName, dir);
      }
      const directoryHandle = directories.get(dirName);
      if (!directoryHandle) {
        throw new DOMException(`Directory not found: ${dirName}`, 'NotFoundError');
      }
      return directoryHandle;
    },

    removeEntry: async (entryName: string, options?: FileSystemRemoveOptions): Promise<void> => {
      if (files.has(entryName)) {
        files.delete(entryName);
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
        return;
      }
      throw new DOMException(`No such file or directory: ${entryName}`, 'NotFoundError');
    },

    [Symbol.asyncIterator]: async function* (): FileSystemDirectoryHandleAsyncIterator<[string, FileSystemHandle]> {
      const entries = getJoinedMaps();
      for (const [n, h] of entries) {
        yield [n, h];
      }
      return undefined;
    },

    entries: async function* (): FileSystemDirectoryHandleAsyncIterator<[string, FileSystemHandle]> {
      const joinedMaps = getJoinedMaps();
      yield* joinedMaps.entries();
    },

    keys: async function* (): FileSystemDirectoryHandleAsyncIterator<string> {
      const joinedMaps = getJoinedMaps();
      yield* joinedMaps.keys();
    },

    values: async function* (): FileSystemDirectoryHandleAsyncIterator<FileSystemHandle> {
      const joinedMaps = getJoinedMaps();
      yield* joinedMaps.values();
    },

    resolve: async function (possibleDescendant: FileSystemHandle): Promise<string[] | null> {
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
};

import { isDirectoryHandle, isFileHandle } from './utils';

interface FileData {
  content: Uint8Array;
}

const fileSystemFileHandleFactory = (name: string, fileData: FileData): FileSystemFileHandle => {
  return {
    kind: 'file',
    name,

    isSameEntry: async (other: FileSystemHandle) => {
      return other.name === name && other.kind === 'file';
    },

    getFile: async () => new File([fileData.content], name),

    createWritable: async (options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream> => {
      const keepExistingData = options?.keepExistingData;

      let abortReason = '';

      // These 2 states are being updated automatically in WritableStream.state, but it's not accessible, so we have to do it ourselves
      let isAborted = false;
      let isClosed = false;

      let content = keepExistingData ? new Uint8Array(fileData.content) : new Uint8Array();
      let cursorPosition = keepExistingData ? fileData.content.length : 0;

      const writableStream = new WritableStream<FileSystemWriteChunkType>({
        write: () => {},
        close: () => {},
        abort: () => {},
      });

      return Object.assign(writableStream, {
        getWriter: () => writableStream.getWriter(),
        write: async function (this: WritableStream<FileSystemWriteChunkType>, chunk: FileSystemWriteChunkType) {
          if (isAborted) {
            throw new Error(abortReason);
          }
          if (isClosed) {
            throw new TypeError('Cannot write to a CLOSED writable stream');
          }
          if (chunk === undefined) {
            throw new TypeError('Cannot write undefined data to the stream');
          }

          if (typeof chunk === 'object' && 'type' in chunk && chunk.type === 'truncate') {
            if (typeof chunk.size !== 'number' || chunk.size < 0) {
              throw new TypeError('Invalid size value in truncate parameters');
            }

            // Reuse your truncate logic
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

          let encoded: Uint8Array;

          if (typeof chunk === 'string') {
            encoded = new TextEncoder().encode(chunk);
          } else if (chunk instanceof Blob) {
            const text = await chunk.text(); // Still assumes Blob is UTF-8 text
            encoded = new TextEncoder().encode(text);
          } else if (ArrayBuffer.isView(chunk)) {
            encoded = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          } else if (chunk instanceof ArrayBuffer) {
            encoded = new Uint8Array(chunk);
          } else if (typeof chunk === 'object' && 'data' in chunk) {
            if (chunk.position !== undefined && (typeof chunk.position !== 'number' || chunk.position < 0)) {
              throw new TypeError('Invalid position value in write parameters');
            }
            if (chunk.size !== undefined && (typeof chunk.size !== 'number' || chunk.size < 0)) {
              throw new TypeError('Invalid size value in write parameters');
            }

            if (chunk.position !== undefined && chunk.position !== null) {
              cursorPosition = chunk.position;
            }

            const data = chunk.data;
            if (data === undefined || data === null) {
              encoded = new Uint8Array();
            } else if (typeof data === 'string') {
              encoded = new TextEncoder().encode(data);
            } else if (data instanceof Blob) {
              const text = await data.text();
              encoded = new TextEncoder().encode(text);
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
        },
        close: async function (this: WritableStream<FileSystemWriteChunkType>) {
          if (isClosed) {
            throw new TypeError('Cannot close a CLOSED writable stream');
          }
          if (isAborted) {
            throw new TypeError('Cannot close a ERRORED writable stream');
          }
          isClosed = true;
          fileData.content = content;
        },
        abort: async function (this: WritableStream<FileSystemWriteChunkType>, reason?: string) {
          if (isAborted) {
            return;
          }
          if (reason && !abortReason) {
            abortReason = reason;
          }

          isAborted = true;

          return Promise.resolve(undefined);
        },
        truncate: async function (this: WritableStream<FileSystemWriteChunkType>, size: number): Promise<void> {
          if (size < 0) {
            throw new DOMException('Invalid truncate size', 'IndexSizeError');
          }

          if (size < content.length) {
            // Shrink buffer
            content = content.slice(0, size);
          } else if (size > content.length) {
            // Extend buffer with 0s
            const newBuffer = new Uint8Array(size);
            newBuffer.set(content);
            content = newBuffer;
          }

          cursorPosition = Math.min(cursorPosition, size);
        },
        seek: async function (this: WritableStream<FileSystemWriteChunkType>, position: number): Promise<void> {
          if (position < 0) {
            throw new DOMException('Invalid seek position', 'IndexSizeError');
          }
          cursorPosition = position;
        },
      });
    },

    createSyncAccessHandle: async (): Promise<FileSystemSyncAccessHandle> => {
      let closed = false;

      return {
        getSize: () => {
          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
          }
          return fileData.content.byteLength;
        },

        read: (buffer: Uint8Array | DataView, { at = 0 } = {}) => {
          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
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

        write: (data: Uint8Array | DataView, { at = 0 } = {}) => {
          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
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

          return writeLength;
        },

        truncate: (size: number) => {
          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
          }

          if (size < fileData.content.length) {
            fileData.content = fileData.content.slice(0, size);
          } else if (size > fileData.content.length) {
            const newBuffer = new Uint8Array(size);
            newBuffer.set(fileData.content);
            fileData.content = newBuffer;
          }
        },

        flush: async () => {
          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
          }
        },

        close: async () => {
          closed = true;
        },
      };
    },
  };
};

export const fileSystemDirectoryHandleFactory = (name: string): FileSystemDirectoryHandle => {
  const files = new Map<string, FileSystemFileHandle>();
  const directories = new Map<string, FileSystemDirectoryHandle>();

  const getJoinedMaps = () => {
    return new Map<string, FileSystemHandle>([...files, ...directories]);
  };

  return {
    kind: 'directory',
    name,

    isSameEntry: async (other: FileSystemHandle) => {
      return other.name === name && other.kind === 'directory';
    },

    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (!files.has(fileName) && options?.create) {
        files.set(fileName, fileSystemFileHandleFactory(fileName, { content: new Uint8Array() }));
      }
      const fileHandle = files.get(fileName);
      if (!fileHandle) {
        throw new DOMException(`File not found: ${fileName}`, 'NotFoundError');
      }
      return fileHandle;
    },

    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      if (!directories.has(dirName) && options?.create) {
        directories.set(dirName, fileSystemDirectoryHandleFactory(dirName));
      }
      const directoryHandle = directories.get(dirName);
      if (!directoryHandle) {
        throw new DOMException(`Directory not found: ${dirName}`, 'NotFoundError');
      }
      return directoryHandle;
    },

    removeEntry: async (entryName: string, options?: FileSystemRemoveOptions) => {
      if (files.has(entryName)) {
        files.delete(entryName);
      } else if (directories.has(entryName)) {
        if (options?.recursive) {
          directories.delete(entryName);
        } else {
          throw new DOMException(`Failed to remove directory: $1${entryName}`, 'InvalidModificationError');
        }
      } else {
        throw new DOMException(`No such file or directory: $1${entryName}`, 'NotFoundError');
      }
    },

    [Symbol.asyncIterator]: async function* (): FileSystemDirectoryHandleAsyncIterator<[string, FileSystemHandle]> {
      const entries = getJoinedMaps();
      for (const [name, handle] of entries) {
        yield [name, handle];
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

        for await (const [name, handle] of directory.entries()) {
          if (isDirectoryHandle(handle)) {
            const result = await traverseDirectory(handle, target, [...path, name]);
            if (result) {
              return result;
            }
          } else if (isFileHandle(handle)) {
            if (await handle.isSameEntry(target)) {
              return [...path, name];
            }
          }
        }

        return null;
      };

      return traverseDirectory(this, possibleDescendant);
    },
  };
};

import { isDirectoryHandle, isFileHandle } from './utils';

interface FileData {
  content: string;
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

      let content = keepExistingData ? fileData.content : '';
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

          let chunkText: string;
          if (typeof chunk === 'string') {
            chunkText = chunk;
          } else if (chunk instanceof Blob) {
            chunkText = await chunk.text();
          } else if (ArrayBuffer.isView(chunk)) {
            chunkText = new TextDecoder().decode(new Uint8Array(chunk.buffer));
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
            if (chunk.data) {
              if (typeof chunk.data === 'string') {
                chunkText = chunk.data;
              } else if (chunk.data instanceof Blob) {
                chunkText = await chunk.data.text();
              } else {
                chunkText = new TextDecoder().decode(new Uint8Array(chunk.data instanceof ArrayBuffer ? chunk.data : chunk.data.buffer));
              }
            } else {
              chunkText = '';
            }
          } else {
            throw new TypeError('Invalid data type written to the file. Data must be of type FileSystemWriteChunkType.');
          }

          content = content.slice(0, cursorPosition) + chunkText + content.slice(cursorPosition + chunkText.length);
          cursorPosition += chunkText.length;
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
            content = content.slice(0, size);
          } else {
            content = content.padEnd(size, '\0');
          }
          cursorPosition = Math.min(cursorPosition, size);
        },
        seek: async function (this: WritableStream<FileSystemWriteChunkType>, position: number): Promise<void> {
          if (position < 0 || position > content.length) {
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
          return fileData.content.length;
        },

        read: (buffer: Uint8Array, { at = 0 } = {}) => {
          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
          }
          const text = new TextEncoder().encode(fileData.content);
          const bytesRead = Math.min(buffer.length, text.length - at);
          buffer.set(text.subarray(at, at + bytesRead));
          return bytesRead;
        },

        write: (data: Uint8Array, options?: FileSystemReadWriteOptions) => {
          const at = options?.at ?? 0;

          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
          }
          const newContent = new TextDecoder().decode(data);
          if (at < fileData.content.length) {
            fileData.content = fileData.content.slice(0, at) + newContent + fileData.content.slice(at + newContent.length);
          } else {
            fileData.content += newContent;
          }
          return data.byteLength;
        },

        truncate: (size: number) => {
          if (closed) {
            throw new DOMException('InvalidStateError', 'The access handle is closed');
          }
          fileData.content = fileData.content.slice(0, size);
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
        files.set(fileName, fileSystemFileHandleFactory(fileName, { content: '' }));
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

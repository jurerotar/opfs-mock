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

    createWritable: async (_options?: FileSystemCreateWritableOptions) => {
      let newContent = '';
      let cursorPosition = 0;
      let aborted = false;
      let closed = false;
      const locked = false;

      const writableStream = new WritableStream<FileSystemWriteChunkType>({
        write: async (chunk) => {
          if (aborted) {
            throw new DOMException('Write operation aborted', 'AbortError');
          }
          if (closed) {
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

          newContent = newContent.slice(0, cursorPosition) + chunkText + newContent.slice(cursorPosition + chunkText.length);
          cursorPosition += chunkText.length;
        },
        close: async () => {
          if (aborted) {
            throw new DOMException('Stream has been aborted', 'AbortError');
          }
          closed = true;
          fileData.content = newContent;
        },
        abort: (reason) => {
          if (aborted) {
            return Promise.reject(new TypeError('Cannot abort an already aborted writable stream'));
          }
          if (locked) {
            return Promise.reject(new TypeError('Cannot abort a locked writable stream'));
          }
          aborted = true;
          return Promise.resolve(reason);
        },
      });

      const writer = writableStream.getWriter();

      return Object.assign(writer, {
        locked: false,
        truncate: async (size: number): Promise<void> => {
          if (size < 0) {
            throw new DOMException('Invalid truncate size', 'IndexSizeError');
          }
          if (size < newContent.length) {
            newContent = newContent.slice(0, size);
          } else {
            newContent = newContent.padEnd(size, '\0');
          }
          cursorPosition = Math.min(cursorPosition, size);
        },
        getWriter: () => writer,
        seek: async (position: number): Promise<void> => {
          if (position < 0 || position > newContent.length) {
            throw new DOMException('Invalid seek position', 'IndexSizeError');
          }
          cursorPosition = position;
        },
      });
    },

    createSyncAccessHandle: async (): Promise<FileSystemSyncAccessHandle> => ({
      getSize: () => fileData.content.length,

      read: (buffer: Uint8Array, { at = 0 } = {}) => {
        const text = new TextEncoder().encode(fileData.content);
        const bytesRead = Math.min(buffer.length, text.length - at);
        buffer.set(text.subarray(at, at + bytesRead));
        return bytesRead;
      },

      write: (data: Uint8Array, { at = 0 } = {}) => {
        const newContent = new TextDecoder().decode(data);
        const originalLength = fileData.content.length;

        if (at < originalLength) {
          // Inserting at the specified position
          fileData.content = fileData.content.slice(0, at) + newContent + fileData.content.slice(at + newContent.length);
        } else {
          // Append if `at` is out of bounds
          fileData.content += newContent;
        }

        return data.byteLength;
      },

      // Flush is a no-op in memory
      flush: async () => {},

      // Close is a no-op in memory
      close: async () => {},

      truncate: async (size: number) => {
        fileData.content = fileData.content.slice(0, size);
      },
    }),
  };
};

export const fileSystemDirectoryHandleFactory = (name: string): FileSystemDirectoryHandle => {
  const files = new Map<string, FileSystemFileHandle>();
  const directories = new Map<string, FileSystemDirectoryHandle>();

  const getJoinedMaps = () => {
    return new Map<string, FileSystemHandle>([...files, ...directories]);
  };

  // @ts-ignore TODO: Implement [Symbol.asyncIterator]
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
        throw new Error(`File not found: ${fileName}`);
      }
      return fileHandle;
    },

    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      if (!directories.has(dirName) && options?.create) {
        directories.set(dirName, fileSystemDirectoryHandleFactory(dirName));
      }
      const directoryHandle = directories.get(dirName);
      if (!directoryHandle) {
        throw new Error(`Directory not found: ${dirName}`);
      }
      return directoryHandle;
    },

    removeEntry: async (entryName: string) => {
      if (files.has(entryName)) {
        files.delete(entryName);
      } else if (directories.has(entryName)) {
        directories.delete(entryName);
      } else {
        throw new Error(`Entry not found: ${entryName}`);
      }
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

    resolve: async (possibleDescendant: FileSystemHandle): Promise<string[] | null> => {
      const traverseDirectory = async (
        directory: FileSystemDirectoryHandle,
        target: FileSystemHandle,
        path: string[] = [],
      ): Promise<string[] | null> => {
        if (await directory.isSameEntry(target)) {
          return path;
        }

        for await (const [name, handle] of directory.entries()) {
          if (handle.kind === 'directory') {
            const subDirectory = handle as FileSystemDirectoryHandle;
            const result = await traverseDirectory(subDirectory, target, [...path, name]);
            if (result) {
              return result;
            }
          } else if (handle.kind === 'file') {
            if (await handle.isSameEntry(target)) {
              return [...path, name];
            }
          }
        }

        return null;
      };

      return traverseDirectory(this!, possibleDescendant);
    },
  };
};

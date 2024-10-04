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

    getFile: async () =>
      new File([fileData.content], name, {
        type: 'application/json',
      }),

    // @ts-ignore TODO: Implement options, add missing properties
    createWritable: async (_options?: FileSystemCreateWritableOptions) => {
      const writableStream = new WritableStream<AllowSharedBufferSource>({
        write: (chunk) => {
          const newContent = new TextDecoder().decode(chunk);
          fileData.content += newContent;
        },
        close: () => {},
        abort: (_reason) => {},
      });

      return writableStream.getWriter();
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

export const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle => {
  return handle.kind === 'file';
};

export const isDirectoryHandle = (handle: FileSystemHandle): handle is FileSystemDirectoryHandle => {
  return handle.kind === 'directory';
};

export const getSizeOfDirectory = async (directory: FileSystemDirectoryHandle): Promise<number> => {
  let totalSize = 0;

  for await (const handle of directory.values()) {
    if (isFileHandle(handle)) {
      const file = await handle.getFile();
      totalSize += file.size;
    } else if (isDirectoryHandle(handle)) {
      totalSize += await getSizeOfDirectory(handle);
    }
  }

  return totalSize;
};

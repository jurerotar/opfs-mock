import { fileSystemDirectoryHandleFactory } from './opfs';
import { getSizeOfDirectory } from './utils';

export const storageFactory = ({ usage = 0, quota = 1024 ** 3 }: StorageEstimate = {}): StorageManager => {
  const root = fileSystemDirectoryHandleFactory('root');

  return {
    estimate: async (): Promise<StorageEstimate> => {
      const defaultUsage = usage;
      const calculatedUsage = await getSizeOfDirectory(root);

      return {
        usage: defaultUsage + calculatedUsage,
        quota,
      };
    },
    getDirectory: async (): Promise<FileSystemDirectoryHandle> => {
      return root;
    },
    persist: async (): Promise<boolean> => {
      return true;
    },
    persisted: async (): Promise<boolean> => {
      return true;
    },
  };
};

export const mockOPFS = () => {
  // Navigator was added to Node.js in v21
  if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
    });
  }

  if (!globalThis.navigator.storage) {
    const { getDirectory } = storageFactory();

    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {
        getDirectory,
      },
      writable: true,
    });
  }
};

export const resetMockOPFS = () => {
  // Clear the mock state, e.g., reset the root directory
  const root = fileSystemDirectoryHandleFactory('root');
  Object.defineProperty(globalThis.navigator.storage, 'getDirectory', {
    value: () => root,
    writable: true,
  });
};

// Automatically add to globalThis if imported directly
if (typeof globalThis !== 'undefined') {
  mockOPFS();
}

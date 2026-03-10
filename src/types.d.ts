// Experimental properties:
// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission
// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission
// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/remove

export type PermissionHandler = (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemFileHandle extends FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    remove(): Promise<void>;
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    remove(): Promise<void>;
  }
}

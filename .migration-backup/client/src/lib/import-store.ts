let _photos: File[] = [];

export function setImportedPhotos(files: File[]): void {
  _photos = [...files];
}

export function getImportedPhotos(): File[] {
  return _photos;
}

export function clearImportedPhotos(): void {
  _photos = [];
}

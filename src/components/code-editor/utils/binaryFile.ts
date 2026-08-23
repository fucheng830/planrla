// Binary file extensions (images are handled by ImageViewer, not here)
const BINARY_EXTENSIONS = [
  // Archives
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz',
  // Executables
  'exe', 'dll', 'so', 'dylib', 'app', 'dmg', 'msi',
  // Media
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4a', 'ogg',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Database
  'db', 'sqlite', 'sqlite3',
  // Other binary
  'bin', 'dat', 'iso', 'img', 'class', 'jar', 'war', 'pyc', 'pyo'
];

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv']);

const getExtension = (filename: string) => filename.split('.').pop()?.toLowerCase() ?? '';

export const isBinaryFile = (filename: string): boolean => {
  return BINARY_EXTENSIONS.includes(getExtension(filename));
};

export const isVideoFile = (filename: string): boolean => VIDEO_EXTENSIONS.has(getExtension(filename));

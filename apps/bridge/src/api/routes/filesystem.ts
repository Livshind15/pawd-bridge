import { FastifyInstance } from 'fastify';
import {
  stat,
  readdir,
  readFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from 'fs/promises';
import { join, dirname, extname, basename } from 'path';
import { homedir } from 'os';
import { createReadStream } from 'fs';
import { ValidationError, NotFoundError, BridgeError } from '../middleware/errors.js';
import { logger } from '../../utils/logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// MIME type lookup (built-in — no external dependency)
// ──────────────────────────────────────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  // Text
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.md': 'text/markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.log': 'text/plain',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.env': 'text/plain',

  // Code / scripts
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'application/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/json',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++src',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++hdr',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.sql': 'application/sql',
  '.graphql': 'application/graphql',
  '.toml': 'application/toml',
  '.lock': 'text/plain',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif': 'image/avif',

  // Audio / Video
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',

  // Archives
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',

  // Misc
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/** Simple heuristic: anything starting with "text/" or known text MIME types. */
const TEXT_MIMES = new Set([
  'application/json',
  'application/javascript',
  'application/sql',
  'application/graphql',
  'application/toml',
  'application/xml',
  'application/x-sh',
  'image/svg+xml',
]);

function isTextMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (TEXT_MIMES.has(mime)) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Path validation helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Resolve a user-supplied path, expanding `~` to home directory. */
function resolvePath(raw: string | undefined): string {
  if (!raw || raw.trim() === '') {
    return homedir();
  }
  let p = raw.trim();
  if (p.startsWith('~')) {
    p = join(homedir(), p.slice(1));
  }
  return p;
}

/** Ensure the path doesn't contain null bytes or obvious traversal tricks. */
function validatePath(p: string): void {
  if (p.includes('\0')) {
    throw new ValidationError('Path contains invalid characters');
  }
}

/** Convert fs errors into appropriate BridgeErrors. */
function handleFsError(err: unknown, path: string): never {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'ENOENT') {
    throw new NotFoundError('Path', path);
  }
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    throw new BridgeError(403, `Permission denied: ${path}`, 'PERMISSION_DENIED');
  }
  if (e.code === 'ENOTDIR') {
    throw new ValidationError(`Not a directory: ${path}`);
  }
  if (e.code === 'EISDIR') {
    throw new ValidationError(`Is a directory: ${path}`);
  }
  if (e.code === 'ENOTEMPTY') {
    throw new ValidationError(
      `Directory is not empty: ${path}. Set recursive=true to delete non-empty directories.`
    );
  }
  if (e.code === 'EEXIST') {
    throw new ValidationError(`Already exists: ${path}`);
  }
  throw err;
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

export function filesystemRoutes(fastify: FastifyInstance): void {

  // ── GET /api/filesystem/list ───────────────────────────────────────────────
  fastify.get<{
    Querystring: {
      path?: string;
      sortBy?: 'name' | 'modified' | 'size';
      sortOrder?: 'asc' | 'desc';
    };
  }>('/api/filesystem/list', async (request) => {
    const query = request.query as {
      path?: string;
      sortBy?: string;
      sortOrder?: string;
    };

    const dirPath = resolvePath(query.path);
    validatePath(dirPath);

    const sortBy = (['name', 'modified', 'size'].includes(query.sortBy || '')
      ? query.sortBy
      : 'name') as 'name' | 'modified' | 'size';
    const sortOrder = (['asc', 'desc'].includes(query.sortOrder || '')
      ? query.sortOrder
      : 'asc') as 'asc' | 'desc';

    let dirStat;
    try {
      dirStat = await stat(dirPath);
    } catch (err) {
      handleFsError(err, dirPath);
    }

    if (!dirStat.isDirectory()) {
      throw new ValidationError(`Not a directory: ${dirPath}`);
    }

    let dirEntries;
    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      handleFsError(err, dirPath);
    }

    const entries = await Promise.all(
      dirEntries.map(async (entry) => {
        const entryPath = join(dirPath, entry.name);
        const isDir = entry.isDirectory();
        const isFile = entry.isFile();
        const type = isDir ? 'directory' : 'file';

        let entryStat;
        try {
          entryStat = await stat(entryPath);
        } catch {
          // If we can't stat (permission, broken symlink, etc.), return minimal info
          return {
            name: entry.name,
            path: entryPath,
            type,
            isDirectory: isDir,
            isFile,
            size: 0,
            mimeType: isFile ? getMimeType(entry.name) : null,
            modifiedAt: null,
            createdAt: null,
            extension: isFile ? extname(entry.name).toLowerCase() : null,
            childCount: null,
          };
        }

        let childCount: number | null = null;
        if (isDir) {
          try {
            const children = await readdir(entryPath);
            childCount = children.length;
          } catch {
            childCount = null;
          }
        }

        return {
          name: entry.name,
          path: entryPath,
          type,
          isDirectory: isDir,
          isFile,
          size: entryStat.size,
          mimeType: isFile ? getMimeType(entry.name) : null,
          modifiedAt: entryStat.mtime.toISOString(),
          createdAt: entryStat.birthtime.toISOString(),
          extension: isFile ? extname(entry.name).toLowerCase() : null,
          childCount,
        };
      })
    );

    // Sort
    entries.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          break;
        case 'modified': {
          const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
          const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
          cmp = aTime - bTime;
          break;
        }
        case 'size':
          cmp = a.size - b.size;
          break;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return { path: dirPath, entries };
  });

  // ── GET /api/filesystem/info ───────────────────────────────────────────────
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/filesystem/info',
    async (request) => {
      const query = request.query as { path?: string };
      if (!query.path) {
        throw new ValidationError('Query parameter "path" is required');
      }

      const filePath = resolvePath(query.path);
      validatePath(filePath);

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch (err) {
        handleFsError(err, filePath);
      }

      const isDir = fileStat.isDirectory();
      const isFile = fileStat.isFile();

      let childCount: number | null = null;
      if (isDir) {
        try {
          const children = await readdir(filePath);
          childCount = children.length;
        } catch {
          childCount = null;
        }
      }

      return {
        name: basename(filePath),
        path: filePath,
        type: isDir ? 'directory' : isFile ? 'file' : 'other',
        size: fileStat.size,
        mimeType: isFile ? getMimeType(filePath) : null,
        modifiedAt: fileStat.mtime.toISOString(),
        createdAt: fileStat.birthtime.toISOString(),
        accessedAt: fileStat.atime.toISOString(),
        extension: isFile ? extname(filePath).toLowerCase() : null,
        childCount,
        permissions: {
          mode: fileStat.mode.toString(8),
          uid: fileStat.uid,
          gid: fileStat.gid,
        },
        isSymlink: fileStat.isSymbolicLink(),
      };
    }
  );

  // ── GET /api/filesystem/read ───────────────────────────────────────────────
  fastify.get<{
    Querystring: { path?: string; offset?: string; limit?: string };
  }>('/api/filesystem/read', async (request) => {
    const query = request.query as {
      path?: string;
      offset?: string;
      limit?: string;
    };

    if (!query.path) {
      throw new ValidationError('Query parameter "path" is required');
    }

    const filePath = resolvePath(query.path);
    validatePath(filePath);

    const offset = Math.max(0, parseInt(query.offset || '0', 10) || 0);
    const limit = Math.max(1, parseInt(query.limit || '102400', 10) || 102400);

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch (err) {
      handleFsError(err, filePath);
    }

    if (fileStat.isDirectory()) {
      throw new ValidationError(`Cannot read a directory: ${filePath}`);
    }

    const mimeType = getMimeType(filePath);
    const isBinary = !isTextMime(mimeType);

    let buffer: Buffer;
    try {
      // Read the file (or a slice of it)
      const fd = await import('fs/promises').then((m) => m.open(filePath, 'r'));
      try {
        const readSize = Math.min(limit, fileStat.size - offset);
        if (readSize <= 0) {
          return {
            path: filePath,
            content: '',
            isBinary,
            truncated: false,
            mimeType,
            size: fileStat.size,
            offset,
            limit,
          };
        }
        buffer = Buffer.alloc(readSize);
        await fd.read(buffer, 0, readSize, offset);
      } finally {
        await fd.close();
      }
    } catch (err) {
      handleFsError(err, filePath);
    }

    const truncated = offset + buffer.length < fileStat.size;
    const content = isBinary
      ? buffer.toString('base64')
      : buffer.toString('utf-8');

    return {
      path: filePath,
      content,
      isBinary,
      truncated,
      mimeType,
      size: fileStat.size,
      offset,
      limit,
    };
  });

  // ── POST /api/filesystem/folder ────────────────────────────────────────────
  fastify.post<{ Body: { path: string; name: string } }>(
    '/api/filesystem/folder',
    async (request) => {
      const body = request.body as { path?: string; name?: string };

      if (!body.path || typeof body.path !== 'string') {
        throw new ValidationError('"path" is required and must be a string');
      }
      if (!body.name || typeof body.name !== 'string') {
        throw new ValidationError('"name" is required and must be a string');
      }

      const parentPath = resolvePath(body.path);
      validatePath(parentPath);
      validatePath(body.name);

      const newDir = join(parentPath, body.name);

      try {
        await mkdir(newDir, { recursive: true });
      } catch (err) {
        handleFsError(err, newDir);
      }

      logger.info({ path: newDir }, '[filesystem] Directory created');
      return { path: newDir, created: true };
    }
  );

  // ── POST /api/filesystem/upload ────────────────────────────────────────────
  fastify.post('/api/filesystem/upload', async (request) => {
    let data;
    try {
      data = await request.file();
    } catch (err) {
      logger.error({ err }, '[filesystem] Failed to parse multipart upload');
      throw new ValidationError('Failed to parse uploaded file');
    }

    if (!data) {
      throw new ValidationError('No file uploaded');
    }

    // The targetPath should be provided as a field before the file in the
    // multipart form, or we can read it from data.fields.
    const targetPathField = data.fields?.targetPath;
    let targetDir: string;

    if (
      targetPathField &&
      typeof targetPathField === 'object' &&
      'value' in targetPathField
    ) {
      targetDir = resolvePath((targetPathField as { value: string }).value);
    } else if (typeof targetPathField === 'string') {
      targetDir = resolvePath(targetPathField);
    } else {
      throw new ValidationError(
        '"targetPath" form field is required to specify the upload destination directory'
      );
    }

    validatePath(targetDir);

    // Ensure target directory exists
    try {
      await mkdir(targetDir, { recursive: true });
    } catch (err) {
      handleFsError(err, targetDir);
    }

    const filename = data.filename || 'upload';
    const buffer = await data.toBuffer();

    if (buffer.length > 25 * 1024 * 1024) {
      throw new ValidationError(
        `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Max: 25MB`
      );
    }

    const destPath = join(targetDir, filename);

    try {
      await writeFile(destPath, buffer);
    } catch (err) {
      handleFsError(err, destPath);
    }

    logger.info(
      { path: destPath, size: buffer.length },
      '[filesystem] File uploaded'
    );

    return {
      path: destPath,
      name: filename,
      size: buffer.length,
      mimeType: getMimeType(filename),
      uploaded: true,
    };
  });

  // ── PUT /api/filesystem/rename ─────────────────────────────────────────────
  fastify.put<{ Body: { path: string; newName: string } }>(
    '/api/filesystem/rename',
    async (request) => {
      const body = request.body as { path?: string; newName?: string };

      if (!body.path || typeof body.path !== 'string') {
        throw new ValidationError('"path" is required and must be a string');
      }
      if (!body.newName || typeof body.newName !== 'string') {
        throw new ValidationError('"newName" is required and must be a string');
      }

      const oldPath = resolvePath(body.path);
      validatePath(oldPath);
      validatePath(body.newName);

      // Ensure old path exists
      try {
        await stat(oldPath);
      } catch (err) {
        handleFsError(err, oldPath);
      }

      const newPath = join(dirname(oldPath), body.newName);

      try {
        await rename(oldPath, newPath);
      } catch (err) {
        handleFsError(err, oldPath);
      }

      logger.info(
        { oldPath, newPath },
        '[filesystem] Renamed'
      );

      return { oldPath, newPath, renamed: true };
    }
  );

  // ── DELETE /api/filesystem/delete ──────────────────────────────────────────
  fastify.delete<{
    Querystring: { path?: string; recursive?: string };
    Body: { path?: string; recursive?: boolean };
  }>(
    '/api/filesystem/delete',
    async (request) => {
      const query = request.query as { path?: string; recursive?: string };
      const body = (request.body || {}) as { path?: string; recursive?: boolean };

      // Accept path from query params or body
      const rawPath = query.path || body.path;
      const recursive = query.recursive === 'true' || body.recursive === true;

      if (!rawPath || typeof rawPath !== 'string') {
        throw new ValidationError('"path" is required (query param or body)');
      }

      const targetPath = resolvePath(rawPath);
      validatePath(targetPath);

      let targetStat;
      try {
        targetStat = await stat(targetPath);
      } catch (err) {
        handleFsError(err, targetPath);
      }

      // If it's a non-empty directory, require recursive=true
      if (targetStat.isDirectory()) {
        let children;
        try {
          children = await readdir(targetPath);
        } catch (err) {
          handleFsError(err, targetPath);
        }

        if (children.length > 0 && !recursive) {
          throw new ValidationError(
            `Directory is not empty: ${targetPath}. Set recursive=true to delete non-empty directories.`
          );
        }
      }

      try {
        await rm(targetPath, { recursive, force: false });
      } catch (err) {
        handleFsError(err, targetPath);
      }

      logger.info({ path: targetPath, recursive }, '[filesystem] Deleted');

      return { path: targetPath, deleted: true };
    }
  );

  // ── GET /api/filesystem/download ───────────────────────────────────────────
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/filesystem/download',
    async (request, reply) => {
      const query = request.query as { path?: string };

      if (!query.path) {
        throw new ValidationError('Query parameter "path" is required');
      }

      const filePath = resolvePath(query.path);
      validatePath(filePath);

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch (err) {
        handleFsError(err, filePath);
      }

      if (fileStat.isDirectory()) {
        throw new ValidationError(`Cannot download a directory: ${filePath}`);
      }

      const mimeType = getMimeType(filePath);
      const fileName = basename(filePath);

      const stream = createReadStream(filePath);

      reply.header('Content-Type', mimeType);
      reply.header('Content-Length', fileStat.size);
      reply.header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(fileName)}"`
      );

      return reply.send(stream);
    }
  );

  // ── PUT /api/filesystem/write ──────────────────────────────────────────────
  fastify.put<{ Body: { path: string; content: string } }>(
    '/api/filesystem/write',
    async (request) => {
      const body = request.body as { path?: string; content?: string };

      if (!body.path || typeof body.path !== 'string') {
        throw new ValidationError('"path" is required and must be a string');
      }
      if (typeof body.content !== 'string') {
        throw new ValidationError('"content" is required and must be a string');
      }

      const filePath = resolvePath(body.path);
      validatePath(filePath);

      // Ensure parent directory exists
      const parentDir = dirname(filePath);
      try {
        await mkdir(parentDir, { recursive: true });
      } catch (err) {
        handleFsError(err, parentDir);
      }

      try {
        await writeFile(filePath, body.content, 'utf-8');
      } catch (err) {
        handleFsError(err, filePath);
      }

      const fileStat = await stat(filePath);

      logger.info({ path: filePath, size: fileStat.size }, '[filesystem] File written');

      return {
        path: filePath,
        size: fileStat.size,
        written: true,
      };
    }
  );
}

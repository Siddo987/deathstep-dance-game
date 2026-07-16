// Single .env for the whole app lives at the repo root, not in server/ - see
// /.env.example. Must be imported first (before any module that reads
// process.env at module-load time, e.g. auth.js's Google client setup).
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

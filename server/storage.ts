import { Client } from "@replit/object-storage";
import path from "path";
import fs from "fs";
import type { Express, Request, Response } from "express";
import { randomBytes } from "crypto";

let client: Client | null = null;
let storageAvailable = false;

// Initialize client lazily to avoid startup failures
async function getClient(): Promise<Client | null> {
  if (client !== null) return storageAvailable ? client : null;
  
  try {
    client = new Client();
    // Test if storage is working by listing (will fail if not configured)
    const result = await client.list({ startOffset: "", endOffset: "" });
    storageAvailable = result.ok;
    if (storageAvailable) {
      console.log("[Storage] Object Storage initialized successfully");
    } else {
      console.log("[Storage] Object Storage not available, using local fallback");
    }
  } catch (error) {
    console.log("[Storage] Object Storage not configured, using local fallback");
    storageAvailable = false;
  }
  
  return storageAvailable ? client : null;
}

// Ensure uploads directory exists
const uploadsDir = "./uploads";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export async function uploadToStorage(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  const timestamp = Date.now();
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
  const storageKey = `images/${baseName}-${timestamp}${ext}`;
  
  const storageClient = await getClient();

  if (storageClient) {
    try {
      const result = await storageClient.uploadFromBytes(storageKey, fileBuffer);
      
      if (!result.ok) {
        throw new Error(`Upload failed: ${result.error}`);
      }
      
      // Return a URL path that our server will serve
      const publicUrl = `/storage/${storageKey}`;
      
      console.log(`[Storage] Uploaded to Object Storage: ${filename} -> ${storageKey}`);
      console.log(`[Storage] Serving URL: ${publicUrl}`);
      
      return publicUrl;
    } catch (error) {
      console.error(`[Storage] Object Storage upload failed, falling back to local:`, error);
    }
  }
  
  // Fallback to local file system
  const localFilename = `${randomBytes(16).toString('hex')}-${timestamp}${ext}`;
  const localPath = path.join(uploadsDir, localFilename);
  fs.writeFileSync(localPath, fileBuffer);
  
  const localUrl = `/uploads/${localFilename}`;
  console.log(`[Storage] Uploaded locally: ${filename} -> ${localUrl}`);
  
  return localUrl;
}

export async function uploadFileToStorage(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  
  return uploadToStorage(fileBuffer, filename);
}

export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

export async function deleteFromStorage(storageKey: string): Promise<void> {
  const storageClient = await getClient();
  if (!storageClient) return;
  
  try {
    const result = await storageClient.delete(storageKey);
    if (result.ok) {
      console.log(`[Storage] Deleted: ${storageKey}`);
    }
  } catch (error) {
    console.error(`[Storage] Delete failed for ${storageKey}:`, error);
  }
}

export async function getFromStorage(storageKey: string): Promise<Buffer | null> {
  const storageClient = await getClient();
  if (!storageClient) return null;
  
  try {
    const result = await storageClient.downloadAsBytes(storageKey);
    if (result.ok) {
      return result.value[0];
    }
    return null;
  } catch (error) {
    console.error(`[Storage] Download failed for ${storageKey}:`, error);
    return null;
  }
}

// Setup express route to serve files from object storage
export function setupStorageRoutes(app: Express): void {
  app.get("/storage/*", async (req: Request, res: Response) => {
    const storageKey = req.path.replace("/storage/", "");
    
    const storageClient = await getClient();
    if (!storageClient) {
      return res.status(404).send("Storage not configured");
    }
    
    try {
      const result = await storageClient.downloadAsBytes(storageKey);
      
      if (!result.ok) {
        console.log(`[Storage] File not found: ${storageKey}`);
        return res.status(404).send("File not found");
      }
      
      const buffer = result.value[0];
      const mimeType = getMimeType(storageKey);
      
      // Set caching headers for performance
      res.set({
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      
      res.send(buffer);
    } catch (error) {
      console.error(`[Storage] Error serving ${storageKey}:`, error);
      res.status(500).send("Error loading file");
    }
  });
  
  console.log("[Storage] Routes configured at /storage/*");
}

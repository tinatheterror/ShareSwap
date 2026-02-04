import { Client } from "@replit/object-storage";
import path from "path";
import fs from "fs";
import type { Express, Request, Response } from "express";

const client = new Client();

export async function uploadToStorage(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  const timestamp = Date.now();
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
  const storageKey = `images/${baseName}-${timestamp}${ext}`;

  try {
    const result = await client.uploadFromBytes(storageKey, fileBuffer);
    
    if (!result.ok) {
      throw new Error(`Upload failed: ${result.error}`);
    }
    
    // Return a URL path that our server will serve
    const publicUrl = `/storage/${storageKey}`;
    
    console.log(`[Storage] Uploaded ${filename} -> ${storageKey}`);
    console.log(`[Storage] Serving URL: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error(`[Storage] Upload failed for ${filename}:`, error);
    throw error;
  }
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
  try {
    const result = await client.delete(storageKey);
    if (result.ok) {
      console.log(`[Storage] Deleted: ${storageKey}`);
    }
  } catch (error) {
    console.error(`[Storage] Delete failed for ${storageKey}:`, error);
  }
}

export async function getFromStorage(storageKey: string): Promise<Buffer | null> {
  try {
    const result = await client.downloadAsBytes(storageKey);
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
    
    try {
      const result = await client.downloadAsBytes(storageKey);
      
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

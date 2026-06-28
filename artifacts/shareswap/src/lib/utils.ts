import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDisplayName(username: string | null | undefined): string {
  if (!username) return "Anonymous";

  // If it looks like an email, only use the part before @
  const base = username.includes('@') ? username.split('@')[0] : username;

  const name = base
    .replace(/[._-]/g, ' ')
    .split(' ')
    .filter(p => p.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

  return name || "Anonymous";
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDisplayName(username: string | null | undefined): string {
  if (!username) return "Anonymous";
  
  const name = username
    .replace(/_/g, ' ')
    .replace(/\./g, ' ')
    .split(' ')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
  
  const parts = name.split(' ');
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${firstName} ${lastInitial}.`;
  }
  
  return name;
}

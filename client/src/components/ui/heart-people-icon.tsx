import { cn } from "@/lib/utils";

interface HeartPeopleIconProps {
  className?: string;
}

export function HeartPeopleIcon({ className }: HeartPeopleIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("inline-block", className)}
      aria-hidden="true"
    >
      {/* Heart shape */}
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      {/* Left person – head */}
      <circle cx="9.3" cy="10.6" r="1.35" fill="white" />
      {/* Left person – body */}
      <path d="M6.8 15.2 C6.8 13.2 8 12.4 9.3 12.4 C10.6 12.4 11.8 13.2 11.8 15.2 Z" fill="white" />
      {/* Right person – head */}
      <circle cx="14.7" cy="10.6" r="1.35" fill="white" />
      {/* Right person – body */}
      <path d="M12.2 15.2 C12.2 13.2 13.4 12.4 14.7 12.4 C16 12.4 17.2 13.2 17.2 15.2 Z" fill="white" />
    </svg>
  );
}

import { cn } from "@/lib/utils";

interface LogoProps {
    className?: string;
}

export function Logo({ className }: LogoProps) {
    return (
        <img
            src="/folio-logo.svg"
            alt="Folio Logo"
            className={cn("w-full h-full object-contain", className)}
        />
    );
}

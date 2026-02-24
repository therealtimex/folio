import * as React from "react"
import { cn } from "@/lib/utils"

// Simplified Select implementation to avoid installing @radix-ui/react-select

const SelectContext = React.createContext<{
    value?: string
    onValueChange?: (value: string) => void
    open: boolean
    setOpen: (open: boolean) => void
} | null>(null)

const Select = ({ children, value, onValueChange, ...props }: any) => {
    const [open, setOpen] = React.useState(false)

    // Close on click outside
    const ref = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    return (
        <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
            <div ref={ref} className="relative inline-block w-full" {...props}>{children}</div>
        </SelectContext.Provider>
    )
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, any>(({ className, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    return (
        <button
            ref={ref}
            type="button"
            onClick={() => context?.setOpen(!context.open)}
            className={cn(
                "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                className
            )}
            {...props}
        >
            {children}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 opacity-50"
            >
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>
    )
})
SelectTrigger.displayName = "SelectTrigger"

const SelectValue = React.forwardRef<HTMLSpanElement, any>(({ className, placeholder, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    const selectedLabel = React.Children.toArray(props.children)
    // This is a simplified value extractor, in a real Shadcn it would be more complex
    return (
        <span ref={ref} className={cn("pointer-events-none", className)} {...props}>
            {context?.value || placeholder}
        </span>
    )
})
SelectValue.displayName = "SelectValue"

const SelectContent = React.forwardRef<HTMLDivElement, any>(({ className, children, position = "popper", ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context?.open) return null
    return (
        <div
            ref={ref}
            className={cn(
                "absolute z-50 min-w-[8rem] w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-80 mt-1",
                position === "popper" && "translate-y-1",
                className
            )}
            {...props}
        >
            <div className="p-1 bg-white dark:bg-zinc-950">{children}</div>
        </div>
    )
})
SelectContent.displayName = "SelectContent"

const SelectItem = React.forwardRef<HTMLDivElement, any>(({ className, children, value, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    return (
        <div
            ref={ref}
            className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground cursor-pointer",
                className
            )}
            onClick={() => {
                context?.onValueChange?.(value)
                context?.setOpen(false)
            }}
            {...props}
        >
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                {context?.value === value && (
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                    >
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                )}
            </span>
            <span className="truncate">{children}</span>
        </div>
    )
})
SelectItem.displayName = "SelectItem"

const SelectGroup = ({ children }: any) => <>{children}</>
const SelectLabel = ({ children }: any) => <div className="px-2 py-1.5 text-sm font-semibold">{children}</div>
const SelectSeparator = () => <div className="-mx-1 my-1 h-px bg-muted" />

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator }

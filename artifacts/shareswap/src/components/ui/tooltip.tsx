import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const TooltipContext = React.createContext<{
  open: boolean
  setOpen: (open: boolean) => void
  isTouchDevice: boolean
} | null>(null)

const Tooltip = ({ children, ...props }: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) => {
  const [open, setOpen] = React.useState(false)
  const [isTouchDevice, setIsTouchDevice] = React.useState(false)

  React.useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])

  return (
    <TooltipContext.Provider value={{ open, setOpen, isTouchDevice }}>
      <TooltipPrimitive.Root 
        open={open} 
        onOpenChange={isTouchDevice ? undefined : setOpen}
        delayDuration={0}
        {...props}
      >
        {children}
      </TooltipPrimitive.Root>
    </TooltipContext.Provider>
  )
}

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ children, onClick, ...props }, ref) => {
  const context = React.useContext(TooltipContext)
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  const handleTouch = (e: React.TouchEvent | React.MouseEvent) => {
    if (!context?.isTouchDevice) return
    
    e.preventDefault()
    e.stopPropagation()
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    context.setOpen(true)
    timeoutRef.current = setTimeout(() => {
      context.setOpen(false)
    }, 2500)
  }

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onClick={(e) => {
        if (context?.isTouchDevice) {
          handleTouch(e)
        }
        onClick?.(e)
      }}
      onTouchEnd={(e) => {
        if (context?.isTouchDevice) {
          handleTouch(e)
        }
      }}
      {...props}
    >
      {children}
    </TooltipPrimitive.Trigger>
  )
})
TooltipTrigger.displayName = "TooltipTrigger"

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

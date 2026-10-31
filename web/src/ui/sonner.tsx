import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { BrandLoader } from "@/components/BrandLoader"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// The caller passes theme ("light" or "dark"): the app has no next-themes provider.
const Toaster = ({ theme = "light", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <BrandLoader size={16} />,
      }}
      // H46: a long title or description (an error, a list of finishes) makes a tall toast, and the stack of toasts
      // can fill the screen. At most 2 lines each; a long word (a path, a URL) breaks. The bell keeps the full text.
      toastOptions={{
        classNames: {
          title: "line-clamp-2 [overflow-wrap:anywhere]",
          description: "line-clamp-2 [overflow-wrap:anywhere]",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

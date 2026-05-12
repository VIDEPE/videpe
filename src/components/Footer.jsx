import { cn } from "@/lib/utils";
import { ArrowUp } from "lucide-react";

export const Footer = () => {
    const handleScrollToTop = (event) => {
        event.preventDefault();
        const target = document.getElementById("home");
        if (target) {
            target.scrollIntoView({ block: "start" });
        }
    };

    return (
        <footer className={cn("py-4 px-4 bg-card relative border-t border-border mt-8",
          "flex flex-wrap justify-between items-center")}>
          <p className="text-sm text-muted-foreground"> 
            &copy; {new Date().getFullYear()} Jeroen Buil. All rights reserved.
          </p>

          <a 
            href='#home'
            onClick={handleScrollToTop}
            className={cn("p-2 rounded-full bg-primary/10 text-primary",
              "hover:bg-primary/20")}
          >
            <ArrowUp className="w-9 h-9 animate-bounce-up"/> 
            </a>
        </footer>
    );
}
import Link from "next/link";
import { Compass, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="mb-5 grid h-20 w-20 place-items-center rounded-2xl bg-accent/60 text-primary">
        <Compass className="h-9 w-9" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">
          <Home className="h-5 w-5" /> Back to home
        </Link>
      </Button>
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";

export default function Brand({
  size = "md",
  variant = "dark",
  href = "/",
}: {
  size?: "sm" | "md" | "lg";
  variant?: "dark" | "light";
  href?: string | null;
}) {
  const dim = size === "lg" ? 44 : size === "sm" ? 28 : 36;
  const textSize = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  const textColor = variant === "light" ? "text-white" : "text-zinc-900";
  const accent = variant === "light" ? "text-emerald-300" : "text-emerald-600";

  const inner = (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src="/openidea-logo.png"
        alt="Open Idea EcoSyz"
        width={dim}
        height={dim}
        className="rounded-full"
        priority
      />
      <span className={`${textSize} font-bold tracking-tight ${textColor}`}>
        Open Idea <span className={accent}>EcoSyz</span>
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} aria-label="Open Idea EcoSyz">
      {inner}
    </Link>
  );
}

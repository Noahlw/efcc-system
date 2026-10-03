import Link from "next/link";

/** Only delivered destinations that the current access decision permits. */
export const PrimaryNavigation = ({
  accessAllowed,
  currentPath,
}: {
  accessAllowed: boolean;
  currentPath: "/" | "/status";
}) =>
  accessAllowed ? (
    <nav aria-label="主要導覽" className="mt-6">
      <Link
        aria-current={currentPath === "/" ? "page" : undefined}
        className="bg-muted text-foreground inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-4 text-base font-medium"
        href="/"
        prefetch={false}
      >
        主頁
      </Link>
    </nav>
  ) : null;

import type { ReactNode } from "react";

import { PageFrame } from "@/components/page-frame";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <PageFrame variant="auth">{children}</PageFrame>;
}

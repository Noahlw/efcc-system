import type { ReactNode } from "react";

import { PageFrame } from "@/components/page-frame";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-layout bg-background flex min-h-dvh w-full flex-col justify-center lg:px-8 lg:py-12">
      <PageFrame variant="auth">{children}</PageFrame>
    </div>
  );
}
